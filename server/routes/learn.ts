import { Hono } from 'hono'
import { z } from 'zod'
import type {
  Entry,
  EntryType,
  LearnCompleteResult,
  LearnQueue,
  LearnStats,
} from '../../shared/types'
import { db } from '../db'
import { mapEntry } from '../lib/mappers'
import { ENTRY_SELECT } from '../lib/queries'
import { addDays, nowIso } from '../lib/time'

const app = new Hono()

const completeInput = z.object({
  known: z.array(z.number().int().positive()).max(200).default([]),
  unknown: z.array(z.number().int().positive()).max(200).default([]),
})

function parseTypes(raw: string | undefined): EntryType[] {
  const types = (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is EntryType =>
      value === 'word' || value === 'phrase' || value === 'sentence',
    )
  return types.length ? types : ['word', 'phrase', 'sentence']
}

app.get('/api/learn/stats', (c) => {
  const row = db
    .prepare(
      `SELECT
         count(*) AS total,
         sum(CASE WHEN learned_at IS NULL THEN 1 ELSE 0 END) AS unlearned
       FROM entries`,
    )
    .get() as { total: number; unlearned: number | null }
  const total = Number(row.total ?? 0)
  const unlearned = Number(row.unlearned ?? 0)
  const stats: LearnStats = { total, unlearned, learned: Math.max(total - unlearned, 0) }
  return c.json(stats)
})

app.get('/api/learn/queue', (c) => {
  const size = Math.min(Math.max(Number(c.req.query('size') ?? 10) || 10, 1), 50)
  const types = parseTypes(c.req.query('types'))
  const placeholders = types.map(() => '?').join(', ')

  const totalRow = db
    .prepare(
      `SELECT count(*) AS n FROM entries e
       WHERE e.learned_at IS NULL AND e.type IN (${placeholders})`,
    )
    .get(...types) as { n: number }
  const rows = db
    .prepare(
      `${ENTRY_SELECT}
       WHERE e.learned_at IS NULL AND e.type IN (${placeholders})
       ORDER BY RANDOM()
       LIMIT ?`,
    )
    .all(...types, size) as any[]

  const result: LearnQueue = {
    items: rows.map(mapEntry) as Entry[],
    totalUnlearned: Number(totalRow.n ?? 0),
  }
  return c.json(result)
})

app.post('/api/learn/complete', async (c) => {
  const input = completeInput.parse(await c.req.json())
  const knownIds = [...new Set(input.known)]
  const unknownIds = new Set(input.unknown.filter((id) => !knownIds.includes(id)))

  const now = nowIso()
  const tomorrow = addDays(new Date(now), 1).toISOString()
  const check = db.prepare('SELECT id FROM entries WHERE id = ? AND learned_at IS NULL')
  const markEntry = db.prepare(
    'UPDATE entries SET learned_at = ?, review_enabled = 1, updated_at = ? WHERE id = ?',
  )
  const upsertState = db.prepare(
    `INSERT INTO review_states
       (entry_id, stage, interval_days, next_review_at, last_reviewed_at, lapses, total_reviews, status)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?)
     ON CONFLICT(entry_id) DO UPDATE SET
       stage = excluded.stage,
       interval_days = excluded.interval_days,
       next_review_at = excluded.next_review_at,
       last_reviewed_at = excluded.last_reviewed_at,
       status = excluded.status`,
  )

  const result: LearnCompleteResult = {
    learned: 0,
    known: 0,
    unknown: 0,
    skipped: 0,
  }

  db.transaction(() => {
    for (const id of knownIds) {
      if (!check.get(id)) {
        result.skipped += 1
        continue
      }
      markEntry.run(now, now, id)
      upsertState.run(id, 1, 1, tomorrow, now, 'reviewing')
      result.known += 1
      result.learned += 1
    }
    for (const id of unknownIds) {
      if (!check.get(id)) {
        result.skipped += 1
        continue
      }
      markEntry.run(now, now, id)
      upsertState.run(id, 0, 0, now, now, 'learning')
      result.unknown += 1
      result.learned += 1
    }
  })()

  return c.json(result)
})

export default app
