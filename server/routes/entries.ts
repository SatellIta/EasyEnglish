import { Hono } from 'hono'
import { z } from 'zod'
import type { Entry } from '../../shared/types'
import { db } from '../db'
import { mapEntry } from '../lib/mappers'
import { buildSearchFilter, ENTRY_SELECT, getEntryById } from '../lib/queries'
import { initialSchedule } from '../lib/scheduler'
import { nowIso } from '../lib/time'

const app = new Hono()

const entryInput = z.object({
  type: z.enum(['word', 'phrase', 'sentence']),
  text: z.string().trim().min(1, '内容不能为空').max(2000),
  meaning: z.string().trim().max(4000).nullish(),
  explanation: z.string().trim().max(8000).nullish(),
  examples: z.array(z.string().trim().min(1).max(1000)).max(50).optional(),
  notes: z.string().trim().max(8000).nullish(),
  tags: z.array(z.string().trim().min(1).max(50)).max(50).optional(),
  source: z.string().trim().max(50).optional(),
})

const updateInput = entryInput.partial()
const bulkInput = z.object({ entries: z.array(entryInput).min(1).max(50) })

function insertEntry(input: z.infer<typeof entryInput>): Entry {
  const now = nowIso()
  const info = db
    .prepare(
      `INSERT INTO entries (type, text, meaning, explanation, examples, notes, tags, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.type,
      input.text,
      input.meaning ?? null,
      input.explanation ?? null,
      JSON.stringify(input.examples ?? []),
      input.notes ?? null,
      JSON.stringify(input.tags ?? []),
      input.source ?? 'manual',
      now,
      now,
    )

  const id = Number(info.lastInsertRowid)
  const schedule = initialSchedule(new Date(now))
  db.prepare(
    `INSERT INTO review_states (entry_id, stage, interval_days, next_review_at, lapses, total_reviews, status)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
  ).run(id, schedule.stage, schedule.intervalDays, schedule.nextReviewAt, schedule.lapses, schedule.status)

  return getEntryById(id) as Entry
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
    .prepare(`${ENTRY_SELECT} ${whereSql} ORDER BY e.created_at DESC, e.id DESC LIMIT ? OFFSET ?`)
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
  const entry = db.transaction(() => insertEntry(input))()
  return c.json(entry, 201)
})

app.post('/api/entries/bulk', async (c) => {
  const { entries } = bulkInput.parse(await c.req.json())
  const created = db.transaction(() => entries.map((input) => insertEntry(input)))()
  return c.json({ entries: created, count: created.length }, 201)
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
  const fields: string[] = []
  const params: unknown[] = []
  const set = (column: string, value: unknown) => {
    fields.push(`${column} = ?`)
    params.push(value)
  }

  if (input.type !== undefined) set('type', input.type)
  if (input.text !== undefined) set('text', input.text)
  if (input.meaning !== undefined) set('meaning', input.meaning || null)
  if (input.explanation !== undefined) set('explanation', input.explanation || null)
  if (input.examples !== undefined) set('examples', JSON.stringify(input.examples))
  if (input.notes !== undefined) set('notes', input.notes || null)
  if (input.tags !== undefined) set('tags', JSON.stringify(input.tags))
  if (input.source !== undefined) set('source', input.source)

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
