import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { z } from 'zod'
import type { Entry } from '../../shared/types'
import { getAiConfig, isConfigured } from '../ai/config'
import { streamChat, type ChatTurn } from '../ai/client'
import { buildSystemPrompt } from '../ai/prompts'
import { db } from '../db'
import { mapChatMessage, mapChatSession, mapEntry } from '../lib/mappers'
import { buildSearchFilter, ENTRY_SELECT } from '../lib/queries'
import { dayRange, nowIso } from '../lib/time'

const app = new Hono()

const CHAT_HISTORY_LIMIT = 30
const MEMORY_LIMIT = 30

const streamInput = z.object({
  sessionId: z.number().int().positive().optional(),
  message: z.string().trim().min(1, '消息不能为空').max(8000),
})

function getSession(id: number): any | undefined {
  return db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id)
}

function createSession(title: string | null): number {
  const now = nowIso()
  const info = db
    .prepare('INSERT INTO chat_sessions (title, created_at, updated_at) VALUES (?, ?, ?)')
    .run(title, now, now)
  return Number(info.lastInsertRowid)
}

function insertMessage(sessionId: number, role: 'user' | 'assistant', content: string): number {
  const now = nowIso()
  const info = db
    .prepare('INSERT INTO chat_messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    .run(sessionId, role, content, now)
  db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(now, sessionId)
  return Number(info.lastInsertRowid)
}

/** 组合与当前问题相关的记忆 + 今天新增 + 最近记录，供系统提示词引用。 */
function memoryFor(query: string): Entry[] {
  const { start, end } = dayRange()
  const seen = new Set<number>()
  const result: Entry[] = []

  const push = (rows: any[]) => {
    for (const row of rows) {
      const entry = mapEntry(row)
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      result.push(entry)
    }
  }

  const filter = buildSearchFilter(query)
  if (filter.clause) {
    try {
      push(db.prepare(`${ENTRY_SELECT} WHERE ${filter.clause} ORDER BY e.created_at DESC LIMIT 8`).all(...filter.params))
    } catch {
      // 搜索失败时退化为只使用最近记录
    }
  }

  push(
    db
      .prepare(
        `${ENTRY_SELECT} WHERE e.created_at >= ? AND e.created_at < ? ORDER BY e.created_at DESC LIMIT 12`,
      )
      .all(start, end),
  )
  push(db.prepare(`${ENTRY_SELECT} ORDER BY e.created_at DESC LIMIT 15`).all())

  return result.slice(0, MEMORY_LIMIT)
}

function buildTurns(sessionId: number, userMessage: string): ChatTurn[] {
  const { date } = dayRange()
  const turns: ChatTurn[] = [
    { role: 'system', content: buildSystemPrompt(memoryFor(userMessage), date) },
  ]

  const history = db
    .prepare('SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?')
    .all(sessionId, CHAT_HISTORY_LIMIT) as Array<{ role: 'user' | 'assistant'; content: string }>

  for (const message of history.reverse()) {
    turns.push({ role: message.role, content: message.content })
  }
  return turns
}

app.get('/api/chat/sessions', (c) => {
  const rows = db
    .prepare(
      `SELECT s.*,
        (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS message_count,
        (SELECT m.content FROM chat_messages m WHERE m.session_id = s.id AND m.role = 'user' ORDER BY m.id DESC LIMIT 1) AS preview
       FROM chat_sessions s
       ORDER BY s.updated_at DESC
       LIMIT 100`,
    )
    .all()

  return c.json({ items: rows.map(mapChatSession) })
})

app.post('/api/chat/sessions', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const input = z
    .object({ title: z.string().trim().max(120).optional() })
    .parse(body)
  const id = createSession(input.title || '新对话')
  const session = getSession(id)
  return c.json(
    {
      id,
      title: session.title,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      messageCount: 0,
      preview: null,
    },
    201,
  )
})

app.patch('/api/chat/sessions/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: '无效的对话 ID' }, 400)
  const session = getSession(id)
  if (!session) return c.json({ error: '对话不存在' }, 404)

  const input = z.object({ title: z.string().trim().min(1).max(120) }).parse(await c.req.json())
  db.prepare('UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?').run(
    input.title,
    nowIso(),
    id,
  )
  return c.json({ ok: true })
})

app.delete('/api/chat/sessions/:id', (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: '无效的对话 ID' }, 400)
  const info = db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id)
  if (!info.changes) return c.json({ error: '对话不存在' }, 404)
  return c.json({ ok: true })
})

app.get('/api/chat/sessions/:id/messages', (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: '无效的对话 ID' }, 400)
  if (!getSession(id)) return c.json({ error: '对话不存在' }, 404)

  const rows = db
    .prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY id ASC')
    .all(id)
  return c.json({ items: rows.map(mapChatMessage) })
})

app.post('/api/chat/stream', async (c) => {
  const input = streamInput.parse(await c.req.json())

  if (!isConfigured(getAiConfig())) {
    return c.json({ error: 'AI 尚未配置，请先到「设置」页填写 Base URL、模型和 API Key。' }, 400)
  }

  let sessionId = input.sessionId
  if (sessionId) {
    if (!getSession(sessionId)) return c.json({ error: '对话不存在' }, 404)
  } else {
    sessionId = createSession(input.message.slice(0, 40))
  }

  const session = getSession(sessionId)
  if (!session.title) {
    db.prepare('UPDATE chat_sessions SET title = ? WHERE id = ?').run(
      input.message.slice(0, 40),
      sessionId,
    )
  }

  const userMessageId = insertMessage(sessionId, 'user', input.message)
  const turns = buildTurns(sessionId, input.message)
  const activeSessionId = sessionId
  const controller = new AbortController()

  c.header('Content-Type', 'application/x-ndjson; charset=utf-8')
  c.header('Cache-Control', 'no-cache, no-transform')
  c.header('X-Accel-Buffering', 'no')

  return stream(c, async (s) => {
    s.onAbort(() => controller.abort())

    const send = async (payload: unknown) => {
      try {
        await s.write(`${JSON.stringify(payload)}\n`)
      } catch {
        // 客户端已断开
      }
    }

    await send({ type: 'meta', sessionId: activeSessionId, userMessageId })

    let content = ''
    try {
      for await (const delta of streamChat(turns, { signal: controller.signal })) {
        content += delta
        await send({ type: 'delta', content: delta })
      }

      if (content.trim()) {
        const assistantMessageId = insertMessage(activeSessionId, 'assistant', content)
        await send({ type: 'done', sessionId: activeSessionId, messageId: assistantMessageId })
      } else {
        await send({ type: 'error', error: 'AI 返回了空内容，请稍后重试。' })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (content.trim()) {
        const assistantMessageId = insertMessage(activeSessionId, 'assistant', content)
        await send({
          type: 'done',
          sessionId: activeSessionId,
          messageId: assistantMessageId,
          partial: true,
        })
      } else {
        await send({ type: 'error', error: message })
      }
    }
  })
})

export default app
