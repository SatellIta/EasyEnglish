<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Entry, EntryType, LibraryOverview } from '@shared/types'
import EntryCard from '@/components/EntryCard.vue'
import Icon from '@/components/Icon.vue'
import { entryTypeLabel, locale, t } from '@/i18n'
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

const typeFilterValues: Array<EntryType | 'all'> = ['all', 'word', 'phrase', 'sentence']

function filterLabel(value: EntryType | 'all'): string {
  return value === 'all' ? t('common.all') : entryTypeLabel(value)
}

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
  return new Intl.DateTimeFormat(locale.value === 'en' ? 'en-US' : 'zh-CN', {
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
  if (diff === 0) return t('library.date.relativeToday')
  if (diff === 1) return t('library.date.relativeYesterday')
  if (diff > 1 && diff < 7) return t('library.date.daysAgo', { count: diff })
  return year === today.getFullYear() ? '' : t('library.date.year', { year })
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
          <h2>{{ t('library.date.searchTitle') }}</h2>
          <p class="hint">{{ t('library.date.searchSummary', { query, total: searchTotal }) }}</p>
        </div>
      </div>
      <p v-if="loadingList && !searchResults.length" class="empty">{{ t('library.date.searching') }}</p>
      <div v-else-if="!searchResults.length" class="empty card">
        <h3>{{ t('library.date.noSearchTitle') }}</h3>
        <p>{{ t('library.date.noSearchHint') }}</p>
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
          {{ t('library.date.showMore', { count: remainingSearch }) }}
        </button>
      </div>
    </section>

    <template v-else-if="activeDate">
      <div class="detail-head">
        <button class="btn btn-ghost btn-sm" @click="backToDates">
          <Icon name="chevron-left" :size="15" /> {{ t('library.date.back') }}
        </button>
        <div class="detail-title">
          <h2>{{ dateLabel(activeDate) }}</h2>
          <span class="muted small">{{ t('library.date.daySummary', { relative: relativeLabel(activeDate), total }) }}</span>
        </div>
      </div>

      <div class="type-tabs date-tabs">
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
            {{ filter === 'all' ? activeGroup?.total ?? 0 : entriesFor(filter) }}
          </span>
        </button>
      </div>

      <p v-if="loadingList && !entries.length" class="empty">{{ t('common.loading') }}</p>
      <div v-else-if="!entries.length" class="empty card">
        <h3>{{ t('library.date.emptyTitle') }}</h3>
        <p>{{ t('library.date.emptyHint') }}</p>
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
          {{ t('library.date.showMore', { count: remainingEntries }) }}
        </button>
      </div>
    </template>

    <template v-else>
      <div class="section-head">
        <div>
          <h2>{{ t('library.date.title') }}</h2>
          <p class="hint">{{ t('library.date.hint') }}</p>
        </div>
        <span class="muted small">{{ t('library.date.daysCount', { count: overview?.dates.length ?? 0 }) }}</span>
      </div>

      <p v-if="loadingOverview && !overview" class="empty">{{ t('common.loading') }}</p>
      <div v-else-if="!overview?.dates.length" class="empty card">
        <h3>{{ t('library.date.noRecordsTitle') }}</h3>
        <p>{{ t('library.date.noRecordsHint') }}</p>
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
          <span class="date-total">{{ t('library.date.count', { count: group.total }) }}</span>
          <span class="date-counts">
            <span>{{ entryTypeLabel('word') }} {{ group.word }}</span>
            <span>{{ entryTypeLabel('phrase') }} {{ group.phrase }}</span>
            <span>{{ entryTypeLabel('sentence') }} {{ group.sentence }}</span>
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
