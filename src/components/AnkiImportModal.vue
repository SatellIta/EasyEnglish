<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  AnkiFieldMapping,
  AnkiImportOptions,
  AnkiImportPreview,
  AnkiImportResult,
  AnkiNotetypeSummary,
  AnkiWarning,
} from '@shared/types'
import BaseModal from '@/components/BaseModal.vue'
import Icon from '@/components/Icon.vue'
import { t } from '@/i18n'
import { api, errorMessage } from '@/lib/api'

type Step = 'select' | 'preview' | 'importing' | 'done'
type SourceTab = 'file' | 'browse'
type ListKey = 'examples' | 'explanation' | 'notes' | 'tagFields'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; imported: [] }>()

const step = ref<Step>('select')
const sourceTab = ref<SourceTab>('file')
const fileInput = ref<HTMLInputElement | null>(null)
const dragging = ref(false)
const file = ref<File | null>(null)
const preview = ref<AnkiImportPreview | null>(null)
const result = ref<AnkiImportResult | null>(null)
const error = ref('')
const loading = ref(false)
const importId = ref('')
const activeId = ref<number | null>(null)
const selectedNotetypes = ref<Set<number>>(new Set())
const mappings = ref<Record<string, AnkiFieldMapping>>({})

const options = ref<AnkiImportOptions>({
  useAnkiTags: true,
  addDeckTag: true,
  duplicateMode: 'skip',
  addToReview: false,
  media: 'placeholder',
})

const listMappingFields = [
  { key: 'examples', label: 'anki.examplesFields' },
  { key: 'explanation', label: 'anki.explanationFields' },
  { key: 'notes', label: 'anki.notesFields' },
  { key: 'tagFields', label: 'anki.tagFields' },
] as const

const activeNotetype = computed<AnkiNotetypeSummary | null>(() => {
  if (!preview.value) return null
  return (
    preview.value.notetypes.find((notetype) => notetype.id === activeId.value) ??
    preview.value.notetypes[0] ??
    null
  )
})

const activeMapping = computed<AnkiFieldMapping | null>(() => {
  const notetype = activeNotetype.value
  if (!notetype) return null
  return mappings.value[String(notetype.id)] ?? null
})

const activeSample = computed(() => {
  if (!preview.value || !activeNotetype.value) return null
  return (
    preview.value.sample.find((sample) => sample.notetypeId === activeNotetype.value?.id) ??
    preview.value.sample[0] ??
    null
  )
})

const canImport = computed(
  () => selectedNotetypes.value.size > 0 && step.value === 'preview' && !loading.value,
)

watch(
  () => props.open,
  (open) => {
    if (open) reset()
  },
)

function reset() {
  step.value = 'select'
  sourceTab.value = 'file'
  file.value = null
  preview.value = null
  result.value = null
  error.value = ''
  loading.value = false
  importId.value = ''
  activeId.value = null
  selectedNotetypes.value = new Set()
  mappings.value = {}
  if (fileInput.value) fileInput.value.value = ''
}

function cloneMapping(mapping: AnkiFieldMapping): AnkiFieldMapping {
  return {
    ...mapping,
    examples: [...mapping.examples],
    explanation: [...mapping.explanation],
    notes: [...mapping.notes],
    tagFields: [...mapping.tagFields],
  }
}

function initFromPreview(data: AnkiImportPreview) {
  preview.value = data
  importId.value = data.importId
  const next: Record<string, AnkiFieldMapping> = {}
  for (const notetype of data.notetypes) {
    next[String(notetype.id)] = cloneMapping(notetype.mapping)
  }
  mappings.value = next
  activeId.value = data.defaultNotetypeId ?? data.notetypes[0]?.id ?? null
  selectedNotetypes.value = new Set(data.notetypes.map((notetype) => notetype.id))
}

async function previewFile(nextFile: File) {
  if (nextFile.size > 200 * 1024 * 1024) {
    error.value = t('api.fileTooLarge')
    return
  }
  file.value = nextFile
  loading.value = true
  error.value = ''
  try {
    const data = await api.imports.previewAnki(nextFile)
    initFromPreview(data)
    step.value = 'preview'
  } catch (caught) {
    error.value = errorMessage(caught)
    step.value = 'select'
  } finally {
    loading.value = false
  }
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = input.files?.[0]
  if (selected) previewFile(selected)
}

function onDrop(event: DragEvent) {
  dragging.value = false
  const dropped = event.dataTransfer?.files?.[0]
  if (dropped) previewFile(dropped)
}

function toggleNotetype(id: number) {
  const next = new Set(selectedNotetypes.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedNotetypes.value = next
}

function toggleList(key: ListKey, ord: number) {
  const mapping = activeMapping.value
  if (!mapping) return
  const list = mapping[key]
  mapping[key] = list.includes(ord)
    ? list.filter((item) => item !== ord)
    : [...list, ord].sort((a, b) => a - b)
}

function fieldLabel(ord: number): string {
  return activeNotetype.value?.fields.find((field) => field.ord === ord)?.name ?? `#${ord}`
}

function formatBytes(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${size} B`
}

function formatLabel(data: AnkiImportPreview): string {
  return /\.colpkg$/i.test(data.fileName) ? t('anki.formatColpkg') : t('anki.formatApkg')
}

function warningText(warning: AnkiWarning): string {
  switch (warning.code) {
    case 'media':
      return t('anki.warningMedia', { count: warning.count ?? 0 })
    case 'mediaIndex':
      return t('anki.warningMediaIndex')
    case 'legacySchema':
      return t('anki.warningLegacySchema', { version: warning.version ?? '' })
    case 'unlearned':
      return t('anki.warningUnlearned')
    case 'mediaMissing':
      return t('anki.warningMediaMissing', { count: warning.count ?? 0 })
    default:
      return ''
  }
}

async function cancelSession() {
  if (importId.value) {
    await api.imports.cancelAnki(importId.value).catch(() => {})
  }
}

async function close() {
  if (step.value === 'importing') return
  if (step.value === 'preview') await cancelSession()
  reset()
  emit('close')
}

async function backToSelect() {
  await cancelSession()
  reset()
}

async function commit() {
  if (!preview.value || !canImport.value) return
  loading.value = true
  error.value = ''
  step.value = 'importing'
  try {
    result.value = await api.imports.commitAnki(importId.value, {
      ...options.value,
      notetypeIds: [...selectedNotetypes.value],
      mappingByNotetype: mappings.value,
    })
    step.value = 'done'
    emit('imported')
  } catch (caught) {
    error.value = errorMessage(caught)
    step.value = 'preview'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <BaseModal :open="open" :title="t('anki.title')" width="820px" @close="close">
    <div class="anki-body">
      <p v-if="error" class="banner banner-error">{{ error }}</p>

      <template v-if="step === 'select'">
        <div class="source-tabs" role="tablist">
          <button
            type="button"
            class="source-tab"
            :class="{ active: sourceTab === 'file' }"
            role="tab"
            :aria-selected="sourceTab === 'file'"
            @click="sourceTab = 'file'"
          >
            <Icon name="upload" :size="16" /> {{ t('anki.tabFile') }}
          </button>
          <button
            type="button"
            class="source-tab"
            :class="{ active: sourceTab === 'browse' }"
            role="tab"
            :aria-selected="sourceTab === 'browse'"
            @click="sourceTab = 'browse'"
          >
            <Icon name="search" :size="16" /> {{ t('anki.tabBrowse') }}
          </button>
        </div>

        <div
          v-if="sourceTab === 'file'"
          class="drop-zone"
          :class="{ dragging, busy: loading }"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="onDrop"
        >
          <input
            ref="fileInput"
            type="file"
            accept=".apkg,.colpkg,application/zip"
            hidden
            @change="onFileChange"
          />
          <div class="drop-mark">
            <Icon :name="loading ? 'refresh' : 'upload'" :size="30" />
          </div>
          <h3>{{ loading ? t('common.loading') : t('anki.selectTitle') }}</h3>
          <p class="muted">{{ t('anki.selectHint') }}</p>
          <button class="btn btn-primary" type="button" :disabled="loading" @click="fileInput?.click()">
            <Icon name="upload" :size="16" /> {{ t('anki.chooseFile') }}
          </button>
          <p class="hint">{{ t('anki.fileHint') }}</p>
        </div>

        <div v-else class="drop-zone ankiweb-panel">
          <div class="drop-mark">
            <Icon name="search" :size="30" />
          </div>
          <h3>{{ t('anki.browseTitle') }}</h3>
          <p class="muted">{{ t('anki.browseHint') }}</p>
          <a
            class="btn btn-primary"
            href="https://ankiweb.net/shared/decks"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="download" :size="16" /> {{ t('anki.browseOpen') }}
          </a>
          <p class="hint">{{ t('anki.browseSteps') }}</p>
        </div>
      </template>

      <template v-else-if="step === 'preview' && preview">
        <section class="preview-head card-soft">
          <div>
            <strong>{{ t('anki.fileInfo', { name: preview.fileName, size: formatBytes(preview.fileSize) }) }}</strong>
            <p class="muted small">
              {{ formatLabel(preview) }} · {{ t('anki.schema') }} {{ preview.schemaVersion }}
            </p>
          </div>
          <div class="preview-counts">
            <span><strong>{{ preview.totals.notes }}</strong> {{ t('anki.notesCount') }}</span>
            <span><strong>{{ preview.totals.cards }}</strong> {{ t('anki.cardsCount') }}</span>
            <span><strong>{{ preview.totals.media }}</strong> {{ t('anki.mediaCount') }}</span>
          </div>
        </section>

        <p v-for="warning in preview.warnings" :key="warning.code" class="banner banner-info">
          {{ warningText(warning) }}
        </p>

        <section>
          <h3 class="section-title">{{ t('anki.decks') }}</h3>
          <div class="chip-row">
            <span v-for="deck in preview.decks" :key="deck" class="tag">{{ deck }}</span>
            <span v-if="!preview.decks.length" class="muted small">{{ t('common.none') }}</span>
          </div>
        </section>

        <section>
          <h3 class="section-title">{{ t('anki.notetypes') }}</h3>
          <div class="notetype-list">
            <div
              v-for="notetype in preview.notetypes"
              :key="notetype.id"
              class="notetype-row"
              :class="{ active: activeNotetype?.id === notetype.id }"
            >
              <label class="check-row">
                <input
                  type="checkbox"
                  :checked="selectedNotetypes.has(notetype.id)"
                  @change="toggleNotetype(notetype.id)"
                />
                <span>
                  {{ notetype.name }}
                  <small>{{ notetype.noteCount }} {{ t('anki.notesCount') }}</small>
                </span>
              </label>
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                @click="activeId = notetype.id"
              >
                {{ t('anki.columns') }}
              </button>
            </div>
          </div>
          <p class="hint">{{ t('anki.mappingHint') }}</p>
        </section>

        <section v-if="activeNotetype && activeMapping">
          <h3 class="section-title">
            {{ t('anki.columns') }} · {{ activeNotetype.name }}
          </h3>
          <div class="mapping-grid">
            <label class="field">
              <span>{{ t('anki.textField') }}</span>
              <select v-model.number="activeMapping.text" class="select">
                <option v-for="field in activeNotetype.fields" :key="field.ord" :value="field.ord">
                  {{ field.name }}
                </option>
              </select>
            </label>

            <label class="field">
              <span>{{ t('anki.meaningField') }}</span>
              <select v-model="activeMapping.meaning" class="select">
                <option :value="null">{{ t('anki.none') }}</option>
                <option v-for="field in activeNotetype.fields" :key="field.ord" :value="field.ord">
                  {{ field.name }}
                </option>
              </select>
            </label>

            <label class="field">
              <span>{{ t('anki.englishDefinitionField') }}</span>
              <select v-model="activeMapping.englishDefinition" class="select">
                <option :value="null">{{ t('anki.none') }}</option>
                <option v-for="field in activeNotetype.fields" :key="field.ord" :value="field.ord">
                  {{ field.name }}
                </option>
              </select>
            </label>

            <label class="field">
              <span>{{ t('anki.phoneticField') }}</span>
              <select v-model="activeMapping.phonetic" class="select">
                <option :value="null">{{ t('anki.none') }}</option>
                <option v-for="field in activeNotetype.fields" :key="field.ord" :value="field.ord">
                  {{ field.name }}
                </option>
              </select>
            </label>

            <label class="field">
              <span>{{ t('anki.imageField') }}</span>
              <select v-model="activeMapping.image" class="select">
                <option :value="null">{{ t('anki.none') }}</option>
                <option v-for="field in activeNotetype.fields" :key="field.ord" :value="field.ord">
                  {{ field.name }}
                </option>
              </select>
            </label>
          </div>

          <div class="list-mappings">
            <div v-for="item in listMappingFields" :key="item.key" class="list-mapping">
              <span class="mapping-label">{{ t(item.label) }}</span>
              <div class="chip-row">
                <button
                  v-for="field in activeNotetype.fields"
                  :key="field.ord"
                  type="button"
                  class="filter-chip"
                  :class="{ active: activeMapping[item.key].includes(field.ord) }"
                  :aria-pressed="activeMapping[item.key].includes(field.ord)"
                  @click="toggleList(item.key, field.ord)"
                >
                  {{ field.name }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h3 class="section-title">{{ t('anki.options') }}</h3>
          <div class="options-grid">
            <label class="check-row">
              <input v-model="options.useAnkiTags" type="checkbox" />
              <span>{{ t('anki.useAnkiTags') }}</span>
            </label>
            <label class="check-row">
              <input v-model="options.addDeckTag" type="checkbox" />
              <span>{{ t('anki.addDeckTag') }}</span>
            </label>
            <label class="check-row">
              <input v-model="options.addToReview" type="checkbox" />
              <span>
                {{ t('anki.addToReview') }}
                <small>{{ t('anki.addToReviewHint') }}</small>
              </span>
            </label>
            <label class="field">
              <span>{{ t('anki.duplicateMode') }}</span>
              <select v-model="options.duplicateMode" class="select">
                <option value="skip">{{ t('anki.duplicateSkip') }}</option>
                <option value="update">{{ t('anki.duplicateUpdate') }}</option>
                <option value="new">{{ t('anki.duplicateNew') }}</option>
              </select>
            </label>
            <label class="field">
              <span>{{ t('anki.mediaMode') }}</span>
              <select v-model="options.media" class="select">
                <option value="placeholder">{{ t('anki.mediaPlaceholder') }}</option>
                <option value="strip">{{ t('anki.mediaStrip') }}</option>
              </select>
            </label>
          </div>
        </section>

        <section v-if="activeSample">
          <h3 class="section-title">{{ t('anki.sample') }}</h3>
          <div class="sample-card card-soft">
            <div class="row wrap between">
              <strong>{{ activeSample.mapped.text || t('anki.sampleEmpty') }}</strong>
              <span class="muted small">
                {{ activeSample.deck }} · {{ activeSample.notetypeName }}
              </span>
            </div>
            <p v-if="activeSample.mapped.phonetic" class="muted small">
              {{ activeSample.mapped.phonetic }}
            </p>
            <p v-if="activeSample.mapped.meaning">{{ activeSample.mapped.meaning }}</p>
            <p v-if="activeSample.mapped.englishDefinition" class="sample-definition">
              {{ activeSample.mapped.englishDefinition }}
            </p>
            <ul v-if="activeSample.mapped.examples.length" class="sample-examples">
              <li v-for="(example, index) in activeSample.mapped.examples.slice(0, 3)" :key="index">
                {{ example }}
              </li>
            </ul>
            <div v-if="activeSample.mapped.tags.length" class="chip-row">
              <span v-for="tag in activeSample.mapped.tags" :key="tag" class="tag">{{ tag }}</span>
            </div>
          </div>

          <details class="raw-fields">
            <summary>{{ t('anki.rawFields') }}</summary>
            <div
              v-for="field in activeNotetype?.fields ?? []"
              :key="field.ord"
              class="raw-field"
            >
              <span>{{ fieldLabel(field.ord) }}</span>
              <p>{{ activeSample.fields[field.ord] || '—' }}</p>
            </div>
          </details>
        </section>
      </template>

      <template v-else-if="step === 'importing'">
        <div class="importing">
          <div class="spinner"><Icon name="refresh" :size="30" /></div>
          <h3>{{ t('anki.importing') }}</h3>
          <p class="muted">{{ t('anki.importingHint') }}</p>
        </div>
      </template>

      <template v-else-if="step === 'done' && result">
        <div class="done-head">
          <div class="done-mark"><Icon name="check" :size="28" /></div>
          <h3>{{ t('anki.doneTitle') }}</h3>
        </div>
        <div class="result-grid">
          <div><strong>{{ result.imported }}</strong><span>{{ t('anki.importedLabel') }}</span></div>
          <div><strong>{{ result.updated }}</strong><span>{{ t('anki.updatedLabel') }}</span></div>
          <div><strong>{{ result.skipped }}</strong><span>{{ t('anki.skippedLabel') }}</span></div>
          <div><strong>{{ result.failed }}</strong><span>{{ t('anki.failedLabel') }}</span></div>
          <div><strong>{{ result.images }}</strong><span>{{ t('anki.imagesLabel') }}</span></div>
        </div>
        <p class="banner banner-info">
          {{ result.learned ? t('anki.learnedNote') : t('anki.unlearnedNote') }}
        </p>
        <p v-for="warning in result.warnings" :key="warning.code" class="hint">
          {{ warningText(warning) }}
        </p>
        <details v-if="result.errors.length" class="raw-fields">
          <summary>{{ t('anki.errors') }}</summary>
          <p v-for="item in result.errors" :key="item.row" class="hint">
            #{{ item.row }} · {{ errorMessage(item.message) }}
          </p>
        </details>
      </template>
    </div>

    <template #footer>
      <template v-if="step === 'select'">
        <button class="btn btn-ghost" type="button" @click="close">{{ t('common.cancel') }}</button>
      </template>
      <template v-else-if="step === 'preview'">
        <button class="btn btn-ghost" type="button" @click="backToSelect">
          {{ t('anki.back') }}
        </button>
        <button class="btn btn-primary" type="button" :disabled="!canImport" @click="commit">
          <Icon name="upload" :size="16" /> {{ t('anki.start') }}
        </button>
      </template>
      <template v-else-if="step === 'done'">
        <button class="btn btn-primary" type="button" @click="close">{{ t('anki.close') }}</button>
      </template>
    </template>
  </BaseModal>
</template>

<style scoped>
.anki-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.source-tabs {
  display: flex;
  gap: 8px;
  padding: 6px;
  border-radius: var(--radius-sm);
  background: var(--bg);
  box-shadow: var(--shadow-inset-sm);
}
.source-tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 10px 12px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  font-size: 13px;
  font-weight: 600;
  transition: box-shadow var(--transition), color var(--transition);
}
.source-tab.active {
  background: var(--bg);
  color: var(--accent-strong);
  box-shadow: var(--shadow-raised-sm);
}
.drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 38px 24px;
  border-radius: var(--radius);
  background: var(--bg);
  box-shadow: var(--shadow-inset);
  text-align: center;
  transition: box-shadow var(--transition);
}
.drop-zone.dragging {
  box-shadow: var(--shadow-pressed), 0 0 0 2px var(--accent);
}
.drop-zone.busy {
  opacity: 0.8;
}
.drop-zone h3 {
  margin: 4px 0 0;
  font-size: 18px;
  font-weight: 600;
}
.drop-zone p {
  margin: 0;
  max-width: 460px;
}
.drop-mark {
  width: 62px;
  height: 62px;
  border-radius: var(--radius);
  display: grid;
  place-items: center;
  color: var(--accent-strong);
  background: var(--accent-soft);
  box-shadow: var(--shadow-inset-sm);
}
.card-soft {
  padding: 16px 18px;
  border-radius: var(--radius-sm);
  background: var(--bg);
  box-shadow: var(--shadow-inset-sm);
}
.preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.preview-head p {
  margin: 4px 0 0;
}
.preview-counts {
  display: flex;
  gap: 18px;
  font-size: 12px;
  color: var(--muted);
}
.preview-counts strong {
  display: block;
  font-size: 18px;
  color: var(--ink);
}
.section-title {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
}
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.notetype-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.notetype-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--bg);
  box-shadow: var(--shadow-inset-sm);
}
.notetype-row.active {
  box-shadow: var(--shadow-pressed);
}
.check-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 13px;
  color: var(--ink-soft);
  cursor: pointer;
}
.check-row input {
  margin-top: 3px;
  flex: 0 0 auto;
}
.check-row span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.check-row small {
  font-size: 11px;
  color: var(--muted);
  font-weight: 400;
}
.mapping-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.list-mappings {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 14px;
}
.list-mapping {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.mapping-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}
.filter-chip {
  padding: 5px 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--ink-soft);
  font-size: 11.5px;
  box-shadow: var(--shadow-raised-sm);
  transition: box-shadow var(--transition), color var(--transition);
}
.filter-chip.active {
  box-shadow: var(--shadow-pressed);
  color: var(--accent-strong);
}
.options-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 18px;
  align-items: start;
}
.sample-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sample-card p {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.65;
  color: var(--ink-soft);
  white-space: pre-wrap;
}
.sample-definition {
  max-height: 120px;
  overflow: auto;
}
.sample-examples {
  margin: 0;
  padding-left: 1.1em;
  font-size: 13px;
  line-height: 1.6;
  color: var(--ink-soft);
}
.raw-fields {
  margin-top: 12px;
  font-size: 12.5px;
  color: var(--muted);
}
.raw-fields summary {
  cursor: pointer;
  font-weight: 600;
}
.raw-field {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-soft);
}
.raw-field span {
  font-weight: 600;
  color: var(--ink-soft);
}
.raw-field p {
  margin: 0;
  overflow-wrap: anywhere;
}
.importing {
  padding: 40px 20px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.importing h3 {
  margin: 0;
  font-size: 18px;
}
.spinner {
  color: var(--accent-strong);
  animation: spin 1.2s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.done-head {
  display: flex;
  align-items: center;
  gap: 14px;
}
.done-head h3 {
  margin: 0;
  font-size: 20px;
}
.done-mark {
  width: 54px;
  height: 54px;
  border-radius: var(--radius);
  display: grid;
  place-items: center;
  color: var(--accent-strong);
  background: var(--accent-soft);
  box-shadow: var(--shadow-inset-sm);
}
.result-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}
.result-grid div {
  padding: 12px;
  border-radius: var(--radius-sm);
  background: var(--bg);
  box-shadow: var(--shadow-inset-sm);
  text-align: center;
}
.result-grid strong {
  display: block;
  font-size: 20px;
  color: var(--ink);
}
.result-grid span {
  font-size: 11px;
  color: var(--muted);
}
@media (max-width: 680px) {
  .mapping-grid,
  .options-grid {
    grid-template-columns: 1fr;
  }
  .result-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .notetype-row {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
