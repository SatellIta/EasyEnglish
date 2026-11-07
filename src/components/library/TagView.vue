<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Entry, EntrySort, TagSummary } from '@shared/types'
import EntryCard from '@/components/EntryCard.vue'
import Icon from '@/components/Icon.vue'
import { t } from '@/i18n'
import { api, errorMessage } from '@/lib/api'

const props = defineProps<{ query: string; refreshToken: number }>()
const emit = defineEmits<{
  open: [entry: Entry]
  edit: [entry: Entry]
  remove: [entry: Entry]
}>()

const SORT_KEY = 'easyenglish.libraryTagSort'
const SORT_OPTIONS: Array<{ value: EntrySort; key: Parameters<typeof t>[0] }> = [
  { value: 'newest', key: 'library.sort.newest' },
  { value: 'oldest', key: 'library.sort.oldest' },
  { value: 'alpha', key: 'library.sort.alpha' },
  { value: 'alphaDesc', key: 'library.sort.alphaDesc' },
]
const PAGE_SIZE = 40

const tags = ref<TagSummary[]>([])
const activeTag = ref<string | null>(null)
const sort = ref<EntrySort>(readSort())
const entries = ref<Entry[]>([])
const total = ref(0)
const visible = ref(PAGE_SIZE)
const loadingTags = ref(false)
const loadingList = ref(false)
const error = ref('')

const isSearching = computed(() => Boolean(props.query.trim()))
const showingList = computed(() => Boolean(activeTag.value) || isSearching.value)
const shownEntries = computed(() => entries.value.slice(0, visible.value))
const remaining = computed(() => Math.max(entries.value.length - visible.value, 0))
const summaryText = computed(() => {
  if (isSearching.value) {
    return t('library.date.searchSummary', {
      query: props.query.trim(),
      total: total.value,
    })
  }
  return t('library.tag.summary', {
    tag: activeTag.value ?? '',
    total: total.value,
  })
})

function readSort(): EntrySort {
  try {
    const saved = localStorage.getItem(SORT_KEY)
    if (
      saved === 'newest' ||
      saved === 'oldest' ||
      saved === 'alpha' ||
      saved === 'alphaDesc'
    ) {
      return saved
    }
  } catch {
    // ignore private-mode storage errors
  }
  return 'newest'
}

watch(sort, (value) => {
  try {
    localStorage.setItem(SORT_KEY, value)
  } catch {
    // ignore private-mode storage errors
  }
  if (showingList.value) loadEntries()
})

async function loadTags() {
  loadingTags.value = true
  try {
    const data = await api.tags.list()
    tags.value = data.items
    if (
      activeTag.value &&
      !data.items.some((item) => item.tag === activeTag.value)
    ) {
      activeTag.value = null
    }
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loadingTags.value = false
  }
}

async function loadEntries() {
  loadingList.value = true
  error.value = ''
  visible.value = PAGE_SIZE
  try {
    const result = await api.entries.list({
      q: props.query.trim() || undefined,
      tag: activeTag.value ?? undefined,
      sort: sort.value,
      limit: 500,
    })
    entries.value = result.items
    total.value = result.total
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loadingList.value = false
  }
}

async function bootstrap() {
  error.value = ''
  await loadTags()
  if (showingList.value) await loadEntries()
}

function openTag(tag: string) {
  activeTag.value = tag
  visible.value = PAGE_SIZE
  loadEntries()
}

function backToTags() {
  activeTag.value = null
  entries.value = []
  total.value = 0
  if (isSearching.value) loadEntries()
}

function showMore() {
  visible.value += PAGE_SIZE
}

watch(
  () => props.query,
  () => bootstrap(),
)
watch(
  () => props.refreshToken,
  () => bootstrap(),
)

onMounted(bootstrap)
</script>

<template>
  <div class="tag-view">
    <p v-if="error" class="banner banner-error">{{ error }}</p>

    <template v-if="!showingList">
      <div class="section-head">
        <div>
          <h2>{{ t('library.tag.title') }}</h2>
          <p class="hint">{{ t('library.tag.hint') }}</p>
        </div>
        <span class="muted small">{{ tags.length }}</span>
      </div>

      <p v-if="loadingTags && !tags.length" class="empty">{{ t('common.loading') }}</p>
      <div v-else-if="!tags.length" class="empty card">
        <h3>{{ t('library.tag.emptyTitle') }}</h3>
        <p>{{ t('library.tag.emptyHint') }}</p>
      </div>
      <div v-else class="tag-grid">
        <button
          v-for="item in tags"
          :key="item.tag"
          class="tag-card card"
          type="button"
          @click="openTag(item.tag)"
        >
          <span class="tag-name">
            <span class="hash" aria-hidden="true">#</span>{{ item.tag }}
          </span>
          <span class="tag-counts">
            <span>{{ t('library.tag.count', { count: item.count }) }}</span>
            <span v-if="item.unlearned > 0" class="tag-unlearned">
              {{ t('library.tag.unlearned', { count: item.unlearned }) }}
            </span>
          </span>
        </button>
      </div>
    </template>

    <template v-else>
      <div class="detail-head">
        <button
          v-if="activeTag"
          class="btn btn-ghost btn-sm"
          type="button"
          @click="backToTags"
        >
          <Icon name="chevron-left" :size="15" /> {{ t('library.tag.back') }}
        </button>
        <div class="detail-title">
          <h2>
            <span v-if="activeTag" class="hash" aria-hidden="true">#</span>{{ activeTag ?? t('library.date.searchTitle') }}
          </h2>
          <span class="muted small">{{ summaryText }}</span>
        </div>
      </div>

      <div class="sort-row">
        <span class="sort-label">{{ t('library.sort.label') }}</span>
        <div class="type-tabs" role="group" :aria-label="t('library.sort.label')">
          <button
            v-for="option in SORT_OPTIONS"
            :key="option.value"
            class="type-tab"
            type="button"
            :class="{ active: sort === option.value }"
            :aria-pressed="sort === option.value"
            @click="sort = option.value"
          >
            {{ t(option.key) }}
          </button>
        </div>
      </div>

      <p v-if="loadingList && !entries.length" class="empty">{{ t('common.loading') }}</p>
      <div v-else-if="!entries.length" class="empty card">
        <h3>{{ t('library.tag.noMatchTitle') }}</h3>
        <p>{{ t('library.tag.noMatchHint') }}</p>
      </div>
      <div v-else class="lib-list">
        <EntryCard
          v-for="entry in shownEntries"
          :key="entry.id"
          :entry="entry"
          @open="emit('open', $event)"
          @edit="emit('edit', $event)"
          @remove="emit('remove', $event)"
        />
        <button
          v-if="remaining > 0"
          class="btn btn-ghost btn-sm show-more"
          type="button"
          @click="showMore"
        >
          {{ t('library.date.showMore', { count: remaining }) }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tag-view {
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
.detail-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.detail-title .hash,
.tag-name .hash {
  color: var(--accent-strong);
  margin-right: 3px;
}
.tag-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
}
.tag-card {
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
.tag-card:hover {
  box-shadow: var(--shadow-hover);
}
.tag-card:active {
  box-shadow: var(--shadow-pressed);
}
.tag-name {
  font-size: 17px;
  font-weight: 600;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.tag-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: var(--muted);
}
.tag-unlearned {
  color: var(--accent-strong);
  font-weight: 600;
}
.sort-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.sort-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}
.lib-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.show-more {
  align-self: flex-start;
}
</style>
