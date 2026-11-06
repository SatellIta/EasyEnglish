<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EntryType, ExportOptions } from '@shared/types'
import { ENTRY_TYPE_LABELS } from '@shared/types'
import BaseModal from '@/components/BaseModal.vue'
import Icon from '@/components/Icon.vue'
import { api, errorMessage } from '@/lib/api'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const options = ref<ExportOptions | null>(null)
const selectedTypes = ref<Set<EntryType>>(new Set(['word', 'phrase', 'sentence']))
const selectedScenes = ref<Set<number>>(new Set())
const loading = ref(false)
const exporting = ref(false)
const error = ref('')
const notice = ref('')

const types: EntryType[] = ['word', 'phrase', 'sentence']

const selectedCount = computed(() => {
  const data = options.value
  if (!data) return 0
  let total = 0
  for (const type of types) {
    if (selectedTypes.value.has(type)) total += data.types[type]
  }
  for (const scene of data.scenes) {
    if (selectedScenes.value.has(scene.id)) total += scene.counts.total
  }
  return total
})

const selectedGroupCount = computed(
  () => selectedTypes.value.size + selectedScenes.value.size,
)

const effectiveGroupCount = computed(() => {
  const data = options.value
  if (!data) return 0
  let count = 0
  for (const type of types) {
    if (selectedTypes.value.has(type) && data.types[type] > 0) count += 1
  }
  for (const scene of data.scenes) {
    if (selectedScenes.value.has(scene.id) && scene.counts.total > 0) count += 1
  }
  return count
})

async function load() {
  loading.value = true
  error.value = ''
  notice.value = ''
  try {
    const data = await api.exports.options()
    options.value = data
    selectedTypes.value = new Set(types)
    selectedScenes.value = new Set(data.scenes.map((scene) => scene.id))
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

function toggleType(type: EntryType) {
  const next = new Set(selectedTypes.value)
  if (next.has(type)) next.delete(type)
  else next.add(type)
  selectedTypes.value = next
}

function toggleScene(id: number) {
  const next = new Set(selectedScenes.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedScenes.value = next
}

function selectAll() {
  const data = options.value
  selectedTypes.value = new Set(types)
  selectedScenes.value = new Set(data?.scenes.map((scene) => scene.id) ?? [])
}

function selectNone() {
  selectedTypes.value = new Set()
  selectedScenes.value = new Set()
}

async function download() {
  if (!effectiveGroupCount.value || exporting.value) return
  exporting.value = true
  error.value = ''
  notice.value = ''
  try {
    const markdown = await api.exports.markdown({
      types: [...selectedTypes.value],
      sceneIds: [...selectedScenes.value],
    })
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    const now = new Date()
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate(),
    ).padStart(2, '0')}`
    anchor.href = url
    anchor.download = `easyenglish-export-${stamp}.md`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    notice.value = `已导出 ${effectiveGroupCount.value} 个分组，约 ${selectedCount.value} 条词条。`
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    exporting.value = false
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) load()
  },
)
</script>

<template>
  <BaseModal :open="open" title="导出 Markdown" width="680px" @close="emit('close')">
    <div class="export-body">
      <p class="hint">
        选择要导出的分组。常规词条只包含未归入场景的内容；场景词条按场景导出。
        同一词条属于多个场景时，会在每个场景中分别导出。导出不包含复习进度。
      </p>

      <p v-if="error" class="banner banner-error">{{ error }}</p>
      <p v-if="notice" class="banner banner-ok">{{ notice }}</p>

      <p v-if="loading" class="empty">正在读取导出分组…</p>

      <template v-else-if="options">
        <div class="export-toolbar">
          <span class="muted small">已选 {{ selectedGroupCount }} 组 · 约 {{ selectedCount }} 条</span>
          <div class="row">
            <button class="btn btn-ghost btn-sm" type="button" @click="selectAll">
              全选
            </button>
            <button class="btn btn-ghost btn-sm" type="button" @click="selectNone">
              全不选
            </button>
          </div>
        </div>

        <section class="export-section">
          <h3>常规词条</h3>
          <p class="hint">这些词条还没有归入任何场景。</p>
          <div class="export-list">
            <label v-for="type in types" :key="type" class="export-row">
              <input
                type="checkbox"
                :checked="selectedTypes.has(type)"
                @change="toggleType(type)"
              />
              <span class="export-name">{{ ENTRY_TYPE_LABELS[type] }}</span>
              <span class="export-count">{{ options.types[type] }}</span>
            </label>
          </div>
        </section>

        <section class="export-section">
          <h3>场景</h3>
          <p v-if="!options.scenes.length" class="hint">还没有场景。</p>
          <div v-else class="export-list scene-export-list">
            <label v-for="scene in options.scenes" :key="scene.id" class="export-row">
              <input
                type="checkbox"
                :checked="selectedScenes.has(scene.id)"
                @change="toggleScene(scene.id)"
              />
              <span class="export-name">{{ scene.name }}</span>
              <span class="export-count">{{ scene.counts.total }}</span>
            </label>
          </div>
        </section>

        <p class="hint">
          导出格式：常规词条使用 <code># words</code> / <code># collocations</code> /
          <code># sentences</code>；场景使用 <code># Scenery</code> →
          <code>## 场景名</code> → <code>### 单词/短语/句子</code>。
          表格的「补充」列会合并解释、例句、笔记和标签。
        </p>
      </template>
    </div>

    <template #footer>
      <button class="btn btn-ghost" type="button" @click="emit('close')">取消</button>
      <button
        class="btn btn-primary"
        type="button"
        :disabled="exporting || !effectiveGroupCount"
        @click="download"
      >
        <Icon :name="exporting ? 'refresh' : 'download'" :size="16" />
        {{ exporting ? '导出中…' : `导出 Markdown（${selectedCount} 条）` }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
.export-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.export-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.export-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.export-section h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.export-section .hint {
  margin: 0;
}
.export-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.scene-export-list {
  max-height: 26vh;
  overflow-y: auto;
  padding-right: 4px;
}
.export-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 11px;
  border-radius: var(--radius-sm);
  background: var(--bg-soft);
  cursor: pointer;
}
.export-row input {
  flex: 0 0 auto;
}
.export-name {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.export-count {
  flex: 0 0 auto;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
}
code {
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  background: var(--bg-soft);
  font-family: var(--font-mono);
  font-size: 11.5px;
}
</style>
