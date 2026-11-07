import { Hono } from 'hono'
import { z } from 'zod'
import { ENTRY_TYPE_LABELS } from '../../shared/types'
import type {
  Entry,
  EntryType,
  ExportOptions,
  ExportTypeCounts,
} from '../../shared/types'
import { db } from '../db'
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

function escapeCell(value: string): string {
  return value.replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|').trim()
}

/** 表格只有三列；音标、英英释义、解释、例句、笔记、标签合并进「补充」列。 */
function supplementFor(entry: Entry): string {
  const parts: string[] = []
  if (entry.phonetic) parts.push(`音标：${entry.phonetic}`)
  if (entry.englishDefinition) parts.push(`英英释义：${entry.englishDefinition}`)
  if (entry.explanation) parts.push(entry.explanation)
  if (entry.examples.length) parts.push(`例句：${entry.examples.join(' / ')}`)
  if (entry.notes) parts.push(`笔记：${entry.notes}`)
  if (entry.tags.length) parts.push(`标签：${entry.tags.join(', ')}`)
  return parts.join('；')
}

function tableFor(entries: Entry[]): string {
  const lines = [
    '| English | 含义 | 补充 |',
    '| --- | --- | --- |',
    ...entries.map(
      (entry) =>
        `| ${escapeCell(entry.text)} | ${escapeCell(entry.meaning ?? '')} | ${escapeCell(
          supplementFor(entry),
        )} |`,
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

function loadSceneEntries(sceneId: number): Entry[] {
  const rows = db
    .prepare(
      `${SCENE_ENTRY_SELECT}
       WHERE se.scene_id = ?
       ORDER BY e.created_at ASC, e.id ASC`,
    )
    .all(sceneId)
  return rows.map((row) => mapSceneEntry(row).entry)
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

  for (const type of ['word', 'phrase', 'sentence'] as EntryType[]) {
    if (!types.includes(type)) continue
    const entries = loadRegularEntries(type)
    if (!entries.length) continue
    blocks.push(`# ${H1_FOR_TYPE[type]}\n\n${tableFor(entries)}`)
  }

  const sceneBlocks: string[] = []
  for (const sceneId of sceneIds) {
    const scene = getSceneSummary(sceneId)
    if (!scene) continue
    const entries = loadSceneEntries(sceneId)
    if (!entries.length) continue

    const byType: Record<EntryType, Entry[]> = {
      word: [],
      phrase: [],
      sentence: [],
    }
    for (const entry of entries) byType[entry.type].push(entry)

    const typeBlocks: string[] = []
    for (const type of ['word', 'phrase', 'sentence'] as EntryType[]) {
      if (!byType[type].length) continue
      typeBlocks.push(`### ${ENTRY_TYPE_LABELS[type]}\n\n${tableFor(byType[type])}`)
    }
    if (!typeBlocks.length) continue

    const title = scene.name.replace(/\r?\n/g, ' ').trim()
    sceneBlocks.push(`## ${title}\n\n${typeBlocks.join('\n\n')}`)
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
