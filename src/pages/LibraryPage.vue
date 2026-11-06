<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import type { Entry } from '@shared/types'
import EntryForm from '@/components/EntryForm.vue'
import ExportModal from '@/components/ExportModal.vue'
import Icon from '@/components/Icon.vue'
import DateView from '@/components/library/DateView.vue'
import SceneView from '@/components/library/SceneView.vue'
import TypeView from '@/components/library/TypeView.vue'
import { api, errorMessage } from '@/lib/api'
import { truncate } from '@/lib/format'
import { useAppStore } from '@/stores/app'

type ViewMode = 'date' | 'type' | 'scene'

const store = useAppStore()

const view = ref<ViewMode>('date')
const q = ref('')
const query = ref('')
const refreshToken = ref(0)
const formOpen = ref(false)
const exportOpen = ref(false)
const editing = ref<Entry | null>(null)
const error = ref('')
let timer: number | undefined

const views: Array<{ value: ViewMode; label: string; hint: string }> = [
  { value: 'date', label: '按日期', hint: '先看日期，再看当天内容' },
  { value: 'type', label: '按类型', hint: '单词 / 短语 / 句子' },
  { value: 'scene', label: '按场景', hint: '联想记忆空间' },
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

async function onSaved() {
  editing.value = null
  refresh()
}

async function remove(entry: Entry) {
  if (!window.confirm(`删除“${truncate(entry.text, 40)}”？此操作不可恢复。`)) return
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
        <h1>词库</h1>
        <p>
          共 {{ store.totalEntries }} 条记录 · 按日期、类型或场景整理自己的英语材料。
        </p>
      </div>
      <div class="head-actions">
        <RouterLink to="/import" class="btn btn-ghost">
          <Icon name="upload" :size="16" /> 导入 Markdown
        </RouterLink>
        <button class="btn btn-ghost" @click="exportOpen = true">
          <Icon name="download" :size="16" /> 导出 Markdown
        </button>
        <button class="btn btn-primary" @click="openCreate">
          <Icon name="plus" :size="16" /> 添加词条
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
          aria-label="搜索词条或场景"
          placeholder="搜索英文、中文释义、笔记或场景…"
        />
      </div>
      <div class="type-tabs">
        <button
          v-for="item in views"
          :key="item.value"
          class="type-tab"
          :class="{ active: view === item.value }"
          :title="item.hint"
          :aria-pressed="view === item.value"
          @click="view = item.value"
        >
          {{ item.label }}
        </button>
      </div>
      <button class="icon-btn" title="刷新" aria-label="刷新词库" @click="refresh">
        <Icon name="refresh" :size="17" />
      </button>
    </section>

    <DateView
      v-if="view === 'date'"
      :query="query"
      :refresh-token="refreshToken"
      @edit="openEdit"
      @remove="remove"
    />
    <TypeView
      v-else-if="view === 'type'"
      :query="query"
      :refresh-token="refreshToken"
      @edit="openEdit"
      @remove="remove"
    />
    <SceneView
      v-else
      :query="query"
      :refresh-token="refreshToken"
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

    <ExportModal :open="exportOpen" @close="exportOpen = false" />
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
