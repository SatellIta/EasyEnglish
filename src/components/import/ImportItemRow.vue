<script setup lang="ts">
import type { EntryType, ImportItem } from '@shared/types'
import TypeBadge from '@/components/TypeBadge.vue'

const props = defineProps<{
  item: ImportItem
  selected: boolean
  showScenePath?: boolean
}>()
const emit = defineEmits<{ toggle: [id: string] }>()

const types: EntryType[] = ['word', 'phrase', 'sentence']
const labels: Record<EntryType, string> = {
  word: '单词',
  phrase: '短语',
  sentence: '句子',
}
</script>

<template>
  <div class="import-item" :class="{ selected, duplicate: props.item.duplicate }">
    <input
      type="checkbox"
      :checked="selected"
      :aria-label="`选择 ${props.item.text}`"
      @change="emit('toggle', props.item.id)"
    />
    <div class="item-main">
      <div class="row wrap item-title">
        <TypeBadge :type="props.item.type" />
        <strong>{{ props.item.text }}</strong>
        <span v-if="props.item.duplicate" class="tag duplicate-tag">已存在</span>
        <span v-if="showScenePath && props.item.section" class="tag">
          {{ props.item.section }}
        </span>
        <span v-if="showScenePath && props.item.subsection" class="tag">
          {{ props.item.subsection }}
        </span>
      </div>
      <p v-if="props.item.meaning" class="item-meaning">{{ props.item.meaning }}</p>
      <p v-if="props.item.explanation" class="item-explain">
        {{ props.item.explanation }}
      </p>
      <p v-if="props.item.notes" class="item-notes">笔记：{{ props.item.notes }}</p>
    </div>
    <select v-model="props.item.type" class="select item-type" aria-label="词条类型">
      <option v-for="type in types" :key="type" :value="type">{{ labels[type] }}</option>
    </select>
  </div>
</template>

<style scoped>
.import-item {
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: flex-start;
  gap: 11px;
  padding: 11px 12px;
  border: var(--border-width, 0) solid var(--border-color, transparent);
  border-radius: var(--radius-sm);
  background: var(--bg);
  transition: background-color var(--transition), border-color var(--transition),
    opacity var(--transition);
}
.import-item.duplicate {
  background: var(--bg-soft);
}
.import-item.selected {
  background: var(--bg);
}
.import-item.selected::before {
  content: "";
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: 0;
  width: 3px;
  border-radius: var(--radius-sm);
  background: var(--accent);
}
.import-item > input {
  margin-top: 5px;
}
.item-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.item-title {
  gap: 8px;
}
.item-title strong {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.item-meaning {
  margin: 0;
  font-size: 12.5px;
  color: var(--ink-soft);
}
.item-explain,
.item-notes {
  margin: 0;
  font-size: 11.5px;
  color: var(--muted);
  line-height: 1.55;
  overflow-wrap: anywhere;
}
.duplicate-tag {
  color: var(--warning);
}
.item-type {
  width: auto;
  min-width: 76px;
  padding: 5px 9px;
  border-radius: var(--radius-sm);
  font-size: 11.5px;
  box-shadow: var(--shadow-inset-sm);
}
@media (max-width: 560px) {
  .import-item {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .item-type {
    grid-column: 2;
    justify-self: start;
  }
}
</style>
