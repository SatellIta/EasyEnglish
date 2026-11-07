import { Hono } from 'hono'
import { z } from 'zod'
import { ENTRY_TYPE_LABELS } from '../../shared/types'
import type {
  Entry,
  EntryType,
  ExportOptions,
  ExportTypeCounts,
  SceneEntry,
} from '../../shared/types'
import { db } from '../db'
import { sceneTypeFromHeading } from '../lib/markdown-import'
import { mapEntry, mapSceneEntry } from '../lib/mappers'
import { ENTRY_SELECT, SCENE_ENTRY_SELECT } from '../lib/queries'
import { getSceneSummary, listSceneSummaries } from '../lib/scenes'

const app = new Hono()

const exportInput = z.object({
  types: z.array(z.enum(['word', 'phrase', 'sentence'])).max(3).default([]),
  sceneIds: z.array(z.number().int().positive()).max(500).default([]),
})

const H1_FOR_TYPE: Record<EntryType, string> = {
  word: 'words',
  phrase: 'collocations',
  sentence: 'sentences',
}

const TYPE_ORDER: EntryType[] = ['word', 'phrase', 'sentence']

function escapeCell(value: string): string {
  return value.replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|').trim()
}

interface ExportColumn {
  header: string
  /** 该列在整组里是否至少有一个值 */
  has: (entry: Entry) => boolean
  value: (entry: Entry) => string
  /** 总是输出 */
  always?: boolean
}

/** 具名列；导入端按表头识别，列顺序可以改变。 */
const COLUMNS: ExportColumn[] = [
  { header: 'English', has: () => true, value: (entry) => entry.text, always: true },
  { header: '含义', has: (entry) => Boolean(entry.meaning), value: (entry) => entry.meaning ?? '' },
  {
    header: '英英释义',
    has: (entry) => Boolean(entry.englishDefinition),
    value: (entry) => entry.englishDefinition ?? '',
  },
  {
    header: '例句',
    has: (entry) => entry.examples.length > 0,
    value: (entry) => entry.examples.join('<br>'),
  },
  {
    header: '补充',
    has: (entry) => Boolean(entry.explanation),
    value: (entry) => entry.explanation ?? '',
  },
  { header: '笔记', has: (entry) => Boolean(entry.notes), value: (entry) => entry.notes ?? '' },
  {
    header: '音标',
    has: (entry) => Boolean(entry.phonetic),
    value: (entry) => entry.phonetic ?? '',
  },
  {
    header: '标签',
    has: (entry) => entry.tags.length > 0,
    value: (entry) => entry.tags.join(', '),
  },
]

function tableFor(entries: Entry[]): string {
  const columns = COLUMNS.filter((column) => column.always || entries.some(column.has))
  const lines = [
    `| ${columns.map((column) => column.header).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...entries.map(
      (entry) =>
        `| ${columns.map((column) => escapeCell(column.value(entry))).join(' | ')} |`,
    ),
  ]
  return lines.join('\n')
}

function loadRegularEntries(type: EntryType): Entry[] {
  const rows = db
    .prepare(
      `${ENTRY_SELECT}
       WHERE e.type = ?
         AND NOT EXISTS (SELECT 1 FROM scene_entries se WHERE se.entry_id = e.id)
       ORDER BY e.created_at ASC, e.id ASC`,
    )
    .all(type)
  return rows.map(mapEntry)
}

function loadSceneEntries(sceneId: number): SceneEntry[] {
  const rows = db
    .prepare(
      `${SCENE_ENTRY_SELECT}
       WHERE se.scene_id = ?
       ORDER BY se.position ASC, se.added_at ASC, e.id ASC`,
    )
    .all(sceneId)
  return rows.map(mapSceneEntry)
}

function typeTable(type: EntryType, entries: SceneEntry[]): string {
  const typed = entries.filter((item) => item.entry.type === type).map((item) => item.entry)
  if (!typed.length) return ''
  return `#### ${ENTRY_TYPE_LABELS[type]}\n\n${tableFor(typed)}`
}

interface SectionGroup {
  /** null 表示没有片段，直接使用类型标题（旧格式） */
  name: string | null
  items: SceneEntry[]
}

/**
 * 场景按 section 分组：
 * - section 为空或本身就是类型标题 → 旧格式，输出 `### 单词/短语/句子`
 * - section 是用户写的片段 → 新格式，输出 `### 片段` + `#### 单词/短语/句子`
 * subsection 在导出时统一由词条类型决定，保证再次导入时类型正确。
 */
function sceneBlock(sceneName: string, entries: SceneEntry[]): string {
  const groups = new Map<string, SectionGroup>()
  for (const item of entries) {
    const section = item.section?.trim() ?? ''
    const typeOnly = !section || sceneTypeFromHeading(section) !== null
    const key = typeOnly ? '\u0000type' : section
    let group = groups.get(key)
    if (!group) {
      group = { name: typeOnly ? null : section, items: [] }
      groups.set(key, group)
    }
    group.items.push(item)
  }

  const blocks: string[] = []
  for (const group of groups.values()) {
    if (group.name === null) {
      for (const type of TYPE_ORDER) {
        const typed = group.items
          .filter((item) => item.entry.type === type)
          .map((item) => item.entry)
        if (!typed.length) continue
        blocks.push(`### ${ENTRY_TYPE_LABELS[type]}\n\n${tableFor(typed)}`)
      }
      continue
    }

    const typeBlocks = TYPE_ORDER.map((type) => typeTable(type, group.items)).filter(Boolean)
    if (!typeBlocks.length) continue
    blocks.push(`### ${group.name}\n\n${typeBlocks.join('\n\n')}`)
  }

  if (!blocks.length) return ''
  const title = sceneName.replace(/\r?\n/g, ' ').trim()
  return `## ${title}\n\n${blocks.join('\n\n')}`
}

app.get('/api/export/options', (c) => {
  const rows = db
    .prepare(
      `SELECT e.type AS type, COUNT(*) AS n
       FROM entries e
       WHERE NOT EXISTS (SELECT 1 FROM scene_entries se WHERE se.entry_id = e.id)
       GROUP BY e.type`,
    )
    .all() as Array<{ type: EntryType; n: number }>

  const types: ExportTypeCounts = { total: 0, word: 0, phrase: 0, sentence: 0 }
  for (const row of rows) {
    const count = Number(row.n)
    types.total += count
    types[row.type] = count
  }

  const options: ExportOptions = {
    types,
    scenes: listSceneSummaries(),
  }
  return c.json(options)
})

app.post('/api/export/markdown', async (c) => {
  const input = exportInput.parse(await c.req.json())
  const types = [...new Set(input.types)]
  const sceneIds = [...new Set(input.sceneIds)]

  if (!types.length && !sceneIds.length) {
    return c.json({ error: '请至少选择一个导出分组' }, 400)
  }

  const blocks: string[] = []

  for (const type of TYPE_ORDER) {
    if (!types.includes(type)) continue
    const entries = loadRegularEntries(type)
    if (!entries.length) continue
    blocks.push(`# ${H1_FOR_TYPE[type]}\n\n${tableFor(entries)}`)
  }

  const sceneBlocks: string[] = []
  for (const sceneId of sceneIds) {
    const scene = getSceneSummary(sceneId)
    if (!scene) continue
    const block = sceneBlock(scene.name, loadSceneEntries(sceneId))
    if (block) sceneBlocks.push(block)
  }

  if (sceneBlocks.length) {
    blocks.push(`# Scenery\n\n${sceneBlocks.join('\n\n')}`)
  }

  if (!blocks.length) {
    return c.json({ error: '选中的分组里没有可导出的内容' }, 400)
  }

  return c.body(`${blocks.join('\n\n')}\n`, 200, {
    'Content-Type': 'text/markdown; charset=utf-8',
  })
})

export default app
