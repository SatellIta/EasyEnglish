<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { Entry, EntryType } from '@shared/types'
import { ENTRY_TYPE_LABELS } from '@shared/types'
import EntryForm from '@/components/EntryForm.vue'
import Icon from '@/components/Icon.vue'
import SpeakButton from '@/components/SpeakButton.vue'
import TypeBadge from '@/components/TypeBadge.vue'
import { api, errorMessage } from '@/lib/api'
import { formatDue, stageLabel, truncate } from '@/lib/format'
import { useAppStore } from '@/stores/app'

const store = useAppStore()

const entries = ref<Entry[]>([])
const total = ref(0)
const q = ref('')
const activeType = ref<EntryType | 'all'>('all')
const loading = ref(false)
const error = ref('')
const formOpen = ref(false)
const editing = ref<Entry | null>(null)
let timer: number | undefined

const typeFilters: Array<{ value: EntryType | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'word', label: ENTRY_TYPE_LABELS.word },
  { value: 'phrase', label: ENTRY_TYPE_LABELS.phrase },
  { value: 'sentence', label: ENTRY_TYPE_LABELS.sentence },
]

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await api.entries.list({
      q: q.value.trim() || undefined,
      types: activeType.value === 'all' ? undefined : [activeType.value],
      limit: 300,
    })
    entries.value = result.items
    total.value = result.total
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

watch(q, () => {
  window.clearTimeout(timer)
  timer = window.setTimeout(load, 250)
})

watch(activeType, load)

function openCreate() {
  editing.value = null
  formOpen.value = true
}

function openEdit(entry: Entry) {
  editing.value = entry
  formOpen.value = true
}

async function onSaved() {
  await load()
  await store.refreshStats()
}

async function remove(entry: Entry) {
  if (!window.confirm(`删除“${truncate(entry.text, 40)}”？此操作不可恢复。`)) return
  try {
    await api.entries.remove(entry.id)
    await load()
    await store.refreshStats()
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>词库</h1>
        <p>共 {{ total }} 条记录 · 单词、短语和句子都可以放在这里。</p>
      </div>
      <button class="btn btn-primary" @click="openCreate">
        <Icon name="plus" :size="16" /> 添加词条
      </button>
    </header>

    <p v-if="error" class="banner banner-error">{{ error }}</p>

    <section class="toolbar card">
      <div class="search-box">
        <Icon name="search" :size="17" />
        <input
          v-model="q"
          class="search-input"
          aria-label="搜索词条"
          placeholder="搜索英文、中文释义或笔记…"
        />
      </div>
      <div class="type-tabs">
        <button
          v-for="filter in typeFilters"
          :key="filter.value"
          class="type-tab"
          :class="{ active: activeType === filter.value }"
          @click="activeType = filter.value"
        >
          {{ filter.label }}
        </button>
      </div>
      <button class="icon-btn" title="刷新" aria-label="刷新词条列表" @click="load">
        <Icon name="refresh" :size="17" />
      </button>
    </section>

    <p v-if="loading && !entries.length" class="empty">加载中…</p>

    <div v-else-if="!entries.length" class="empty card">
      <h3>词库还是空的</h3>
      <p>把遇到的词句记下来，复习时它们会按遗忘曲线出现。</p>
      <button class="btn btn-primary" @click="openCreate">
        <Icon name="plus" :size="16" /> 添加第一条
      </button>
    </div>

    <div v-else class="lib-list">
      <article v-for="entry in entries" :key="entry.id" class="lib-row card">
        <div class="lib-main">
          <div class="row wrap lib-title">
            <TypeBadge :type="entry.type" />
            <h3>{{ entry.text }}</h3>
            <SpeakButton :text="entry.text" />
          </div>
          <p v-if="entry.meaning" class="lib-meaning">{{ entry.meaning }}</p>
          <p v-if="entry.explanation" class="lib-explain">
            {{ truncate(entry.explanation, 180) }}
          </p>
          <div class="row wrap lib-meta">
            <span v-for="tag in entry.tags" :key="tag" class="tag">{{ tag }}</span>
            <span v-if="entry.review" class="muted small review-info">
              <Icon name="clock" :size="13" />
              下次复习 {{ formatDue(entry.review.nextReviewAt) }} · {{ stageLabel(entry.review.stage) }}
            </span>
          </div>
        </div>
        <div class="lib-actions">
          <button class="icon-btn" title="编辑" aria-label="编辑词条" @click="openEdit(entry)">
            <Icon name="edit" :size="17" />
          </button>
          <button class="icon-btn danger" title="删除" aria-label="删除词条" @click="remove(entry)">
            <Icon name="trash" :size="17" />
          </button>
        </div>
      </article>
    </div>

    <EntryForm
      :open="formOpen"
      :entry="editing"
      @close="formOpen = false"
      @saved="onSaved"
    />
  </div>
</template>

<style scoped>
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
  border: 0;
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--muted);
  box-shadow: var(--shadow-inset);
  transition: box-shadow var(--transition);
}
.search-box:focus-within {
  box-shadow: var(--shadow-inset-focus);
  outline: 2px solid rgba(109, 93, 252, 0.4);
  outline-offset: 3px;
}
.search-input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--ink);
}
.search-input::placeholder {
  color: var(--muted);
}
.type-tabs {
  display: flex;
  gap: 6px;
  padding: 5px;
  border-radius: var(--radius-sm);
  background: var(--bg);
  box-shadow: var(--shadow-inset-sm);
}
.type-tab {
  border: 0;
  background: transparent;
  border-radius: 12px;
  padding: 7px 13px;
  font-size: 13px;
  color: var(--muted);
  font-weight: 500;
  box-shadow: none;
  transition: box-shadow var(--transition), color var(--transition);
}
.type-tab:hover {
  color: var(--ink);
}
.type-tab.active {
  background: var(--bg);
  color: var(--accent-strong);
  box-shadow: var(--shadow-raised-sm);
  font-weight: 600;
}
.type-tab:active {
  box-shadow: var(--shadow-pressed);
}
.type-tab.active:hover {
  box-shadow: var(--shadow-hover-sm);
}
.lib-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.lib-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 22px;
}
.lib-main {
  min-width: 0;
}
.lib-title {
  gap: 9px;
}
.lib-title h3 {
  margin: 0;
  flex: 1 1 0;
  min-width: 0;
  font-size: 19px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.lib-meaning {
  margin: 8px 0 0;
  font-size: 14px;
  color: var(--ink-soft);
}
.lib-explain {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.65;
  overflow-wrap: anywhere;
}
.lib-meta {
  margin-top: 12px;
  gap: 8px;
}
.review-info {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.lib-actions {
  display: flex;
  gap: 6px;
  flex: 0 0 auto;
}
.icon-btn.danger:hover {
  color: var(--danger);
}
</style>
