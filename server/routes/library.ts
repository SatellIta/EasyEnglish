import { Hono } from 'hono'
import type { Entry, LibraryDateGroup, LibraryOverview, SceneCounts } from '../../shared/types'
import { db } from '../db'
import { mapEntry } from '../lib/mappers'
import { buildSearchFilter, ENTRY_SELECT } from '../lib/queries'
import { listSceneSummaries } from '../lib/scenes'

const app = new Hono()

app.get('/api/library/overview', (c) => {
  const typeRows = db
    .prepare('SELECT type, COUNT(*) AS n FROM entries GROUP BY type')
    .all() as Array<{ type: Entry['type']; n: number }>

  const types: SceneCounts = { total: 0, word: 0, phrase: 0, sentence: 0 }
  for (const row of typeRows) {
    const count = Number(row.n)
    types.total += count
    types[row.type] = count
  }

  const dateRows = db
    .prepare(
      `SELECT date(created_at, 'localtime') AS d, type, COUNT(*) AS n
       FROM entries
       GROUP BY d, type
       ORDER BY d DESC`,
    )
    .all() as Array<{ d: string; type: Entry['type']; n: number }>

  const byDate = new Map<string, LibraryDateGroup>()
  for (const row of dateRows) {
    if (!row.d) continue
    let group = byDate.get(row.d)
    if (!group) {
      group = { date: row.d, total: 0, word: 0, phrase: 0, sentence: 0 }
      byDate.set(row.d, group)
    }
    const count = Number(row.n)
    group.total += count
    group[row.type] = count
  }

  const overview: LibraryOverview = {
    dates: [...byDate.values()],
    types,
    scenes: listSceneSummaries(),
  }
  return c.json(overview)
})

app.get('/api/library/date/:date', (c) => {
  const date = c.req.param('date')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: '无效的日期格式，应为 YYYY-MM-DD' }, 400)
  }

  const type = c.req.query('type') ?? ''
  const q = c.req.query('q') ?? ''
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 500) || 500, 1), 1000)

  const where: string[] = [`date(e.created_at, 'localtime') = ?`]
  const params: unknown[] = [date]

  if (type === 'word' || type === 'phrase' || type === 'sentence') {
    where.push('e.type = ?')
    params.push(type)
  }

  if (q.trim()) {
    const filter = buildSearchFilter(q)
    if (filter.clause) {
      where.push(filter.clause)
      params.push(...filter.params)
    }
  }

  const whereSql = `WHERE ${where.join(' AND ')}`
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM entries e ${whereSql}`)
    .get(...params) as { n: number }
  const rows = db
    .prepare(`${ENTRY_SELECT} ${whereSql} ORDER BY e.created_at DESC, e.id DESC LIMIT ?`)
    .all(...params, limit)

  return c.json({
    date,
    items: rows.map(mapEntry),
    total: Number(totalRow.n),
    limit,
  })
})

export default app
