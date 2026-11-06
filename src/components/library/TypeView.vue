<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import type { Entry, EntryType } from '@shared/types'
import { ENTRY_TYPE_LABELS } from '@shared/types'
import EntryCard from '@/components/EntryCard.vue'
import Icon from '@/components/Icon.vue'
import { api, errorMessage } from '@/lib/api'

const props = defineProps<{ query: string; refreshToken: number }>()
const emit = defineEmits<{ edit: [entry: Entry]; remove: [entry: Entry] }>()

const types: EntryType[] = ['word', 'phrase', 'sentence']
const groups = reactive<
  Record<EntryType, { items: Entry[]; total: number; loading: boolean }>
>({
  word: { items: [], total: 0, loading: false },
  phrase: { items: [], total: 0, loading: false },
  sentence: { items: [], total: 0, loading: false },
})
const visible = reactive<Record<EntryType, number>>({
  word: 20,
  phrase: 20,
  sentence: 20,
})
const expanded = ref<Set<EntryType>>(new Set())
const error = ref('')

const total = computed(() => types.reduce((sum, type) => sum + groups[type].total, 0))

function isExpanded(type: EntryType): boolean {
  return expanded.value.has(type)
}

function toggleExpanded(type: EntryType) {
  const next = new Set(expanded.value)
  if (next.has(type)) next.delete(type)
  else next.add(type)
  expanded.value = next
}

function previewText(type: EntryType): string {
  return groups[type].items
    .slice(0, 3)
    .map((entry) => entry.text)
    .join(' · ')
}

function visibleItems(type: EntryType): Entry[] {
  return groups[type].items.slice(0, visible[type])
}

function remaining(type: EntryType): number {
  return Math.max(groups[type].items.length - visible[type], 0)
}

function showMore(type: EntryType) {
  visible[type] += 20
}

async function loadType(type: EntryType) {
  const group = groups[type]
  group.loading = true
  try {
    const result = await api.entries.list({
      types: [type],
      q: props.query.trim() || undefined,
      limit: 500,
    })
    group.items = result.items
    group.total = result.total
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    group.loading = false
  }
}

async function load() {
  error.value = ''
  for (const type of types) visible[type] = 20
  await Promise.all(types.map(loadType))
}

watch(
  () => props.query,
  () => {
    expanded.value = props.query.trim() ? new Set(types) : new Set()
    load()
  },
)
watch(
  () => props.refreshToken,
  () => load(),
)
onMounted(load)
</script>

<template>
  <div class="type-view">
    <div class="section-head">
      <div>
        <h2>按词条类型</h2>
        <p class="hint">
          {{ query ? `“${query}” · ` : '' }}共 {{ total }} 条，按记录时间从新到旧排列。
        </p>
      </div>
    </div>

    <p v-if="error" class="banner banner-error">{{ error }}</p>

    <p v-if="types.every((type) => groups[type].loading)" class="empty">加载中…</p>
    <div v-else-if="total === 0" class="empty card">
      <h3>没有符合条件的词条</h3>
      <p>换个关键词，或去日期视图看看最近学了什么。</p>
    </div>

    <template v-else>
      <section
        v-for="type in types"
        :key="type"
        class="type-section card"
        :class="{ open: isExpanded(type) }"
      >
        <button
          class="type-head"
          type="button"
          :aria-expanded="isExpanded(type)"
          @click="toggleExpanded(type)"
        >
          <span class="type-title">
            <Icon
              :name="isExpanded(type) ? 'chevron-down' : 'chevron-right'"
              :size="16"
            />
            <span class="type-dot" :class="`dot-${type}`" aria-hidden="true" />
            <span class="type-name">{{ ENTRY_TYPE_LABELS[type] }}</span>
            <span class="type-count">{{ groups[type].total }}</span>
          </span>
          <span v-if="!isExpanded(type) && groups[type].loading" class="type-preview">
            加载中…
          </span>
          <span
            v-else-if="!isExpanded(type) && previewText(type)"
            class="type-preview"
          >
            {{ previewText(type) }} …
          </span>
        </button>

        <template v-if="isExpanded(type)">
          <p v-if="groups[type].loading" class="empty">加载中…</p>
          <p v-else-if="!groups[type].items.length" class="empty type-empty">
            这个分类下暂时没有词条。
          </p>
          <div v-else class="type-list">
            <EntryCard
              v-for="entry in visibleItems(type)"
              :key="entry.id"
              :entry="entry"
              compact
              @edit="emit('edit', $event)"
              @remove="emit('remove', $event)"
            />
            <button
              v-if="remaining(type) > 0"
              class="btn btn-ghost btn-sm show-more"
              @click="showMore(type)"
            >
              显示更多（还有 {{ remaining(type) }} 条）
            </button>
          </div>
        </template>
      </section>
    </template>
  </div>
</template>

<style scoped>
.type-view {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.section-head h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.section-head p {
  margin: 4px 0 0;
}
.type-section {
  padding: 20px 22px;
}
.type-section.open .type-head {
  margin-bottom: 14px;
}
.type-head {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  text-align: left;
  flex-wrap: wrap;
}
.type-head:hover .type-name {
  color: var(--accent-strong);
}
.type-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.type-name {
  font-size: 18px;
  font-weight: 600;
}
.type-preview {
  flex: 1 1 220px;
  min-width: 0;
  text-align: right;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.type-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.dot-word {
  background: #6d5dfc;
}
.dot-phrase {
  background: #b7791f;
}
.dot-sentence {
  background: #35597d;
}
.type-count {
  padding: 2px 9px;
  border-radius: var(--radius-sm);
  background: var(--bg-soft);
  color: var(--muted);
  font-size: 11.5px;
  font-weight: 600;
}
.type-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.show-more {
  align-self: flex-start;
  margin-top: 2px;
}
.type-empty {
  padding: 20px;
}
:deep(.entry-card) {
  box-shadow: none;
  border: var(--border-width, 0) solid var(--border-color, transparent);
  background: var(--bg-soft);
}
:deep(.entry-card:hover) {
  box-shadow: var(--shadow-hover-sm);
}
@media (max-width: 620px) {
  .type-preview {
    flex-basis: 100%;
    padding-left: 26px;
    text-align: left;
  }
}
</style>
