<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type {
  Entry,
  EntryType,
  SceneDetail,
  SceneEntry,
  SceneSummary,
} from '@shared/types'
import { entryTypeLabel, t } from '@/i18n'
import EntryCard from '@/components/EntryCard.vue'
import EntryForm from '@/components/EntryForm.vue'
import Icon from '@/components/Icon.vue'
import SceneEntryPicker from '@/components/library/SceneEntryPicker.vue'
import SceneFormModal from '@/components/library/SceneFormModal.vue'
import { api, errorMessage } from '@/lib/api'
import { useAppStore } from '@/stores/app'

const props = defineProps<{ query: string; refreshToken: number }>()
const emit = defineEmits<{
  open: [entry: Entry]
  edit: [entry: Entry]
  remove: [entry: Entry]
  changed: []
}>()
const router = useRouter()
const store = useAppStore()

const scenes = ref<SceneSummary[]>([])
const activeScene = ref<SceneDetail | null>(null)
const activeType = ref<EntryType | 'all'>('all')
const sortMode = ref<'memory' | 'order'>('memory')
const loading = ref(false)
const error = ref('')
const matchedEntries = ref<Entry[]>([])
const matchedSceneIds = ref<Set<number>>(new Set())

const sceneFormOpen = ref(false)
const editingScene = ref<SceneSummary | null>(null)
const pickerOpen = ref(false)
const entryFormOpen = ref(false)
const startingChat = ref(false)
const reviewBusy = ref(false)
const reviewError = ref('')
const reviewNotice = ref('')

const typeFilterValues: Array<EntryType | 'all'> = ['all', 'word', 'phrase', 'sentence']

function filterLabel(value: EntryType | 'all'): string {
  return value === 'all' ? t('common.all') : entryTypeLabel(value)
}

const filteredScenes = computed(() => {
  const q = props.query.trim().toLowerCase()
  if (!q) return scenes.value
  return scenes.value.filter(
    (scene) =>
      scene.name.toLowerCase().includes(q) ||
      (scene.description ?? '').toLowerCase().includes(q) ||
      matchedSceneIds.value.has(scene.id),
  )
})

function sceneMatchCount(sceneId: number): number {
  return matchedEntries.value.filter((entry) =>
    entry.sceneRefs.some((ref) => ref.sceneId === sceneId),
  ).length
}

const filteredItems = computed<SceneEntry[]>(() => {
  const detail = activeScene.value
  if (!detail) return []
  const q = props.query.trim().toLowerCase()
  const items = detail.items.filter((item) => {
    if (activeType.value !== 'all' && item.entry.type !== activeType.value) return false
    if (!q) return true
    return [item.entry.text, item.entry.meaning, item.entry.explanation, item.entry.notes, item.section, item.subsection]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q))
  })

  return [...items].sort((a, b) => {
    if (sortMode.value === 'order') return a.position - b.position
    const diff = new Date(b.entry.createdAt).getTime() - new Date(a.entry.createdAt).getTime()
    if (diff !== 0) return diff
    // 同一次导入的词条时间相同，用导入位置保持原笔记顺序。
    return a.position - b.position || a.entry.id - b.entry.id
  })
})

interface SubsectionGroup {
  key: string
  name: string
  items: SceneEntry[]
}

interface SectionGroup {
  key: string
  name: string
  total: number
  subsections: SubsectionGroup[]
}

const allInReview = computed(() => {
  const items = activeScene.value?.items ?? []
  return items.length > 0 && items.every((item) => item.entry.reviewEnabled)
})

const groups = computed<SectionGroup[]>(() => {
  const sectionMap = new Map<string, SectionGroup>()
  for (const item of filteredItems.value) {
    const sectionName = item.section?.trim() || t('import.ungrouped')
    const sectionKey = sectionName
    let section = sectionMap.get(sectionKey)
    if (!section) {
      section = { key: sectionKey, name: sectionName, total: 0, subsections: [] }
      sectionMap.set(sectionKey, section)
    }
    section.total += 1

    const subsectionName = item.subsection?.trim() || ''
    const subsectionKey = `${sectionKey}::${subsectionName}`
    let subsection = section.subsections.find((value) => value.key === subsectionKey)
    if (!subsection) {
      subsection = { key: subsectionKey, name: subsectionName, items: [] }
      section.subsections.push(subsection)
    }
    subsection.items.push(item)
  }
  return [...sectionMap.values()]
})

function typeCount(type: EntryType): number {
  if (!activeScene.value) return 0
  return activeScene.value.scene.counts[type]
}

async function toggleSceneReview() {
  const detail = activeScene.value
  if (!detail || reviewBusy.value || !detail.items.length) return
  const enabled = !allInReview.value
  reviewBusy.value = true
  reviewError.value = ''
  reviewNotice.value = ''
  try {
    const result = await api.scenes.setReview(detail.scene.id, enabled)
    for (const item of detail.items) item.entry.reviewEnabled = enabled
    reviewNotice.value = t('scene.view.reviewUpdated', { count: result.updated })
    store.refreshStats().catch(() => {})
  } catch (caught) {
    reviewError.value = errorMessage(caught)
  } finally {
    reviewBusy.value = false
  }
}

async function startSceneChat() {
  const detail = activeScene.value
  if (!detail || startingChat.value) return
  startingChat.value = true
  error.value = ''
  try {
    const session = await api.chat.createSession({
      sceneId: detail.scene.id,
      title: t('scene.view.practiceTitle', { name: detail.scene.name }),
    })
    router.push(`/chat/${session.id}`)
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    startingChat.value = false
  }
}

async function loadSceneList() {
  loading.value = true
  error.value = ''
  try {
    const query = props.query.trim()
    const [list, matched] = await Promise.all([
      api.scenes.list(),
      query ? api.entries.list({ q: query, limit: 500 }) : Promise.resolve(null),
    ])
    scenes.value = list.items
    matchedEntries.value = matched?.items ?? []
    matchedSceneIds.value = new Set(
      (matched?.items ?? []).flatMap((entry) =>
        entry.sceneRefs.map((ref) => ref.sceneId),
      ),
    )
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

async function loadScene(id: number) {
  loading.value = true
  error.value = ''
  try {
    activeScene.value = await api.scenes.detail(id)
    activeType.value = 'all'
  } catch (caught) {
    error.value = errorMessage(caught)
    activeScene.value = null
  } finally {
    loading.value = false
  }
}

async function bootstrap() {
  if (activeScene.value) {
    await loadScene(activeScene.value.scene.id)
  } else {
    await loadSceneList()
  }
}

function openScene(scene: SceneSummary) {
  activeType.value = 'all'
  sortMode.value = 'memory'
  reviewError.value = ''
  reviewNotice.value = ''
  loadScene(scene.id)
}

function backToScenes() {
  activeScene.value = null
  reviewError.value = ''
  reviewNotice.value = ''
  loadSceneList()
}

function openCreateScene() {
  editingScene.value = null
  sceneFormOpen.value = true
}

function openEditScene(scene: SceneSummary) {
  editingScene.value = scene
  sceneFormOpen.value = true
}

async function onSceneSaved() {
  await loadSceneList()
  if (activeScene.value) await loadScene(activeScene.value.scene.id)
}

async function removeScene(scene: SceneSummary) {
  if (!window.confirm(t('scene.view.deleteConfirm', { name: scene.name }))) return
  try {
    await api.scenes.remove(scene.id)
    activeScene.value = null
    await loadSceneList()
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

async function removeFromScene(entry: Entry) {
  const detail = activeScene.value
  if (!detail) return
  try {
    await api.scenes.removeEntry(detail.scene.id, entry.id)
    await loadScene(detail.scene.id)
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

async function onEntrySaved(entry: Entry) {
  const detail = activeScene.value
  if (!detail) return
  try {
    await api.scenes.addEntries(detail.scene.id, [entry.id])
    await loadScene(detail.scene.id)
    emit('changed')
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

async function onPickerAdded() {
  if (activeScene.value) await loadScene(activeScene.value.scene.id)
  emit('changed')
}

watch(
  () => props.refreshToken,
  () => bootstrap(),
)
watch(
  () => props.query,
  () => {
    if (!activeScene.value) loadSceneList()
  },
)
onMounted(bootstrap)
</script>

<template>
  <div class="scene-view">
    <p v-if="error" class="banner banner-error">{{ error }}</p>

    <template v-if="!activeScene">
      <div class="section-head">
        <div>
          <h2>{{ t('scene.view.title') }}</h2>
          <p class="hint">{{ t('scene.view.hint') }}</p>
        </div>
        <button class="btn btn-primary" @click="openCreateScene">
          <Icon name="plus" :size="16" /> {{ t('scene.view.new') }}
        </button>
      </div>

      <p v-if="loading && !scenes.length" class="empty">{{ t('common.loading') }}</p>
      <div v-else-if="!filteredScenes.length" class="empty card">
        <h3>{{ query ? t('scene.view.noMatchTitle') : t('scene.view.emptyTitle') }}</h3>
        <p v-if="query && matchedEntries.length">
          {{ t('scene.view.matchedUnassigned', { count: matchedEntries.length }) }}
        </p>
        <p v-else-if="query">{{ t('scene.view.tryAnother') }}</p>
        <p v-else>{{ t('scene.view.createHint') }}</p>
        <button v-if="!query" class="btn btn-primary" @click="openCreateScene">
          <Icon name="plus" :size="16" /> {{ t('scene.view.createFirst') }}
        </button>
      </div>
      <div v-else class="scene-grid">
        <article v-for="scene in filteredScenes" :key="scene.id" class="scene-card card">
          <button class="scene-open" type="button" @click="openScene(scene)">
            <span class="scene-name">{{ scene.name }}</span>
            <span v-if="scene.description" class="scene-desc">{{ scene.description }}</span>
            <span class="scene-counts">
              <span>{{ t('scene.view.count', { count: scene.counts.total }) }}</span>
              <span>{{ entryTypeLabel('word') }} {{ scene.counts.word }}</span>
              <span>{{ entryTypeLabel('phrase') }} {{ scene.counts.phrase }}</span>
              <span>{{ entryTypeLabel('sentence') }} {{ scene.counts.sentence }}</span>
            </span>
            <span v-if="query && sceneMatchCount(scene.id)" class="scene-match">
              {{ t('scene.view.matchedCount', { count: sceneMatchCount(scene.id) }) }}
            </span>
          </button>
          <div class="scene-actions">
            <button
              class="icon-btn"
              :title="t('scene.view.edit')"
              :aria-label="t('scene.view.edit')"
              @click="openEditScene(scene)"
            >
              <Icon name="edit" :size="16" />
            </button>
            <button
              class="icon-btn danger"
              :title="t('scene.view.delete')"
              :aria-label="t('scene.view.delete')"
              @click="removeScene(scene)"
            >
              <Icon name="trash" :size="16" />
            </button>
          </div>
        </article>
      </div>
    </template>

    <template v-else>
      <div class="detail-head">
        <button class="btn btn-ghost btn-sm" @click="backToScenes">
          <Icon name="chevron-left" :size="15" /> {{ t('scene.view.back') }}
        </button>
        <div class="detail-actions">
          <button
            class="btn btn-soft btn-sm"
            :disabled="startingChat"
            @click="startSceneChat"
          >
            <Icon :name="startingChat ? 'refresh' : 'chat'" :size="15" />
            {{ startingChat ? t('scene.view.creating') : t('scene.view.startChat') }}
          </button>
          <button class="btn btn-ghost btn-sm" @click="pickerOpen = true">
            <Icon name="layers" :size="15" /> {{ t('scene.view.addFromLibrary') }}
          </button>
          <button
            v-if="activeScene.items.length"
            class="btn btn-ghost btn-sm"
            type="button"
            :disabled="reviewBusy"
            @click="toggleSceneReview"
          >
            <Icon :name="reviewBusy ? 'refresh' : allInReview ? 'x' : 'check'" :size="15" />
            {{ allInReview ? t('scene.view.disableReview') : t('scene.view.enableReview') }}
          </button>
          <button class="btn btn-primary btn-sm" @click="entryFormOpen = true">
            <Icon name="plus" :size="15" /> {{ t('scene.view.addEntry') }}
          </button>
        </div>
      </div>

      <p v-if="reviewError" class="banner banner-error">{{ reviewError }}</p>
      <p v-if="reviewNotice" class="banner banner-ok">{{ reviewNotice }}</p>

      <header class="scene-hero card">
        <div class="scene-hero-main">
          <span class="scene-kicker">SCENE</span>
          <h2>{{ activeScene.scene.name }}</h2>
          <p v-if="activeScene.scene.description" class="scene-desc">
            {{ activeScene.scene.description }}
          </p>
          <div class="scene-counts">
            <span>{{ t('scene.view.count', { count: activeScene.scene.counts.total }) }}</span>
            <span>{{ entryTypeLabel('word') }} {{ activeScene.scene.counts.word }}</span>
            <span>{{ entryTypeLabel('phrase') }} {{ activeScene.scene.counts.phrase }}</span>
            <span>{{ entryTypeLabel('sentence') }} {{ activeScene.scene.counts.sentence }}</span>
          </div>
        </div>
        <div class="scene-hero-actions">
          <button class="icon-btn" :title="t('scene.view.edit')" :aria-label="t('scene.view.edit')" @click="openEditScene(activeScene.scene)">
            <Icon name="edit" :size="17" />
          </button>
          <button
            class="icon-btn danger"
            :title="t('scene.view.delete')"
            :aria-label="t('scene.view.delete')"
            @click="removeScene(activeScene.scene)"
          >
            <Icon name="trash" :size="17" />
          </button>
        </div>
      </header>

      <div class="scene-toolbar">
        <div class="type-tabs">
          <button
            v-for="filter in typeFilterValues"
            :key="filter"
            class="type-tab"
            :class="{ active: activeType === filter }"
            :aria-pressed="activeType === filter"
            @click="activeType = filter"
          >
            {{ filterLabel(filter) }}
            <span class="tab-count">
              {{ filter === 'all' ? activeScene.scene.counts.total : typeCount(filter) }}
            </span>
          </button>
        </div>
        <div class="type-tabs sort-tabs">
          <button
            class="type-tab"
            :class="{ active: sortMode === 'memory' }"
            :aria-pressed="sortMode === 'memory'"
            @click="sortMode = 'memory'"
          >
            {{ t('scene.view.sortMemory') }}
          </button>
          <button
            class="type-tab"
            :class="{ active: sortMode === 'order' }"
            :aria-pressed="sortMode === 'order'"
            @click="sortMode = 'order'"
          >
            {{ t('scene.view.sortOrder') }}
          </button>
        </div>
      </div>

      <p v-if="loading && !activeScene.items.length" class="empty">{{ t('common.loading') }}</p>
      <div v-else-if="!filteredItems.length" class="empty card">
        <h3>{{ query ? t('scene.view.emptyItemsQuery') : t('scene.view.emptyItemsTitle') }}</h3>
        <p>{{ query ? t('scene.view.emptyItemsQueryHint') : t('scene.view.emptyItemsHint') }}</p>
      </div>

      <div v-else class="scene-sections">
        <section v-for="section in groups" :key="section.key" class="scene-section card">
          <header class="section-head-row">
            <h3>{{ section.name }}</h3>
            <span class="muted small">{{ t('scene.view.count', { count: section.total }) }}</span>
          </header>

          <div
            v-for="subsection in section.subsections"
            :key="subsection.key"
            class="subsection"
          >
            <h4 v-if="subsection.name">{{ subsection.name }}</h4>
            <div class="lib-list">
              <EntryCard
                v-for="item in subsection.items"
                :key="item.entry.id"
                :entry="item.entry"
                :scene-id="activeScene.scene.id"
                :section="null"
                :subsection="null"
                :show-scene-refs="false"
                @open="emit('open', $event)"
                @edit="emit('edit', $event)"
                @remove="emit('remove', $event)"
                @remove-scene="removeFromScene"
              />
            </div>
          </div>
        </section>
      </div>

      <SceneEntryPicker
        :open="pickerOpen"
        :scene-id="activeScene.scene.id"
        :existing-ids="activeScene.items.map((item) => item.entry.id)"
        @close="pickerOpen = false"
        @added="onPickerAdded"
      />

      <EntryForm
        :open="entryFormOpen"
        :default-review-enabled="true"
        @close="entryFormOpen = false"
        @saved="onEntrySaved"
      />
    </template>

    <SceneFormModal
      :open="sceneFormOpen"
      :scene="editingScene"
      @close="sceneFormOpen = false"
      @saved="onSceneSaved"
    />
  </div>
</template>

<style scoped>
.scene-view {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.section-head,
.detail-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}
.section-head h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.section-head p {
  margin: 4px 0 0;
  max-width: 60ch;
}
.detail-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.scene-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
}
.scene-card {
  display: flex;
  align-items: stretch;
  gap: 6px;
  padding: 6px;
}
.scene-open {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 14px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink);
  text-align: left;
  transition: background-color var(--transition);
}
.scene-open:hover {
  background: var(--bg-soft);
}
.scene-name {
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
}
.scene-desc {
  margin: 0;
  font-size: 12.5px;
  color: var(--muted);
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.scene-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11.5px;
  color: var(--muted);
}
.scene-match {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--accent-strong);
}
.scene-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  justify-content: center;
  padding-right: 4px;
}
.scene-hero {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  padding: 26px 28px;
}
.scene-hero-main {
  min-width: 0;
}
.scene-kicker {
  display: block;
  margin-bottom: 6px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--accent-strong);
}
.scene-hero h2 {
  margin: 0 0 6px;
  font-size: clamp(26px, 3.4vw, 36px);
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.02em;
}
.scene-hero .scene-desc {
  max-width: 65ch;
  font-size: 14px;
  -webkit-line-clamp: unset;
  display: block;
}
.scene-hero-actions {
  display: flex;
  gap: 6px;
  flex: 0 0 auto;
}
.scene-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.sort-tabs {
  margin-left: auto;
}
.tab-count {
  margin-left: 6px;
  font-size: 11px;
  opacity: 0.7;
}
.scene-sections {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.scene-section {
  padding: 20px 22px;
}
.section-head-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
}
.section-head-row h3 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}
.subsection + .subsection {
  margin-top: 18px;
}
.subsection h4 {
  margin: 0 0 9px;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}
.lib-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
:deep(.entry-card) {
  box-shadow: none;
  background: var(--bg-soft);
}
:deep(.entry-card:hover) {
  box-shadow: var(--shadow-hover-sm);
}
@media (max-width: 620px) {
  .scene-hero {
    flex-direction: column;
  }
  .scene-hero-actions {
    align-self: flex-end;
  }
}
</style>
