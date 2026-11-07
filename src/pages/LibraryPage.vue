<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import type { Entry } from '@shared/types'
import AnkiImportModal from '@/components/AnkiImportModal.vue'
import EntryDetailModal from '@/components/EntryDetailModal.vue'
import EntryForm from '@/components/EntryForm.vue'
import ExportModal from '@/components/ExportModal.vue'
import Icon from '@/components/Icon.vue'
import DateView from '@/components/library/DateView.vue'
import SceneView from '@/components/library/SceneView.vue'
import TagView from '@/components/library/TagView.vue'
import TypeView from '@/components/library/TypeView.vue'
import { t } from '@/i18n'
import { api, errorMessage } from '@/lib/api'
import { truncate } from '@/lib/format'
import { useAppStore } from '@/stores/app'

type ViewMode = 'date' | 'type' | 'tag' | 'scene'

const store = useAppStore()

const view = ref<ViewMode>('date')
const q = ref('')
const query = ref('')
const refreshToken = ref(0)
const formOpen = ref(false)
const exportOpen = ref(false)
const ankiOpen = ref(false)
const editing = ref<Entry | null>(null)
const detail = ref<Entry | null>(null)
const error = ref('')
let timer: number | undefined

const views: Array<{
  value: ViewMode
  labelKey:
    | 'library.view.date'
    | 'library.view.type'
    | 'library.view.tag'
    | 'library.view.scene'
  hintKey:
    | 'library.view.dateHint'
    | 'library.view.typeHint'
    | 'library.view.tagHint'
    | 'library.view.sceneHint'
}> = [
  { value: 'date', labelKey: 'library.view.date', hintKey: 'library.view.dateHint' },
  { value: 'type', labelKey: 'library.view.type', hintKey: 'library.view.typeHint' },
  { value: 'tag', labelKey: 'library.view.tag', hintKey: 'library.view.tagHint' },
  { value: 'scene', labelKey: 'library.view.scene', hintKey: 'library.view.sceneHint' },
]

watch(q, () => {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    query.value = q.value.trim()
  }, 220)
})

function refresh() {
  refreshToken.value += 1
  store.refreshStats().catch(() => {})
}

function openCreate() {
  editing.value = null
  formOpen.value = true
}

function openEdit(entry: Entry) {
  editing.value = entry
  formOpen.value = true
}

function openDetail(entry: Entry) {
  detail.value = entry
}

function editFromDetail(entry: Entry) {
  detail.value = null
  openEdit(entry)
}

async function onSaved() {
  editing.value = null
  refresh()
}

async function onAnkiImported() {
  refresh()
}

async function remove(entry: Entry) {
  if (
    !window.confirm(
      t('library.deleteConfirm', { text: truncate(entry.text, 40) }),
    )
  ) {
    return
  }
  try {
    await api.entries.remove(entry.id)
    refresh()
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

onMounted(() => {
  if (!store.stats) store.refreshStats().catch(() => {})
})
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>{{ t('library.title') }}</h1>
        <p>
          {{ t('library.subtitle', { count: store.totalEntries }) }}
        </p>
      </div>
      <div class="head-actions">
        <button class="btn btn-ghost" @click="ankiOpen = true">
          <Icon name="upload" :size="16" /> {{ t('library.importAnki') }}
        </button>
        <RouterLink to="/import" class="btn btn-ghost">
          <Icon name="upload" :size="16" /> {{ t('library.import') }}
        </RouterLink>
        <button class="btn btn-ghost" @click="exportOpen = true">
          <Icon name="download" :size="16" /> {{ t('export.title') }}
        </button>
        <button class="btn btn-primary" @click="openCreate">
          <Icon name="plus" :size="16" /> {{ t('library.addEntry') }}
        </button>
      </div>
    </header>

    <p v-if="error" class="banner banner-error">{{ error }}</p>

    <section class="toolbar card">
      <div class="search-box">
        <Icon name="search" :size="17" />
        <input
          v-model="q"
          class="search-input"
          :aria-label="t('library.searchLabel')"
          :placeholder="t('library.searchPlaceholder')"
        />
      </div>
      <div class="type-tabs">
        <button
          v-for="item in views"
          :key="item.value"
          class="type-tab"
          :class="{ active: view === item.value }"
          :title="t(item.hintKey)"
          :aria-pressed="view === item.value"
          @click="view = item.value"
        >
          {{ t(item.labelKey) }}
        </button>
      </div>
      <button class="icon-btn" :title="t('library.refresh')" :aria-label="t('library.refresh')" @click="refresh">
        <Icon name="refresh" :size="17" />
      </button>
    </section>

    <DateView
      v-if="view === 'date'"
      :query="query"
      :refresh-token="refreshToken"
      @open="openDetail"
      @edit="openEdit"
      @remove="remove"
    />
    <TypeView
      v-else-if="view === 'type'"
      :query="query"
      :refresh-token="refreshToken"
      @open="openDetail"
      @edit="openEdit"
      @remove="remove"
    />
    <TagView
      v-else-if="view === 'tag'"
      :query="query"
      :refresh-token="refreshToken"
      @open="openDetail"
      @edit="openEdit"
      @remove="remove"
    />
    <SceneView
      v-else
      :query="query"
      :refresh-token="refreshToken"
      @open="openDetail"
      @edit="openEdit"
      @remove="remove"
      @changed="refresh"
    />

    <EntryForm
      :open="formOpen"
      :entry="editing"
      @close="formOpen = false"
      @saved="onSaved"
    />

    <EntryDetailModal
      :entry="detail"
      @close="detail = null"
      @edit="editFromDetail"
    />

    <ExportModal :open="exportOpen" @close="exportOpen = false" />
    <AnkiImportModal :open="ankiOpen" @close="ankiOpen = false" @imported="onAnkiImported" />
  </div>
</template>

<style scoped>
.head-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.search-box {
  flex: 1;
  min-width: 220px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  border: var(--border-width, 0) solid var(--border-color, transparent);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--muted);
  box-shadow: var(--shadow-inset);
  transition: box-shadow var(--transition), border-color var(--transition);
}
.search-box:focus-within {
  box-shadow: var(--shadow-inset-focus);
}
.search-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--ink);
}
</style>
