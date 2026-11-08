<script setup lang="ts">
import { nextTick, reactive, ref, watch } from 'vue'
import type { Entry, EntryInput, EntryType } from '@shared/types'
import { api, errorMessage } from '@/lib/api'
import BaseModal from '@/components/BaseModal.vue'
import Icon from '@/components/Icon.vue'
import { t } from '@/i18n'

const props = withDefaults(
  defineProps<{ open: boolean; entry?: Entry | null; defaultReviewEnabled?: boolean }>(),
  { defaultReviewEnabled: true },
)
const emit = defineEmits<{ close: []; saved: [entry: Entry] }>()

interface SenseDraft {
  meaning: string
  englishDefinition: string
  explanation: string
  examplesText: string
}

function emptySense(): SenseDraft {
  return { meaning: '', englishDefinition: '', explanation: '', examplesText: '' }
}

const form = reactive({
  type: 'word' as EntryType,
  text: '',
  meaning: '',
  phonetic: '',
  englishDefinition: '',
  explanation: '',
  examplesText: '',
  notes: '',
  tagsText: '',
  images: [] as string[],
  reviewEnabled: true,
  senses: [] as SenseDraft[],
})
const saving = ref(false)
const error = ref('')

const typeOptions: Array<{
  value: EntryType
  labelKey: 'entryType.word' | 'entryType.phrase' | 'entryType.sentence'
  hintKey:
    | 'entryForm.type.wordHint'
    | 'entryForm.type.phraseHint'
    | 'entryForm.type.sentenceHint'
}> = [
  { value: 'word', labelKey: 'entryType.word', hintKey: 'entryForm.type.wordHint' },
  { value: 'phrase', labelKey: 'entryType.phrase', hintKey: 'entryForm.type.phraseHint' },
  { value: 'sentence', labelKey: 'entryType.sentence', hintKey: 'entryForm.type.sentenceHint' },
]

function reset() {
  const entry = props.entry
  form.type = entry?.type ?? 'word'
  form.text = entry?.text ?? ''
  form.meaning = entry?.meaning ?? ''
  form.phonetic = entry?.phonetic ?? ''
  form.englishDefinition = entry?.englishDefinition ?? ''
  form.explanation = entry?.explanation ?? ''
  form.examplesText = (entry?.examples ?? []).join('\n')
  form.notes = entry?.notes ?? ''
  form.tagsText = (entry?.tags ?? []).join(', ')
  form.images = [...(entry?.images ?? [])]
  form.reviewEnabled = entry?.reviewEnabled ?? props.defaultReviewEnabled
  form.senses =
    entry && entry.senses.length >= 2
      ? entry.senses.map((sense) => ({
          meaning: sense.meaning ?? '',
          englishDefinition: sense.englishDefinition ?? '',
          explanation: sense.explanation ?? '',
          examplesText: sense.examples.join('\n'),
        }))
      : []
  error.value = ''
}

watch(
  () => props.open,
  (open) => {
    if (open) reset()
  },
)

watch(
  () => props.entry,
  () => {
    if (props.open) reset()
  },
)

function addSense() {
  if (!form.senses.length) {
    const seed: SenseDraft = {
      meaning: form.meaning,
      englishDefinition: form.englishDefinition,
      explanation: form.explanation,
      examplesText: form.examplesText,
    }
    const hasSeed = [seed.meaning, seed.englishDefinition, seed.explanation, seed.examplesText].some(
      (value) => value.trim(),
    )
    form.senses = hasSeed ? [seed, emptySense()] : [emptySense(), emptySense()]
    return
  }
  form.senses.push(emptySense())
}

/** 删到只剩一个义项时回到普通扁平字段，避免留下只有一个义项的数组。 */
function removeSense(index: number) {
  form.senses.splice(index, 1)
  if (form.senses.length !== 1) return
  const only = form.senses[0]
  form.meaning = only.meaning
  form.englishDefinition = only.englishDefinition
  form.explanation = only.explanation
  form.examplesText = only.examplesText
  form.senses = []
}

async function submit() {
  if (!form.text.trim()) {
    error.value = t('entryForm.required')
    return
  }

  saving.value = true
  error.value = ''

  const normalizedSenses = form.senses
    .map((sense) => ({
      meaning: sense.meaning.trim() || null,
      englishDefinition: sense.englishDefinition.trim() || null,
      explanation: sense.explanation.trim() || null,
      examples: sense.examplesText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    }))
    .filter(
      (sense) =>
        sense.meaning || sense.englishDefinition || sense.explanation || sense.examples.length,
    )
  const useSenses = normalizedSenses.length >= 2
  const firstWith = (field: 'meaning' | 'englishDefinition' | 'explanation') =>
    normalizedSenses.find((sense) => sense[field])?.[field] ?? null
  const senseExamples = [
    ...new Set(normalizedSenses.flatMap((sense) => sense.examples)),
  ]

  const input: EntryInput = {
    type: form.type,
    text: form.text.trim(),
    meaning: useSenses ? firstWith('meaning') : form.meaning.trim() || null,
    phonetic: form.phonetic.trim() || null,
    englishDefinition: useSenses
      ? firstWith('englishDefinition')
      : form.englishDefinition.trim() || null,
    explanation: useSenses ? firstWith('explanation') : form.explanation.trim() || null,
    examples: useSenses
      ? senseExamples
      : form.examplesText
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
    senses: useSenses ? normalizedSenses : [],
    notes: form.notes.trim() || null,
    tags: form.tagsText
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
    images: form.images,
    reviewEnabled: form.reviewEnabled,
  }

  try {
    const entry = props.entry
      ? await api.entries.update(props.entry.id, input)
      : await api.entries.create(input)
    emit('saved', entry)
    emit('close')
  } catch (caught) {
    error.value = errorMessage(caught)
    await nextTick()
    document.querySelector('.entry-form .banner-error')?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
      block: 'center',
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal
    :open="open"
    :title="entry ? t('entryForm.editTitle') : t('entryForm.addTitle')"
    width="620px"
    @close="emit('close')"
  >
    <form class="entry-form" @submit.prevent="submit">
      <div class="field">
        <label>{{ t('entryForm.typeLabel') }}</label>
        <div class="type-picker">
          <button
            v-for="option in typeOptions"
            :key="option.value"
            type="button"
            class="type-option"
            :class="{ active: form.type === option.value }"
            :aria-pressed="form.type === option.value"
            @click="form.type = option.value"
          >
            <strong>{{ t(option.labelKey) }}</strong>
            <small>{{ t(option.hintKey) }}</small>
          </button>
        </div>
      </div>

      <div class="field">
        <label for="entry-text">{{ t('entryForm.text') }}</label>
        <textarea
          id="entry-text"
          v-model="form.text"
          class="textarea"
          rows="2"
          :placeholder="t('entryForm.textPlaceholder')"
        />
        <span class="hint">
          {{ t('entryForm.duplicateHint') }}
        </span>
      </div>

      <div v-if="form.senses.length >= 2" class="field">
        <label>{{ t('entryForm.senses') }}</label>
        <span class="hint">{{ t('entryForm.senseHint') }}</span>
        <div class="sense-editors">
          <div v-for="(sense, index) in form.senses" :key="index" class="sense-editor">
            <div class="sense-editor-head">
              <strong>{{ t('entryForm.senseN', { n: index + 1 }) }}</strong>
              <button
                type="button"
                class="icon-btn"
                :title="t('entryForm.removeSense')"
                :aria-label="t('entryForm.removeSense')"
                @click="removeSense(index)"
              >
                <Icon name="x" :size="14" />
              </button>
            </div>
            <input
              v-model="sense.meaning"
              class="input"
              :placeholder="t('entryForm.meaningPlaceholder')"
            />
            <textarea
              v-model="sense.englishDefinition"
              class="textarea"
              rows="2"
              :placeholder="t('entryForm.englishDefinitionPlaceholder')"
            />
            <textarea
              v-model="sense.explanation"
              class="textarea"
              rows="2"
              :placeholder="t('entryForm.explanationPlaceholder')"
            />
            <textarea
              v-model="sense.examplesText"
              class="textarea"
              rows="2"
              placeholder="She stayed up late to make up for lost time."
            />
          </div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm add-sense" @click="addSense">
          <Icon name="plus" :size="14" /> {{ t('entryForm.addSense') }}
        </button>
      </div>

      <div v-if="form.senses.length < 2" class="field">
        <label for="entry-meaning">{{ t('entryForm.meaning') }}</label>
        <input id="entry-meaning" v-model="form.meaning" class="input" :placeholder="t('entryForm.meaningPlaceholder')" />
      </div>

      <div class="field">
        <label for="entry-phonetic">{{ t('entryForm.phonetic') }}</label>
        <input
          id="entry-phonetic"
          v-model="form.phonetic"
          class="input"
          :placeholder="t('entryForm.phoneticPlaceholder')"
        />
      </div>

      <div v-if="form.senses.length < 2" class="field">
        <label for="entry-explanation">{{ t('entryForm.explanation') }}</label>
        <textarea
          id="entry-explanation"
          v-model="form.explanation"
          class="textarea"
          rows="3"
          :placeholder="t('entryForm.explanationPlaceholder')"
        />
      </div>

      <div v-if="form.senses.length < 2" class="field">
        <label for="entry-english-definition">{{ t('entryForm.englishDefinition') }}</label>
        <textarea
          id="entry-english-definition"
          v-model="form.englishDefinition"
          class="textarea"
          rows="3"
          :placeholder="t('entryForm.englishDefinitionPlaceholder')"
        />
      </div>

      <div v-if="form.senses.length < 2" class="field">
        <label for="entry-examples">{{ t('entryForm.examples') }}</label>
        <textarea
          id="entry-examples"
          v-model="form.examplesText"
          class="textarea"
          rows="3"
          placeholder="She stayed up late to make up for lost time."
        />
      </div>

      <button
        v-if="form.senses.length < 2"
        type="button"
        class="btn btn-ghost btn-sm add-sense"
        @click="addSense"
      >
        <Icon name="plus" :size="14" /> {{ t('entryForm.addSense') }}
      </button>

      <div class="field">
        <label for="entry-notes">{{ t('entryForm.notes') }}</label>
        <textarea
          id="entry-notes"
          v-model="form.notes"
          class="textarea"
          rows="2"
          :placeholder="t('entryForm.notesPlaceholder')"
        />
      </div>

      <div class="field">
        <label for="entry-tags">{{ t('entryForm.tags') }}</label>
        <input id="entry-tags" v-model="form.tagsText" class="input" :placeholder="t('entryForm.tagsPlaceholder')" />
      </div>

      <div v-if="form.images.length" class="field">
        <label>{{ t('entryForm.images') }}</label>
        <div class="form-images">
          <div v-for="src in form.images" :key="src" class="form-image">
            <img :src="src" :alt="t('learn.imageAlt')" loading="lazy" />
            <button
              type="button"
              class="icon-btn"
              :title="t('entryForm.removeImage')"
              :aria-label="t('entryForm.removeImage')"
              @click="form.images = form.images.filter((item) => item !== src)"
            >
              <Icon name="x" :size="14" />
            </button>
          </div>
        </div>
        <span class="hint">{{ t('entryForm.imagesHint') }}</span>
      </div>

      <label class="check-row">
        <input v-model="form.reviewEnabled" type="checkbox" />
        <span>
          {{ t('entryForm.reviewEnabled') }}
          <small>{{ t('entryForm.reviewEnabledHint') }}</small>
        </span>
      </label>

      <p v-if="error" class="banner banner-error">{{ error }}</p>
      <p class="hint">{{ t('entryForm.reviewHint') }}</p>
    </form>

    <template #footer>
      <button class="btn btn-ghost" type="button" @click="emit('close')">{{ t('common.cancel') }}</button>
      <button class="btn btn-primary" type="button" :disabled="saving" @click="submit">
        <Icon :name="saving ? 'refresh' : 'check'" :size="16" />
        {{ saving ? t('common.saving') : entry ? t('entryForm.saveChanges') : t('entryForm.add') }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
.entry-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.sense-editors {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sense-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: var(--radius);
  background: var(--bg-soft);
  box-shadow: var(--shadow-inset-sm);
}
.sense-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.sense-editor-head strong {
  font-size: 12.5px;
  color: var(--accent-strong);
}
.add-sense {
  align-self: flex-start;
}
.type-picker {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.type-option {
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-items: flex-start;
  padding: 12px 14px;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--ink-soft);
  text-align: left;
  box-shadow: var(--shadow-raised-sm);
  transition: box-shadow var(--transition), color var(--transition);
}
.type-option small {
  color: var(--muted);
  font-size: 11px;
}
.type-option:hover {
  box-shadow: var(--shadow-hover-sm);
}
.type-option:active {
  box-shadow: var(--shadow-pressed);
}
.type-option.active {
  box-shadow: var(--shadow-pressed);
  color: var(--accent-strong);
}
.type-option.active small {
  color: var(--accent-strong);
}
.check-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 13px;
  color: var(--ink-soft);
  font-weight: 500;
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
  font-size: 11.5px;
  color: var(--muted);
  font-weight: 400;
  line-height: 1.5;
}
.form-images {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.form-image {
  position: relative;
  display: flex;
}
.form-image img {
  width: 88px;
  height: 88px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  background: var(--bg);
  box-shadow: var(--shadow-raised-sm);
}
.form-image .icon-btn {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 26px;
  height: 26px;
  background: var(--surface);
  box-shadow: var(--shadow-raised-sm);
}
</style>
