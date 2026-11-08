import { Hono } from 'hono'
import { z } from 'zod'
import { ENTRY_TYPE_LABELS } from '../../shared/types'
import type { BulkCreateResult, Entry, EntrySense } from '../../shared/types'
import { db } from '../db'
import {
  entryKey,
  findExistingEntryByText,
  loadExistingEntryKeyMap,
} from '../lib/dedupe'
import { insertEntry } from '../lib/entry-store'
import { mapEntry } from '../lib/mappers'
import { buildSearchFilter, ENTRY_SELECT, getEntryById } from '../lib/queries'
import { normalizeEntryText } from '../lib/text'
import { nowIso } from '../lib/time'

const app = new Hono()

const senseInput = z.object({
  meaning: z.string().trim().max(4000).nullish(),
  englishDefinition: z.string().trim().max(8000).nullish(),
  explanation: z.string().trim().max(8000).nullish(),
  examples: z.array(z.string().trim().min(1).max(1000)).max(50).optional(),
})

const entryInput = z.object({
  type: z.enum(['word', 'phrase', 'sentence']),
  text: z.string().trim().min(1, '内容不能为空').max(2000),
  meaning: z.string().trim().max(4000).nullish(),
  explanation: z.string().trim().max(8000).nullish(),
  examples: z.array(z.string().trim().min(1).max(1000)).max(50).optional(),
  senses: z.array(senseInput).max(20).optional(),
  notes: z.string().trim().max(8000).nullish(),
  tags: z.array(z.string().trim().min(1).max(50)).max(50).optional(),
  phonetic: z.string().trim().max(200).nullish(),
  englishDefinition: z.string().trim().max(8000).nullish(),
  images: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
  source: z.string().trim().max(50).optional(),
  reviewEnabled: z.boolean().optional(),
  sourceSessionId: z.number().int().positive().nullish(),
  sourceMessageId: z.number().int().positive().nullish(),
})

const updateInput = entryInput.partial()

/** 把 zod 的可选字段收敛为写库用的完整义项，并丢弃空义项。 */
function normalizeSenses(
  senses: Array<z.infer<typeof senseInput>> | undefined,
): EntrySense[] | undefined {
  if (!senses) return undefined
  return senses
    .map((sense) => ({
      meaning: sense.meaning?.trim() || null,
      englishDefinition: sense.englishDefinition?.trim() || null,
      explanation: sense.explanation?.trim() || null,
      examples: (sense.examples ?? []).map((example) => example.trim()).filter(Boolean),
    }))
    .filter(
      (sense) =>
        sense.meaning ||
        sense.englishDefinition ||
        sense.explanation ||
        sense.examples.length,
    )
}

const bulkInput = z.object({
  entries: z.array(entryInput).min(1).max(50),
  /** 默认 true：跳过词库中和本批次内主要英文内容相同的词条 */
  skipDuplicates: z.boolean().optional(),
})

const bulkDeleteFilter = z.object({
  types: z
    .array(z.enum(['word', 'phrase', 'sentence']))
    .max(3)
    .optional(),
  tags: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366).optional(),
  sceneIds: z.array(z.number().int().positive()).max(200).optional(),
  q: z.string().trim().max(500).optional(),
})

const bulkDeleteInput = z
  .object({
    ids: z.array(z.number().int().positive()).max(10000).optional(),
    filter: bulkDeleteFilter.optional(),
  })
  .refine((value) => (value.ids?.length ?? 0) > 0 || value.filter, {
    message: '请提供要删除的词条或筛选条件',
  })

/** 同一维度内 OR，不同维度之间 AND；空条件返回 null，避免误删整库。 */
function buildBulkDeleteWhere(
  filter: z.infer<typeof bulkDeleteFilter>,
): { clause: string; params: unknown[] } | null {
  const clauses: string[] = []
  const params: unknown[] = []

  if (filter.types?.length) {
    clauses.push(`e.type IN (${filter.types.map(() => '?').join(', ')})`)
    params.push(...filter.types)
  }
  if (filter.tags?.length) {
    clauses.push(
      `EXISTS (SELECT 1 FROM json_each(e.tags) WHERE json_each.value IN (${filter.tags
        .map(() => '?')
        .join(', ')}))`,
    )
    params.push(...filter.tags)
  }
  if (filter.dates?.length) {
    clauses.push(
      `date(e.created_at, 'localtime') IN (${filter.dates.map(() => '?').join(', ')})`,
    )
    params.push(...filter.dates)
  }
  if (filter.sceneIds?.length) {
    clauses.push(
      `EXISTS (SELECT 1 FROM scene_entries se WHERE se.entry_id = e.id AND se.scene_id IN (${filter.sceneIds
        .map(() => '?')
        .join(', ')}))`,
    )
    params.push(...filter.sceneIds)
  }
  if (filter.q?.trim()) {
    const search = buildSearchFilter(filter.q)
    if (search.clause) {
      clauses.push(search.clause)
      params.push(...search.params)
    }
  }

  return clauses.length ? { clause: clauses.join(' AND '), params } : null
}

function countIds(ids: number[]): number {
  let total = 0
  for (let index = 0; index < ids.length; index += 500) {
    const chunk = ids.slice(index, index + 500)
    const row = db
      .prepare(
        `SELECT count(*) AS n FROM entries WHERE id IN (${chunk.map(() => '?').join(', ')})`,
      )
      .get(...chunk) as { n: number }
    total += Number(row.n ?? 0)
  }
  return total
}

function deleteIds(ids: number[]): number {
  const unique = [...new Set(ids)]
  let deleted = 0
  db.transaction(() => {
    for (let index = 0; index < unique.length; index += 500) {
      const chunk = unique.slice(index, index + 500)
      const info = db
        .prepare(
          `DELETE FROM entries WHERE id IN (${chunk.map(() => '?').join(', ')})`,
        )
        .run(...chunk)
      deleted += Number(info.changes)
    }
  })()
  return deleted
}

/** 预统计：与批量删除使用完全相同的条件。 */
function countBulkDelete(input: z.infer<typeof bulkDeleteInput>): number | null {
  if (input.ids?.length) return countIds(input.ids)
  if (!input.filter) return null
  const where = buildBulkDeleteWhere(input.filter)
  if (!where) return null
  const row = db
    .prepare(`SELECT count(*) AS n FROM entries e WHERE ${where.clause}`)
    .get(...where.params) as { n: number }
  return Number(row.n ?? 0)
}

app.post('/api/entries/bulk-delete/preview', async (c) => {
  const input = bulkDeleteInput.parse(await c.req.json())
  const count = countBulkDelete(input)
  if (count === null) {
    return c.json({ error: '请选择至少一个删除条件' }, 400)
  }
  return c.json({ count })
})

app.post('/api/entries/bulk-delete', async (c) => {
  const input = bulkDeleteInput.parse(await c.req.json())

  let deleted = 0
  if (input.ids?.length) {
    deleted = deleteIds(input.ids)
  } else if (input.filter) {
    const where = buildBulkDeleteWhere(input.filter)
    if (!where) return c.json({ error: '请选择至少一个删除条件' }, 400)
    const info = db
      .prepare(
        `DELETE FROM entries WHERE id IN (SELECT e.id FROM entries e WHERE ${where.clause})`,
      )
      .run(...where.params)
    deleted = Number(info.changes)
  } else {
    return c.json({ error: '请提供要删除的词条或筛选条件' }, 400)
  }

  return c.json({ deleted })
})

/** 列表排序白名单；未知值回退到最新优先。 */
const SORT_SQL: Record<string, string> = {
  newest: 'e.created_at DESC, e.id DESC',
  oldest: 'e.created_at ASC, e.id ASC',
  alpha: 'e.text COLLATE NOCASE ASC, e.id ASC',
  alphaDesc: 'e.text COLLATE NOCASE DESC, e.id DESC',
}

app.get('/api/entries', (c) => {
  const rawTypes = c.req.query('types') ?? c.req.query('type') ?? ''
  const types = rawTypes
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is Entry['type'] => value === 'word' || value === 'phrase' || value === 'sentence')

  const q = c.req.query('q') ?? ''
  const tag = c.req.query('tag') ?? ''
  const from = c.req.query('from')
  const to = c.req.query('to')
  const sort = SORT_SQL[c.req.query('sort') ?? ''] ?? SORT_SQL.newest
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 100) || 100, 1), 500)
  const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0)

  const where: string[] = []
  const params: unknown[] = []

  if (types.length) {
    where.push(`e.type IN (${types.map(() => '?').join(', ')})`)
    params.push(...types)
  }

  if (q.trim()) {
    const filter = buildSearchFilter(q)
    if (filter.clause) {
      where.push(filter.clause)
      params.push(...filter.params)
    }
  }

  if (tag.trim()) {
    where.push('EXISTS (SELECT 1 FROM json_each(e.tags) WHERE json_each.value = ?)')
    params.push(tag.trim())
  }

  if (from) {
    where.push('e.created_at >= ?')
    params.push(from)
  }

  if (to) {
    where.push('e.created_at < ?')
    params.push(to)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM entries e ${whereSql}`)
    .get(...params) as { n: number }
  const rows = db
    .prepare(`${ENTRY_SELECT} ${whereSql} ORDER BY ${sort} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)

  return c.json({
    items: rows.map(mapEntry),
    total: Number(totalRow.n),
    limit,
    offset,
  })
})

app.post('/api/entries', async (c) => {
  const input = entryInput.parse(await c.req.json())
  const existing = findExistingEntryByText(input.text)
  if (existing) {
    return c.json(
      {
        error: `词库中已存在相同的英文内容「${existing.text}」（${ENTRY_TYPE_LABELS[existing.type]}）。请直接编辑已有词条。`,
        details: { existing },
      },
      409,
    )
  }
  const entry = db.transaction(() =>
    insertEntry({ ...input, senses: normalizeSenses(input.senses) }),
  )()
  return c.json(entry, 201)
})

app.post('/api/entries/bulk', async (c) => {
  const { entries, skipDuplicates = true } = bulkInput.parse(await c.req.json())
  const created: Entry[] = []
  const duplicates: BulkCreateResult['duplicates'] = []

  db.transaction(() => {
    const existing = skipDuplicates ? loadExistingEntryKeyMap() : new Map<string, number>()
    const seen = new Map<string, number>()
    for (const input of entries) {
      const key = entryKey(input.text)
      const existingId = existing.get(key) ?? seen.get(key)
      if (skipDuplicates && existingId !== undefined) {
        duplicates.push({ type: input.type, text: input.text, existingEntryId: existingId })
        continue
      }
      const entry = insertEntry({ ...input, senses: normalizeSenses(input.senses) })
      seen.set(key, entry.id)
      created.push(entry)
    }
  })()

  const result: BulkCreateResult = {
    entries: created,
    count: created.length,
    skipped: duplicates.length,
    duplicates,
  }
  return c.json(result, 201)
})

/**
 * 详情页点击单词时按规范化英文内容查词。
 * 必须注册在 `/api/entries/:id` 之前，避免把 "lookup" 当成 ID。
 */
app.get('/api/entries/lookup', (c) => {
  const text = (c.req.query('text') ?? '').trim()
  if (!text) return c.json({ error: '内容不能为空' }, 400)
  const key = normalizeEntryText(text)
  const row = key
    ? (db
        .prepare('SELECT id FROM entries WHERE normalized_text = ? LIMIT 1')
        .get(key) as { id: number } | undefined)
    : undefined
  return c.json({
    text,
    entry: row ? getEntryById(row.id) : null,
  })
})

app.get('/api/entries/:id', (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: '无效的词条 ID' }, 400)
  const entry = getEntryById(id)
  if (!entry) return c.json({ error: '词条不存在' }, 404)
  return c.json(entry)
})

app.patch('/api/entries/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: '无效的词条 ID' }, 400)
  if (!getEntryById(id)) return c.json({ error: '词条不存在' }, 404)

  const input = updateInput.parse(await c.req.json())
  if (input.text !== undefined) {
    const existing = findExistingEntryByText(input.text, id)
    if (existing) {
      return c.json(
        {
          error: `词库中已存在相同的英文内容「${existing.text}」（${ENTRY_TYPE_LABELS[existing.type]}）。请直接编辑已有词条。`,
          details: { existing },
        },
        409,
      )
    }
  }
  const fields: string[] = []
  const params: unknown[] = []
  const set = (column: string, value: unknown) => {
    fields.push(`${column} = ?`)
    params.push(value)
  }

  if (input.type !== undefined) set('type', input.type)
  if (input.text !== undefined) {
    set('text', input.text)
    set('normalized_text', normalizeEntryText(input.text))
  }
  if (input.meaning !== undefined) set('meaning', input.meaning || null)
  if (input.explanation !== undefined) set('explanation', input.explanation || null)
  if (input.examples !== undefined) set('examples', JSON.stringify(input.examples))
  if (input.senses !== undefined) set('senses', JSON.stringify(normalizeSenses(input.senses) ?? []))
  if (input.notes !== undefined) set('notes', input.notes || null)
  if (input.tags !== undefined) set('tags', JSON.stringify(input.tags))
  if (input.phonetic !== undefined) set('phonetic', input.phonetic || null)
  if (input.englishDefinition !== undefined) {
    set('english_definition', input.englishDefinition || null)
  }
  if (input.images !== undefined) set('images', JSON.stringify(input.images))
  if (input.source !== undefined) set('source', input.source)
  if (input.reviewEnabled !== undefined) set('review_enabled', input.reviewEnabled ? 1 : 0)
  if (input.sourceSessionId !== undefined) set('source_session_id', input.sourceSessionId)
  if (input.sourceMessageId !== undefined) set('source_message_id', input.sourceMessageId)

  if (!fields.length) return c.json(getEntryById(id))
  set('updated_at', nowIso())

  db.prepare(`UPDATE entries SET ${fields.join(', ')} WHERE id = ?`).run(...params, id)
  return c.json(getEntryById(id))
})

app.delete('/api/entries/:id', (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: '无效的词条 ID' }, 400)
  const info = db.prepare('DELETE FROM entries WHERE id = ?').run(id)
  if (!info.changes) return c.json({ error: '词条不存在' }, 404)
  return c.json({ ok: true })
})

export default app
