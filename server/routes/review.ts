import { Hono } from 'hono'
import { z } from 'zod'
import type { Entry, ReviewStats } from '../../shared/types'
import { db } from '../db'
import { mapEntry } from '../lib/mappers'
import { ENTRY_SELECT, getEntryById } from '../lib/queries'
import { nextSchedule } from '../lib/scheduler'
import { dayRange, localDateKey, nowIso } from '../lib/time'

const app = new Hono()

const rateInput = z.object({ rating: z.enum(['remembered', 'forgot']) })

app.get('/api/review/queue', (c) => {
  const rawTypes = c.req.query('types') ?? ''
  const types = rawTypes
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is Entry['type'] => value === 'word' || value === 'phrase' || value === 'sentence')

  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50) || 50, 1), 200)
  const now = nowIso()

  const typeSql = types.length ? `AND e.type IN (${types.map(() => '?').join(', ')})` : ''
  const rows = db
    .prepare(
      `${ENTRY_SELECT}
       WHERE r.next_review_at IS NOT NULL AND r.next_review_at <= ?
         AND e.review_enabled = 1 ${typeSql}
       ORDER BY r.next_review_at ASC, e.id ASC
       LIMIT ?`,
    )
    .all(now, ...types, limit)

  return c.json({ items: rows.map(mapEntry), count: rows.length, dueAt: now })
})

app.get('/api/review/stats', (c) => {
  const now = nowIso()
  const { start, end } = dayRange()

  const dueRows = db
    .prepare(
      `SELECT e.type AS type, COUNT(*) AS n
       FROM entries e
       JOIN review_states r ON r.entry_id = e.id
       WHERE r.next_review_at <= ? AND e.review_enabled = 1
       GROUP BY e.type`,
    )
    .all(now) as Array<{ type: Entry['type']; n: number }>

  const due: ReviewStats['due'] = { total: 0, word: 0, phrase: 0, sentence: 0 }
  for (const row of dueRows) {
    const count = Number(row.n)
    due.total += count
    due[row.type] = count
  }

  const reviewedToday = Number(
    (
      db
        .prepare('SELECT COUNT(*) AS n FROM review_logs WHERE reviewed_at >= ? AND reviewed_at < ?')
        .get(start, end) as { n: number }
    ).n,
  )

  const addedToday = Number(
    (
      db
        .prepare('SELECT COUNT(*) AS n FROM entries WHERE created_at >= ? AND created_at < ?')
        .get(start, end) as { n: number }
    ).n,
  )

  const totalEntries = Number((db.prepare('SELECT COUNT(*) AS n FROM entries').get() as { n: number }).n)
  const mastered = Number(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n
           FROM review_states r
           JOIN entries e ON e.id = r.entry_id
           WHERE r.status = 'mastered' AND e.review_enabled = 1`,
        )
        .get() as { n: number }
    ).n,
  )

  const dayRows = db
    .prepare("SELECT DISTINCT date(reviewed_at, 'localtime') AS d FROM review_logs ORDER BY d DESC LIMIT 400")
    .all() as Array<{ d: string }>
  const daySet = new Set(dayRows.map((row) => row.d))
  let streakDays = 0
  const cursor = new Date()
  if (!daySet.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1)
  while (daySet.has(localDateKey(cursor))) {
    streakDays += 1
    cursor.setDate(cursor.getDate() - 1)
  }

  const stats: ReviewStats = {
    due,
    reviewedToday,
    addedToday,
    totalEntries,
    mastered,
    streakDays,
  }
  return c.json(stats)
})

app.post('/api/review/:id/rate', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: '无效的词条 ID' }, 400)

  const body = rateInput.parse(await c.req.json())
  const state = db.prepare('SELECT * FROM review_states WHERE entry_id = ?').get(id) as
    | { stage: number; lapses: number }
    | undefined

  if (!state) return c.json({ error: '词条不存在' }, 404)

  const now = new Date()
  const next = nextSchedule({ stage: state.stage, lapses: state.lapses }, body.rating, now)

  db.transaction(() => {
    db.prepare(
      `UPDATE review_states
       SET stage = ?, interval_days = ?, next_review_at = ?, last_reviewed_at = ?,
           lapses = ?, total_reviews = total_reviews + 1, status = ?
       WHERE entry_id = ?`,
    ).run(
      next.stage,
      next.intervalDays,
      next.nextReviewAt,
      now.toISOString(),
      next.lapses,
      next.status,
      id,
    )

    db.prepare(
      `INSERT INTO review_logs (entry_id, rating, reviewed_at, prev_stage, next_stage, next_review_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, body.rating, now.toISOString(), state.stage, next.stage, next.nextReviewAt)
  })()

  const entry = getEntryById(id)
  return c.json({ entry, state: entry?.review ?? null })
})

export default app
