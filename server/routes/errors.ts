import { Hono } from 'hono'
import { z } from 'zod'
import type { LearnerErrorStatus } from '../../shared/types'
import {
  deleteLearnerError,
  listLearnerErrors,
  updateLearnerErrorStatus,
} from '../lib/errors'

const app = new Hono()

const statusInput = z.object({
  status: z.enum(['active', 'resolved', 'ignored']),
})

app.get('/api/errors', (c) => {
  const rawStatus = c.req.query('status')
  const status =
    rawStatus === 'active' || rawStatus === 'resolved' || rawStatus === 'ignored'
      ? (rawStatus as LearnerErrorStatus)
      : undefined
  const limit = Number(c.req.query('limit') ?? 20)
  return c.json({ items: listLearnerErrors({ status, limit }) })
})

app.patch('/api/errors/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: '无效的错误 ID' }, 400)

  const input = statusInput.parse(await c.req.json())
  const error = updateLearnerErrorStatus(id, input.status)
  if (!error) return c.json({ error: '错误记录不存在' }, 404)
  return c.json(error)
})

app.delete('/api/errors/:id', (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: '无效的错误 ID' }, 400)
  if (!deleteLearnerError(id)) return c.json({ error: '错误记录不存在' }, 404)
  return c.json({ ok: true })
})

export default app
