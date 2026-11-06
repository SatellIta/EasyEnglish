<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Entry, EntryType, LibraryOverview } from '@shared/types'
import { ENTRY_TYPE_LABELS } from '@shared/types'
import EntryCard from '@/components/EntryCard.vue'
import Icon from '@/components/Icon.vue'
import { api, errorMessage } from '@/lib/api'

const props = defineProps<{ query: string; refreshToken: number }>()
const emit = defineEmits<{ edit: [entry: Entry]; remove: [entry: Entry] }>()

const overview = ref<LibraryOverview | null>(null)
const activeDate = ref<string | null>(null)
const activeType = ref<EntryType | 'all'>('all')
const entries = ref<Entry[]>([])
const total = ref(0)
const searchResults = ref<Entry[]>([])
const searchTotal = ref(0)
const visibleEntries = ref(40)
const visibleSearch = ref(50)
const loadingOverview = ref(false)
const loadingList = ref(false)
const error = ref('')

const typeFilters: Array<{ value: EntryType | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'word', label: ENTRY_TYPE_LABELS.word },
  { value: 'phrase', label: ENTRY_TYPE_LABELS.phrase },
  { value: 'sentence', label: ENTRY_TYPE_LABELS.sentence },
]

const isSearching = computed(() => Boolean(props.query.trim()))
const activeGroup = computed(
  () => overview.value?.dates.find((group) => group.date === activeDate.value) ?? null,
)
const shownEntries = computed(() => entries.value.slice(0, visibleEntries.value))
const shownSearch = computed(() => searchResults.value.slice(0, visibleSearch.value))
const remainingEntries = computed(() =>
  Math.max(entries.value.length - visibleEntries.value, 0),
)
const remainingSearch = computed(() =>
  Math.max(searchResults.value.length - visibleSearch.value, 0),
)

function showMoreEntries() {
  visibleEntries.value += 40
}

function showMoreSearch() {
  visibleSearch.value += 50
}

function dateLabel(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date)
}

function relativeLabel(value: string): string {
  const today = new Date()
  const [year, month, day] = value.split('-').map(Number)
  const target = new Date(year, month - 1, day)
  const todayKey = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const diff = Math.round((todayKey.getTime() - target.getTime()) / 86_400_000)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  if (diff > 1 && diff < 7) return `${diff} 天前`
  return year === today.getFullYear() ? '' : `${year} 年`
}

async function loadOverview() {
  loadingOverview.value = true
  try {
    overview.value = await api.library.overview()
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loadingOverview.value = false
  }
}

async function loadDate() {
  if (!activeDate.value) return
  loadingList.value = true
  error.value = ''
  visibleEntries.value = 40
  try {
    const result = await api.library.date(activeDate.value, {
      type: activeType.value === 'all' ? undefined : activeType.value,
      q: props.query.trim() || undefined,
    })
    entries.value = result.items
    total.value = result.total
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loadingList.value = false
  }
}

async function loadSearch() {
  if (!isSearching.value) return
  loadingList.value = true
  error.value = ''
  visibleSearch.value = 50
  try {
    const result = await api.entries.list({ q: props.query.trim(), limit: 500 })
    searchResults.value = result.items
    searchTotal.value = result.total
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loadingList.value = false
  }
}

async function bootstrap() {
  error.value = ''
  await loadOverview()
  if (isSearching.value) await loadSearch()
  else if (activeDate.value) await loadDate()
}

function openDate(date: string) {
  activeDate.value = date
  activeType.value = 'all'
  loadDate()
}

function backToDates() {
  activeDate.value = null
  activeType.value = 'all'
}

function entriesFor(type: EntryType): number {
  if (activeGroup.value) return activeGroup.value[type]
  return overview.value?.types[type] ?? 0
}

watch(
  () => props.query,
  () => bootstrap(),
)

watch(
  () => props.refreshToken,
  () => bootstrap(),
)

watch(activeType, () => {
  if (activeDate.value) loadDate()
})

onMounted(bootstrap)
</script>

<template>
  <div class="date-view">
    <p v-if="error" class="banner banner-error">{{ error }}</p>

    <section v-if="isSearching" class="search-results">
      <div class="section-head">
        <div>
          <h2>搜索结果</h2>
          <p class="hint">“{{ query }}” · 共 {{ searchTotal }} 条</p>
        </div>
      </div>
      <p v-if="loadingList && !searchResults.length" class="empty">搜索中…</p>
      <div v-else-if="!searchResults.length" class="empty card">
        <h3>没有匹配的词条</h3>
        <p>试试更短的关键词，或切换到其他分类。</p>
      </div>
      <div v-else class="lib-list">
        <EntryCard
          v-for="entry in shownSearch"
          :key="entry.id"
          :entry="entry"
          @edit="emit('edit', $event)"
          @remove="emit('remove', $event)"
        />
        <button
          v-if="remainingSearch > 0"
          class="btn btn-ghost btn-sm show-more"
          @click="showMoreSearch"
        >
          显示更多（还有 {{ remainingSearch }} 条）
        </button>
      </div>
    </section>

    <template v-else-if="activeDate">
      <div class="detail-head">
        <button class="btn btn-ghost btn-sm" @click="backToDates">
          <Icon name="chevron-left" :size="15" /> 返回日期
        </button>
        <div class="detail-title">
          <h2>{{ dateLabel(activeDate) }}</h2>
          <span class="muted small">{{ relativeLabel(activeDate) }} · {{ total }} 条</span>
        </div>
      </div>

      <div class="type-tabs date-tabs">
        <button
          v-for="filter in typeFilters"
          :key="filter.value"
          class="type-tab"
          :class="{ active: activeType === filter.value }"
          :aria-pressed="activeType === filter.value"
          @click="activeType = filter.value"
        >
          {{ filter.label }}
          <span class="tab-count">
            {{ filter.value === 'all' ? activeGroup?.total ?? 0 : entriesFor(filter.value) }}
          </span>
        </button>
      </div>

      <p v-if="loadingList && !entries.length" class="empty">加载中…</p>
      <div v-else-if="!entries.length" class="empty card">
        <h3>这一天没有符合条件的词条</h3>
        <p>换个类型看看，或者回到日期列表。</p>
      </div>
      <div v-else class="lib-list">
        <EntryCard
          v-for="entry in shownEntries"
          :key="entry.id"
          :entry="entry"
          @edit="emit('edit', $event)"
          @remove="emit('remove', $event)"
        />
        <button
          v-if="remainingEntries > 0"
          class="btn btn-ghost btn-sm show-more"
          @click="showMoreEntries"
        >
          显示更多（还有 {{ remainingEntries }} 条）
        </button>
      </div>
    </template>

    <template v-else>
      <div class="section-head">
        <div>
          <h2>按学习日期</h2>
          <p class="hint">先选一天，再按单词、短语、句子查看当天新学的内容。</p>
        </div>
        <span class="muted small">{{ overview?.dates.length ?? 0 }} 天</span>
      </div>

      <p v-if="loadingOverview && !overview" class="empty">加载中…</p>
      <div v-else-if="!overview?.dates.length" class="empty card">
        <h3>还没有学习记录</h3>
        <p>添加词条或导入 Markdown 后，这里会按日期自动归档。</p>
      </div>
      <div v-else class="date-grid">
        <button
          v-for="group in overview.dates"
          :key="group.date"
          class="date-card card"
          @click="openDate(group.date)"
        >
          <span class="date-top">
            <strong>{{ dateLabel(group.date) }}</strong>
            <span v-if="relativeLabel(group.date)" class="date-relative">
              {{ relativeLabel(group.date) }}
            </span>
          </span>
          <span class="date-total">{{ group.total }} 条</span>
          <span class="date-counts">
            <span>单词 {{ group.word }}</span>
            <span>短语 {{ group.phrase }}</span>
            <span>句子 {{ group.sentence }}</span>
          </span>
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.date-view {
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
.section-head h2,
.detail-title h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.section-head p {
  margin: 4px 0 0;
}
.date-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 14px;
}
.date-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 18px 20px;
  text-align: left;
  color: var(--ink);
  transition: box-shadow var(--transition), border-color var(--transition),
    background-color var(--transition);
}
.date-card:hover {
  box-shadow: var(--shadow-hover);
}
.date-card:active {
  box-shadow: var(--shadow-pressed);
}
.date-top {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.date-top strong {
  font-size: 18px;
  font-weight: 600;
}
.date-relative {
  font-size: 11px;
  color: var(--accent-strong);
  font-weight: 600;
}
.date-total {
  font-size: 13px;
  color: var(--ink-soft);
}
.date-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11.5px;
  color: var(--muted);
}
.detail-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.date-tabs {
  align-self: flex-start;
}
.tab-count {
  margin-left: 6px;
  font-size: 11px;
  opacity: 0.7;
}
.lib-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.show-more {
  align-self: flex-start;
}
.search-results {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
</style>
