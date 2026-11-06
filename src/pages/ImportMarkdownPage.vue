<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { RouterLink } from 'vue-router'
import type {
  ImportCommitItem,
  ImportCommitResult,
  ImportItem,
  ImportPreview,
} from '@shared/types'
import Icon from '@/components/Icon.vue'
import ImportItemRow from '@/components/import/ImportItemRow.vue'
import { api, errorMessage } from '@/lib/api'
import { useAppStore } from '@/stores/app'

interface EntryGroup {
  key: string
  title: string
  items: ImportItem[]
}

interface SubsectionGroup {
  key: string
  name: string
  items: ImportItem[]
}

interface SectionGroup {
  key: string
  name: string
  items: ImportItem[]
  subsections: SubsectionGroup[]
}

interface SceneGroup {
  key: string
  name: string
  items: ImportItem[]
  sections: SectionGroup[]
}

const store = useAppStore()

const markdown = ref('')
const filename = ref('')
const parsing = ref(false)
const committing = ref(false)
const error = ref('')
const preview = ref<ImportPreview | null>(null)
const selected = ref<Set<string>>(new Set())
const expanded = ref<Set<string>>(new Set())
const sceneReview = ref(false)
const commitResult = ref<ImportCommitResult | null>(null)

const categoryLabels: Record<string, string> = {
  words: '单词',
  word: '单词',
  collocations: '短语 / 搭配',
  collocation: '短语 / 搭配',
  sentences: '句子',
  sentence: '句子',
  scenery: '场景',
  scene: '场景',
  other: '其他',
}

const selectedItems = computed(() =>
  preview.value ? preview.value.items.filter((item) => selected.value.has(item.id)) : [],
)
const selectedCount = computed(() => selectedItems.value.length)
const selectedSceneCount = computed(
  () => selectedItems.value.filter((item) => item.scene).length,
)

const entryGroups = computed<EntryGroup[]>(() => {
  if (!preview.value) return []
  const map = new Map<string, EntryGroup>()
  for (const item of preview.value.items) {
    if (item.scene) continue
    const group = item.group?.trim() || ''
    const key = `${item.category}::${group}`
    const label = categoryLabels[item.category] ?? item.category
    const title = group ? `${label} · ${group}` : label
    let entry = map.get(key)
    if (!entry) {
      entry = { key, title, items: [] }
      map.set(key, entry)
    }
    entry.items.push(item)
  }
  return [...map.values()]
})

const sceneGroups = computed<SceneGroup[]>(() => {
  if (!preview.value) return []
  const map = new Map<string, SceneGroup>()
  for (const item of preview.value.items) {
    if (!item.scene) continue
    let scene = map.get(item.scene)
    if (!scene) {
      scene = { key: item.scene, name: item.scene, items: [], sections: [] }
      map.set(item.scene, scene)
    }
    scene.items.push(item)

    const sectionName = item.section?.trim() || '未分组'
    let section = scene.sections.find((value) => value.name === sectionName)
    if (!section) {
      section = { key: `${item.scene}::${sectionName}`, name: sectionName, items: [], subsections: [] }
      scene.sections.push(section)
    }
    section.items.push(item)

    const subsectionName = item.subsection?.trim() || ''
    let subsection = section.subsections.find((value) => value.name === subsectionName)
    if (!subsection) {
      subsection = {
        key: `${item.scene}::${sectionName}::${subsectionName}`,
        name: subsectionName,
        items: [],
      }
      section.subsections.push(subsection)
    }
    subsection.items.push(item)
  }
  return [...map.values()]
})

function toggle(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function countSelected(items: ImportItem[]): number {
  return items.filter((item) => selected.value.has(item.id)).length
}

function allSelected(items: ImportItem[]): boolean {
  return items.length > 0 && items.every((item) => selected.value.has(item.id))
}

function toggleGroup(items: ImportItem[]) {
  const next = new Set(selected.value)
  const remove = allSelected(items)
  for (const item of items) {
    if (remove) next.delete(item.id)
    else next.add(item.id)
  }
  selected.value = next
}

function selectAll() {
  if (!preview.value) return
  selected.value = new Set(preview.value.items.map((item) => item.id))
}

function selectNone() {
  selected.value = new Set()
}

function selectNonDuplicates() {
  if (!preview.value) return
  selected.value = new Set(
    preview.value.items.filter((item) => !item.duplicate).map((item) => item.id),
  )
}

function isExpanded(key: string): boolean {
  return expanded.value.has(key)
}

function toggleExpanded(key: string) {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

function expandAll() {
  expanded.value = new Set([
    ...entryGroups.value.map((group) => `entry:${group.key}`),
    ...sceneGroups.value.map((scene) => `scene:${scene.key}`),
  ])
}

function collapseAll() {
  expanded.value = new Set()
}

function onSceneReviewChange(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  sceneReview.value = checked
  if (!preview.value) return
  for (const item of preview.value.items) {
    if (item.scene) item.reviewEnabled = checked
  }
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (file.size > 2_000_000) {
    error.value = '文件超过 2 MB，请拆分后再导入。'
    input.value = ''
    return
  }
  try {
    markdown.value = await file.text()
    filename.value = file.name
    error.value = ''
    preview.value = null
    commitResult.value = null
    selected.value = new Set()
  } catch (caught) {
    error.value = errorMessage(caught)
  }
  input.value = ''
}

async function parse() {
  if (!markdown.value.trim()) {
    error.value = '请先粘贴或上传 Markdown 内容。'
    return
  }
  parsing.value = true
  error.value = ''
  commitResult.value = null
  try {
    const result = await api.imports.previewMarkdown(
      markdown.value,
      filename.value || undefined,
    )
    preview.value = result
    selected.value = new Set(
      result.items.filter((item) => !item.duplicate).map((item) => item.id),
    )
    expanded.value = new Set()
    sceneReview.value = false
    await nextTick()
    document.querySelector('.import-stats')?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
      block: 'start',
    })
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    parsing.value = false
  }
}

async function commit() {
  if (!selectedItems.value.length) return
  committing.value = true
  error.value = ''
  try {
    const items: ImportCommitItem[] = selectedItems.value.map((item) => ({
      type: item.type,
      text: item.text,
      meaning: item.meaning,
      explanation: item.explanation,
      examples: item.examples,
      notes: item.notes,
      tags: item.tags,
      scene: item.scene,
      section: item.section,
      subsection: item.subsection,
      reviewEnabled: item.reviewEnabled,
    }))
    commitResult.value = await api.imports.commitMarkdown(items)
    selected.value = new Set()
    store.refreshStats().catch(() => {})
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    committing.value = false
  }
}

function reset() {
  markdown.value = ''
  filename.value = ''
  preview.value = null
  selected.value = new Set()
  expanded.value = new Set()
  commitResult.value = null
  sceneReview.value = false
  error.value = ''
}
</script>

<template>
  <div class="page import-page">
    <header class="page-head">
      <div>
        <RouterLink to="/library" class="link back-link">
          <Icon name="chevron-left" :size="14" /> 返回词库
        </RouterLink>
        <h1>导入 Markdown</h1>
        <p>
          识别你手写笔记里的 # / ## / ### 结构。# words、# collocations、# sentences
          会成为普通词条；# Scenery 下的 H2 会成为场景，H3 和加粗小标题会保留为场景小节。
        </p>
      </div>
    </header>

    <p v-if="error" class="banner banner-error">{{ error }}</p>

    <section class="card source-card">
      <div class="source-head">
        <div>
          <h2>1. 选择或粘贴笔记</h2>
          <p class="hint">支持 .md / .markdown / 纯文本，单次最大 2 MB。</p>
        </div>
        <div class="source-actions">
          <label class="btn btn-ghost file-button">
            <Icon name="upload" :size="16" /> 选择文件
            <input
              class="file-input"
              type="file"
              accept=".md,.markdown,text/markdown,text/plain"
              @change="onFile"
            />
          </label>
          <button v-if="markdown || preview" class="btn btn-ghost" type="button" @click="reset">
            <Icon name="x" :size="15" /> 清空
          </button>
        </div>
      </div>

      <p v-if="filename" class="file-name">
        <Icon name="tag" :size="13" /> {{ filename }}
      </p>

      <textarea
        v-model="markdown"
        class="textarea source-input"
        rows="12"
        placeholder="# words

cheap-looking

index finger / middle finger / ring finger

# sentences

## Everyday expressions

That really got me.

# Scenery

## Bank

### Deposit money

| Expression | Meaning |
| --- | --- |
| Deposit money | 存钱 |"
      />

      <div class="actions">
        <button class="btn btn-primary" :disabled="parsing || !markdown.trim()" @click="parse">
          <Icon :name="parsing ? 'refresh' : 'search'" :size="16" />
          {{ parsing ? '解析中…' : '解析预览' }}
        </button>
      </div>
    </section>

    <template v-if="preview">
      <section class="import-stats">
        <div class="stat-card card">
          <strong>{{ preview.stats.total }}</strong>
          <span>识别词条</span>
        </div>
        <div class="stat-card card">
          <strong>{{ preview.stats.word }}</strong>
          <span>单词</span>
        </div>
        <div class="stat-card card">
          <strong>{{ preview.stats.phrase }}</strong>
          <span>短语</span>
        </div>
        <div class="stat-card card">
          <strong>{{ preview.stats.sentence }}</strong>
          <span>句子</span>
        </div>
        <div class="stat-card card">
          <strong>{{ preview.stats.scenes }}</strong>
          <span>场景</span>
        </div>
        <div class="stat-card card" :class="{ warn: preview.stats.duplicates > 0 }">
          <strong>{{ preview.stats.duplicates }}</strong>
          <span>疑似重复</span>
        </div>
      </section>

      <details v-if="preview.warnings.length" class="card warnings">
        <summary>{{ preview.warnings.length }} 条解析提示</summary>
        <ul>
          <li v-for="(warning, index) in preview.warnings" :key="index">{{ warning }}</li>
        </ul>
      </details>

      <section class="card import-controls">
        <div class="control-buttons">
          <button class="btn btn-ghost btn-sm" @click="selectAll">全选</button>
          <button class="btn btn-ghost btn-sm" @click="selectNone">全不选</button>
          <button class="btn btn-ghost btn-sm" @click="selectNonDuplicates">仅选新词条</button>
          <button class="btn btn-ghost btn-sm" @click="expandAll">展开全部</button>
          <button class="btn btn-ghost btn-sm" @click="collapseAll">收起全部</button>
        </div>
        <label class="check-row">
          <input
            type="checkbox"
            :checked="sceneReview"
            @change="onSceneReviewChange"
          />
          场景词条也加入每日复习
        </label>
        <span class="selected-count">
          已选 <strong>{{ selectedCount }}</strong> / {{ preview.stats.total }} 条
          <span v-if="selectedSceneCount"> · 场景 {{ selectedSceneCount }} 条</span>
        </span>
      </section>

      <section
        v-for="group in entryGroups"
        :key="group.key"
        class="card import-group"
      >
        <header class="group-head">
          <button
            class="group-toggle"
            type="button"
            :aria-expanded="isExpanded(`entry:${group.key}`)"
            @click="toggleExpanded(`entry:${group.key}`)"
          >
            <Icon
              :name="isExpanded(`entry:${group.key}`) ? 'chevron-down' : 'chevron-right'"
              :size="16"
            />
            <span class="group-title">{{ group.title }}</span>
            <span class="group-meta">
              {{ countSelected(group.items) }} / {{ group.items.length }}
            </span>
          </button>
          <button class="btn btn-ghost btn-sm" @click="toggleGroup(group.items)">
            {{ allSelected(group.items) ? '取消本组' : '全选本组' }}
          </button>
        </header>
        <div v-if="isExpanded(`entry:${group.key}`)" class="group-items">
          <ImportItemRow
            v-for="item in group.items"
            :key="item.id"
            :item="item"
            :selected="selected.has(item.id)"
            @toggle="toggle"
          />
        </div>
      </section>

      <section
        v-for="scene in sceneGroups"
        :key="scene.key"
        class="card import-group scene-import-group"
      >
        <header class="group-head">
          <button
            class="group-toggle"
            type="button"
            :aria-expanded="isExpanded(`scene:${scene.key}`)"
            @click="toggleExpanded(`scene:${scene.key}`)"
          >
            <Icon
              :name="isExpanded(`scene:${scene.key}`) ? 'chevron-down' : 'chevron-right'"
              :size="16"
            />
            <Icon name="layers" :size="15" />
            <span class="group-title">{{ scene.name }}</span>
            <span class="group-meta">
              {{ countSelected(scene.items) }} / {{ scene.items.length }}
            </span>
          </button>
          <button class="btn btn-ghost btn-sm" @click="toggleGroup(scene.items)">
            {{ allSelected(scene.items) ? '取消本场景' : '全选本场景' }}
          </button>
        </header>

        <div v-if="isExpanded(`scene:${scene.key}`)" class="scene-body">
          <div v-for="section in scene.sections" :key="section.key" class="preview-section">
            <h4>{{ section.name }}</h4>
            <div
              v-for="subsection in section.subsections"
              :key="subsection.key"
              class="preview-subsection"
            >
              <h5 v-if="subsection.name">{{ subsection.name }}</h5>
              <div class="group-items">
                <ImportItemRow
                  v-for="item in subsection.items"
                  :key="item.id"
                  :item="item"
                  :selected="selected.has(item.id)"
                  @toggle="toggle"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section v-if="commitResult" class="card result-card">
        <div class="result-mark"><Icon name="check" :size="24" /></div>
        <div>
          <h3>导入完成</h3>
          <p>
            新建 {{ commitResult.created }} 条
            <span v-if="commitResult.skipped"> · 跳过 {{ commitResult.skipped }} 条重复</span>
            <span v-if="commitResult.scenes.length">
              · 场景 {{ commitResult.scenes.join('、') }}
            </span>
          </p>
          <div class="result-actions">
            <RouterLink to="/library" class="btn btn-primary">去词库看看</RouterLink>
            <button class="btn btn-ghost" @click="reset">再导入一份</button>
          </div>
        </div>
      </section>

      <div v-else class="commit-bar card">
        <div>
          <strong>已选 {{ selectedCount }} 条</strong>
          <span v-if="selectedSceneCount" class="muted small">
            · 其中场景词条 {{ selectedSceneCount }} 条
          </span>
        </div>
        <button
          class="btn btn-primary"
          :disabled="committing || !selectedCount"
          @click="commit"
        >
          <Icon :name="committing ? 'refresh' : 'check'" :size="16" />
          {{ committing ? '导入中…' : '导入选中词条' }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.import-page {
  max-width: 980px;
  padding-bottom: 96px;
}
.back-link {
  margin-bottom: 10px;
  font-size: 12px;
}
.source-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px 26px;
  margin-bottom: 20px;
}
.source-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}
.source-head h2 {
  margin: 0 0 4px;
  font-size: 19px;
  font-weight: 600;
}
.source-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.file-button {
  position: relative;
  overflow: hidden;
}
.file-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.file-name {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 12px;
  color: var(--accent-strong);
  font-weight: 600;
}
.source-input {
  min-height: 240px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.6;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.import-stats {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 16px;
  scroll-margin-top: 88px;
}
.stat-card {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.stat-card strong {
  font-size: 24px;
  font-weight: 600;
  line-height: 1.1;
}
.stat-card span {
  font-size: 11.5px;
  color: var(--muted);
}
.stat-card.warn strong {
  color: var(--warning);
}
.warnings {
  margin-bottom: 16px;
  padding: 14px 18px;
}
.warnings summary {
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-soft);
}
.warnings ul {
  margin: 10px 0 0;
  padding-left: 1.2em;
  font-size: 12.5px;
  color: var(--muted);
  line-height: 1.7;
}
.import-controls {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 14px 16px;
  margin-bottom: 16px;
}
.control-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--ink-soft);
  cursor: pointer;
}
.selected-count {
  margin-left: auto;
  font-size: 12.5px;
  color: var(--muted);
}
.selected-count strong {
  color: var(--accent-strong);
}
.import-group {
  padding: 20px 22px;
  margin-bottom: 16px;
}
.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 0;
}
.group-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  text-align: left;
}
.group-toggle:hover .group-title {
  color: var(--accent-strong);
}
.group-title {
  font-size: 17px;
  font-weight: 600;
  line-height: 1.35;
  overflow-wrap: anywhere;
}
.group-meta {
  flex: 0 0 auto;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background: var(--bg-soft);
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
}
.group-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
}
.scene-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 12px;
}
.preview-section > h4 {
  margin: 0 0 9px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--divider-color, rgba(0, 0, 0, 0.08));
  font-size: 13px;
  font-weight: 700;
  color: var(--ink-soft);
}
.preview-subsection + .preview-subsection {
  margin-top: 12px;
}
.preview-subsection h5 {
  margin: 0 0 6px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}
.commit-bar {
  position: sticky;
  bottom: 16px;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  margin-top: 8px;
}
.commit-bar strong {
  font-size: 14px;
}
.result-card {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 22px 24px;
  margin-top: 8px;
}
.result-mark {
  width: 48px;
  height: 48px;
  flex: 0 0 48px;
  display: grid;
  place-items: center;
  border-radius: var(--radius);
  background: var(--accent-soft);
  color: var(--accent-strong);
}
.result-card h3 {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 600;
}
.result-card p {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.6;
}
.result-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 14px;
}
@media (max-width: 760px) {
  .import-stats {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (max-width: 560px) {
  .source-card,
  .import-group {
    padding: 18px 16px;
  }
  .import-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .selected-count {
    margin-left: 0;
  }
  .commit-bar {
    flex-direction: column;
    align-items: stretch;
    text-align: center;
  }
}
</style>
