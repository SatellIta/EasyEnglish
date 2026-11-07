<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  BulkDeleteFilter,
  EntryType,
  LibraryOverview,
  TagSummary,
} from '@shared/types'
import BaseModal from '@/components/BaseModal.vue'
import { entryTypeLabel, locale, t } from '@/i18n'
import { api, errorMessage } from '@/lib/api'

type Category = 'type' | 'tag' | 'date' | 'scene'
type Option = { key: string; label: string; count: number }

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; deleted: [count: number] }>()

const CATEGORIES: Array<{ id: Category; labelKey: Parameters<typeof t>[0] }> = [
  { id: 'type', labelKey: 'library.bulkDelete.category.type' },
  { id: 'tag', labelKey: 'library.bulkDelete.category.tag' },
  { id: 'date', labelKey: 'library.bulkDelete.category.date' },
  { id: 'scene', labelKey: 'library.bulkDelete.category.scene' },
]

const category = ref<Category>('type')
const overview = ref<LibraryOverview | null>(null)
const tags = ref<TagSummary[]>([])
const selected = ref<Set<string>>(new Set())
const loading = ref(false)
const previewing = ref(false)
const previewCount = ref(0)
const confirming = ref(false)
const deleting = ref(false)
const error = ref('')
let previewTimer: number | undefined
let previewToken = 0

const options = computed<Option[]>(() => {
  if (category.value === 'type') {
    const counts = overview.value?.types
    if (!counts) return []
    return (['word', 'phrase', 'sentence'] as EntryType[]).map((type) => ({
      key: `type:${type}`,
      label: entryTypeLabel(type),
      count: counts[type],
    }))
  }
  if (category.value === 'tag') {
    return tags.value.map((item) => ({
      key: `tag:${item.tag}`,
      label: `# ${item.tag}`,
      count: item.count,
    }))
  }
  if (category.value === 'date') {
    return (overview.value?.dates ?? []).map((group) => ({
      key: `date:${group.date}`,
      label: dateLabel(group.date),
      count: group.total,
    }))
  }
  return (overview.value?.scenes ?? []).map((scene) => ({
    key: `scene:${scene.id}`,
    label: scene.name,
    count: scene.counts.total,
  }))
})

const allSelected = computed(
  () => options.value.length > 0 && options.value.every((item) => selected.value.has(item.key)),
)

const filter = computed<BulkDeleteFilter>(() => {
  const keys = [...selected.value].map((key) => key.slice(key.indexOf(':') + 1))
  if (category.value === 'type') return { types: keys as EntryType[] }
  if (category.value === 'tag') return { tags: keys }
  if (category.value === 'date') return { dates: keys }
  return { sceneIds: keys.map(Number).filter((id) => Number.isInteger(id) && id > 0) }
})

function dateLabel(value: string): string {
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat(locale.value === 'en' ? 'en-US' : 'zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(year, month - 1, day))
}

function reset() {
  selected.value = new Set()
  confirming.value = false
  previewCount.value = 0
  previewing.value = false
  error.value = ''
  window.clearTimeout(previewTimer)
  previewToken += 1
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [overviewData, tagData] = await Promise.all([
      api.library.overview(),
      api.tags.list(),
    ])
    overview.value = overviewData
    tags.value = tagData.items
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

async function refreshPreview() {
  if (!selected.value.size) {
    previewCount.value = 0
    previewing.value = false
    return
  }
  const token = ++previewToken
  previewing.value = true
  try {
    const result = await api.entries.previewBulkDelete({ filter: filter.value })
    if (token !== previewToken) return
    previewCount.value = result.count
  } catch (caught) {
    if (token === previewToken) {
      error.value = errorMessage(caught)
      previewCount.value = 0
    }
  } finally {
    if (token === previewToken) previewing.value = false
  }
}

function schedulePreview() {
  confirming.value = false
  error.value = ''
  window.clearTimeout(previewTimer)
  if (!selected.value.size) {
    previewToken += 1
    previewCount.value = 0
    previewing.value = false
    return
  }
  previewing.value = true
  previewTimer = window.setTimeout(refreshPreview, 250)
}

function toggle(key: string) {
  const next = new Set(selected.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selected.value = next
}

function selectAll() {
  if (allSelected.value) {
    selected.value = new Set()
    return
  }
  selected.value = new Set(options.value.map((item) => item.key))
}

function changeCategory(next: Category) {
  if (category.value === next) return
  category.value = next
  reset()
}

async function remove() {
  if (!selected.value.size || deleting.value || previewing.value) return
  if (!confirming.value) {
    confirming.value = true
    await refreshPreview()
    return
  }

  deleting.value = true
  error.value = ''
  try {
    const result = await api.entries.bulkDelete({ filter: filter.value })
    emit('deleted', result.deleted)
    reset()
    emit('close')
  } catch (caught) {
    error.value = errorMessage(caught)
    confirming.value = false
  } finally {
    deleting.value = false
  }
}

function requestClose() {
  if (deleting.value) return
  reset()
  emit('close')
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      category.value = 'type'
      reset()
      load()
    }
  },
)

watch([category, selected], () => schedulePreview())
</script>

<template>
  <BaseModal
    :open="open"
    :title="t('library.bulkDelete.title')"
    width="720px"
    @close="requestClose"
  >
    <div class="bulk-delete">
      <p class="hint">{{ t('library.bulkDelete.hint') }}</p>

      <div class="type-tabs" role="tablist" :aria-label="t('library.bulkDelete.title')">
        <button
          v-for="item in CATEGORIES"
          :key="item.id"
          class="type-tab"
          type="button"
          role="tab"
          :class="{ active: category === item.id }"
          :aria-selected="category === item.id"
          @click="changeCategory(item.id)"
        >
          {{ t(item.labelKey) }}
        </button>
      </div>

      <div class="bulk-toolbar">
        <span class="muted small">
          {{
            selected.size
              ? t('library.bulkDelete.selectedCount', { count: selected.size })
              : t('library.bulkDelete.noneSelected')
          }}
        </span>
        <button
          class="btn btn-ghost btn-sm"
          type="button"
          :disabled="!options.length"
          @click="selectAll"
        >
          {{ allSelected ? t('library.bulkDelete.selectNone') : t('library.bulkDelete.selectAll') }}
        </button>
      </div>

      <p v-if="loading" class="empty">{{ t('common.loading') }}</p>
      <p v-else-if="!options.length" class="empty">{{ t('library.bulkDelete.empty') }}</p>
      <div v-else class="option-list">
        <label v-for="item in options" :key="item.key" class="bulk-option">
          <input
            type="checkbox"
            :checked="selected.has(item.key)"
            @change="toggle(item.key)"
          />
          <span class="option-label">{{ item.label }}</span>
          <span class="option-count">{{ item.count }}</span>
        </label>
      </div>

      <p v-if="category === 'scene'" class="banner banner-info">
        {{ t('library.bulkDelete.sceneWarning') }}
      </p>
      <p v-if="error" class="banner banner-error">{{ error }}</p>
      <p v-if="confirming && !error" class="banner banner-error">
        {{ t('library.bulkDelete.confirmHint', { count: previewCount }) }}
      </p>
    </div>

    <template #footer>
      <div class="bulk-actions">
        <button class="btn btn-ghost" type="button" :disabled="deleting" @click="requestClose">
          {{ t('common.cancel') }}
        </button>
        <button
          class="btn btn-danger"
          type="button"
          :disabled="!selected.size || previewing || deleting || previewCount === 0"
          @click="remove"
        >
          {{
            deleting
              ? t('library.bulkDelete.deleting')
              : confirming
                ? t('library.bulkDelete.confirm', { count: previewCount })
                : t('library.bulkDelete.submit')
          }}
        </button>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
.bulk-delete {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.type-tabs {
  align-self: flex-start;
}
.bulk-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.option-list {
  max-height: min(46vh, 420px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px;
  border-radius: var(--radius-sm);
  background: var(--bg);
  box-shadow: var(--shadow-inset-sm);
}
.bulk-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color var(--transition);
}
.bulk-option:hover {
  background: var(--bg-soft);
}
.bulk-option input {
  flex: 0 0 auto;
}
.option-label {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.option-count {
  flex: 0 0 auto;
  padding: 1px 8px;
  border-radius: var(--radius-sm);
  background: var(--bg-soft);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--muted);
}
.bulk-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}
</style>
