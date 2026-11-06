import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { z } from 'zod'
import type { Entry } from '../../shared/types'
import { getAiConfig, isConfigured } from '../ai/config'
import { streamChat, type ChatTurn } from '../ai/client'
import { buildSystemPrompt, type ScenePromptContext } from '../ai/prompts'
import { db } from '../db'
import { getAiBehaviorSettings } from '../lib/ai-behavior'
import { getAiTeachingSettings } from '../lib/ai-teaching'
import { topActiveErrors } from '../lib/errors'
import { getSelectedPersona } from '../lib/personas'
import { mapChatMessage, mapChatSession, mapEntry } from '../lib/mappers'
import { buildSearchFilter, ENTRY_SELECT } from '../lib/queries'
import { dayRange, nowIso } from '../lib/time'

const app = new Hono()

const streamInput = z.object({
  sessionId: z.number().int().positive().optional(),
  sceneId: z.number().int().positive().optional(),
  message: z.string().trim().min(1, '消息不能为空').max(8000),
})

function getSession(id: number): any | undefined {
  return db
    .prepare(
      `SELECT s.*, sc.name AS scene_name
       FROM chat_sessions s
       LEFT JOIN scenes sc ON sc.id = s.scene_id
       WHERE s.id = ?`,
    )
    .get(id)
}

function createSession(title: string | null, sceneId: number | null = null): number {
  const now = nowIso()
  const info = db
    .prepare(
      'INSERT INTO chat_sessions (title, scene_id, created_at, updated_at) VALUES (?, ?, ?, ?)',
    )
    .run(title, sceneId, now, now)
  return Number(info.lastInsertRowid)
}

function getSceneContext(sceneId: number): ScenePromptContext | null {
  const scene = db
    .prepare('SELECT id, name, description FROM scenes WHERE id = ?')
    .get(sceneId) as { id: number; name: string; description: string | null } | undefined
  if (!scene) return null

  const sections = db
    .prepare(
      `SELECT DISTINCT section FROM scene_entries
       WHERE scene_id = ? AND section IS NOT NULL AND trim(section) <> ''
       ORDER BY section`,
    )
    .all(sceneId) as Array<{ section: string }>

  return {
    id: scene.id,
    name: scene.name,
    description: scene.description ?? null,
    sections: sections.map((row) => row.section),
  }
}

function insertMessage(sessionId: number, role: 'user' | 'assistant', content: string): number {
  const now = nowIso()
  const info = db
    .prepare('INSERT INTO chat_messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)')
    .run(sessionId, role, content, now)
  db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(now, sessionId)
  return Number(info.lastInsertRowid)
}

/**
 * 组合记忆：到期词 + 高错误率词 + 与当前问题相关的词 + 今天新增 + 最近记录。
 * 按优先级填充，并由设置里的 memoryLimit 控制总量。
 */
function memoryFor(
  query: string,
  limit: number,
  sceneId: number | null = null,
): Entry[] {
  const { start, end } = dayRange()
  const seen = new Set<number>()
  const result: Entry[] = []

  const push = (rows: any[]) => {
    for (const row of rows) {
      if (result.length >= limit) return
      const entry = mapEntry(row)
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      result.push(entry)
    }
  }

  // 0. 场景练习：优先注入本场景词句，让对话围绕场景展开。
  if (sceneId) {
    push(
      db
        .prepare(
          `${ENTRY_SELECT}
           WHERE e.id IN (SELECT entry_id FROM scene_entries WHERE scene_id = ?)
           ORDER BY e.error_rate DESC, e.created_at DESC
           LIMIT ?`,
        )
        .all(sceneId, Math.min(12, limit)),
    )
  }

  // 1. 现在到期、且错误率高的词：最需要在本轮被自然复现。
  push(
    db
      .prepare(
        `${ENTRY_SELECT}
         WHERE e.review_enabled = 1
           AND r.next_review_at IS NOT NULL
           AND r.next_review_at <= ?
         ORDER BY e.error_rate DESC, r.next_review_at ASC
         LIMIT ?`,
      )
      .all(nowIso(), Math.min(5, limit)),
  )

  // 2. 反复出错的词，即使还没到期。
  push(
    db
      .prepare(
        `${ENTRY_SELECT}
         WHERE e.review_enabled = 1 AND e.error_rate >= 0.35
         ORDER BY e.error_rate DESC, r.last_reviewed_at DESC
         LIMIT ?`,
      )
      .all(Math.min(3, limit)),
  )

  // 3. 与当前问题相关的词。
  const filter = buildSearchFilter(query)
  if (filter.clause) {
    try {
      push(
        db
          .prepare(
            `${ENTRY_SELECT} WHERE ${filter.clause}
             ORDER BY e.error_rate DESC, e.created_at DESC LIMIT ?`,
          )
          .all(...filter.params, Math.min(4, limit)),
      )
    } catch {
      // 搜索失败时继续用后面的桶
    }
  }

  // 4. 今天新增。
  push(
    db
      .prepare(
        `${ENTRY_SELECT} WHERE e.created_at >= ? AND e.created_at < ?
         ORDER BY e.error_rate DESC, e.created_at DESC LIMIT ?`,
      )
      .all(start, end, Math.min(4, limit)),
  )

  // 5. 最近记录兜底。
  if (result.length < limit) {
    push(
      db
        .prepare(`${ENTRY_SELECT} ORDER BY e.created_at DESC LIMIT ?`)
        .all(limit - result.length),
    )
  }

  return result
}

function buildTurns(sessionId: number, userMessage: string): ChatTurn[] {
  const { date } = dayRange()
  const behavior = getAiBehaviorSettings()
  const teaching = getAiTeachingSettings()
  const persona = getSelectedPersona()
  const session = getSession(sessionId)
  const sceneId = session?.scene_id ?? null
  const scene = sceneId ? getSceneContext(sceneId) : null

  const turns: ChatTurn[] = [
    {
      role: 'system',
      content: buildSystemPrompt(
        memoryFor(userMessage, behavior.memoryLimit, sceneId),
        date,
        {
          errors: topActiveErrors(8),
          memoryCharBudget: behavior.memoryCharBudget,
          scene,
          explanationMode: teaching.explanationMode,
          persona: persona
            ? { id: persona.id, name: persona.name, prompt: persona.prompt }
            : null,
        },
      ),
    },
  ]

  const history = db
    .prepare('SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?')
    .all(sessionId, behavior.historyLimit) as Array<{
    role: 'user' | 'assistant'
    content: string
  }>

  for (const message of history.reverse()) {
    turns.push({ role: message.role, content: message.content })
  }
  return turns
}

app.get('/api/chat/sessions', (c) => {
  const rows = db
    .prepare(
      `SELECT s.*, sc.name AS scene_name,
        (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS message_count,
        (SELECT m.content FROM chat_messages m WHERE m.session_id = s.id AND m.role = 'user' ORDER BY m.id DESC LIMIT 1) AS preview
       FROM chat_sessions s
       LEFT JOIN scenes sc ON sc.id = s.scene_id
       ORDER BY s.updated_at DESC
       LIMIT 100`,
    )
    .all()

  return c.json({ items: rows.map(mapChatSession) })
})

app.post('/api/chat/sessions', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const input = z
    .object({
      title: z.string().trim().max(120).optional(),
      sceneId: z.number().int().positive().optional(),
    })
    .parse(body)

  let sceneId = input.sceneId ?? null
  let sceneName: string | null = null
  if (sceneId) {
    const scene = db.prepare('SELECT id, name FROM scenes WHERE id = ?').get(sceneId) as
      | { id: number; name: string }
      | undefined
    if (!scene) return c.json({ error: '场景不存在' }, 404)
    sceneName = scene.name
  }

  const title = input.title || (sceneName ? `${sceneName} · 场景练习` : '新对话')
  const id = createSession(title, sceneId)
  const session = getSession(id)
  return c.json(mapChatSession(session), 201)
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

  const info = db.transaction(() => {
    // 对话删除后清空词条上的溯源指针，避免前端跳到不存在的会话。
    db.prepare(
      `UPDATE entries
       SET source_session_id = NULL, source_message_id = NULL
       WHERE source_session_id = ?`,
    ).run(id)
    return db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id)
  })()

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
    if (input.sceneId) {
      const scene = db.prepare('SELECT id FROM scenes WHERE id = ?').get(input.sceneId)
      if (!scene) return c.json({ error: '场景不存在' }, 404)
    }
    sessionId = createSession(input.message.slice(0, 40), input.sceneId ?? null)
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
