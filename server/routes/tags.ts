import { Hono } from 'hono'
import type { TagListResult, TagSummary } from '../../shared/types'
import { db } from '../db'

const app = new Hono()

app.get('/api/tags', (c) => {
  const rows = db
    .prepare(
      `SELECT
         json_each.value AS tag,
         COUNT(*) AS n,
         SUM(CASE WHEN e.learned_at IS NULL THEN 1 ELSE 0 END) AS unlearned
       FROM entries e, json_each(e.tags)
       WHERE trim(json_each.value) <> ''
       GROUP BY json_each.value
       ORDER BY n DESC, tag COLLATE NOCASE ASC`,
    )
    .all() as Array<{ tag: string; n: number; unlearned: number | null }>

  const items: TagSummary[] = rows.map((row) => ({
    tag: String(row.tag),
    count: Number(row.n ?? 0),
    unlearned: Number(row.unlearned ?? 0),
  }))

  const result: TagListResult = { items }
  return c.json(result)
})

export default app
