<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    text: string
    /** 当前高亮的单词（不区分大小写） */
    selected?: string | null
    /** 关闭后只渲染普通文本 */
    enabled?: boolean
  }>(),
  { selected: null, enabled: true },
)

const emit = defineEmits<{
  select: [word: string]
  open: [word: string]
}>()

/** 只把英文单词做成可点击；数字、标点和中文保持原样。 */
const WORD_PATTERN = /[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’\-][A-Za-zÀ-ÖØ-öø-ÿ]+)*/g

interface Part {
  text: string
  word: boolean
}

const parts = computed<Part[]>(() => {
  if (!props.enabled) return [{ text: props.text, word: false }]
  const result: Part[] = []
  let last = 0
  for (const match of props.text.matchAll(WORD_PATTERN)) {
    const index = match.index ?? 0
    if (index > last) result.push({ text: props.text.slice(last, index), word: false })
    result.push({ text: match[0], word: true })
    last = index + match[0].length
  }
  if (last < props.text.length) {
    result.push({ text: props.text.slice(last), word: false })
  }
  return result
})

function normalize(word: string): string {
  return word.replace(/[’‘]/g, "'").toLowerCase()
}

function isActive(word: string): boolean {
  return Boolean(props.selected) && normalize(word) === normalize(props.selected as string)
}

/** 第一次点击选中，再点同一个词打开词条。 */
function activate(word: string) {
  if (!props.enabled) return
  if (isActive(word)) emit('open', word)
  else emit('select', word)
}
</script>

<template>
  <span class="clickable-text">
    <template v-for="(part, index) in parts" :key="index">
      <span v-if="!part.word">{{ part.text }}</span>
      <span
        v-else
        class="word-token"
        :class="{ active: isActive(part.text) }"
        role="button"
        tabindex="0"
        @click="activate(part.text)"
        @keydown.enter.prevent="activate(part.text)"
        @keydown.space.prevent="activate(part.text)"
      >{{ part.text }}</span>
    </template>
  </span>
</template>

<style scoped>
.clickable-text {
  white-space: inherit;
}
.word-token {
  border-radius: 4px;
  padding: 0 1px;
  margin: 0 -1px;
  cursor: pointer;
  transition:
    background-color var(--transition),
    box-shadow var(--transition),
    color var(--transition);
}
.word-token:hover {
  background: var(--accent-soft);
}
.word-token.active {
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1.5px var(--accent);
  color: var(--accent-strong);
}
.word-token:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
</style>
