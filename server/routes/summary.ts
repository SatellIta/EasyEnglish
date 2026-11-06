import { Hono } from 'hono'
import { z } from 'zod'
import type {
  DraftEntry,
  LearnerError,
  LearnerErrorDraft,
  SceneSuggestion,
  SummaryResult,
} from '../../shared/types'
import { completeChat } from '../ai/client'
import { getAiConfig, isConfigured } from '../ai/config'
import { buildSummarySystemPrompt, buildSummaryUserPrompt } from '../ai/prompts'
import { db } from '../db'
import { markDraftDuplicates } from '../lib/dedupe'
import { getAiTeachingSettings } from '../lib/ai-teaching'
import { upsertLearnerError } from '../lib/errors'
import { mapDailySummary, mapEntry } from '../lib/mappers'
import { ENTRY_SELECT } from '../lib/queries'
import { listSceneSummaries } from '../lib/scenes'
import { dayRange, nowIso } from '../lib/time'

const app = new Hono()

const sceneSuggestionSchema = z.object({
  action: z.enum(['existing', 'new', 'none']).default('none'),
  sceneId: z.number().int().positive().nullish(),
  sceneName: z.string().trim().max(60).nullish(),
  section: z.string().trim().max(200).nullish(),
  reason: z.string().trim().max(300).nullish(),
})

type RawSceneSuggestion = z.infer<typeof sceneSuggestionSchema>

const draftSchema = z.object({
  type: z.enum(['word', 'phrase', 'sentence']),
  text: z.string().trim().min(1).max(2000),
  meaning: z.string().trim().max(4000).nullish(),
  explanation: z.string().trim().max(8000).nullish(),
  scene: sceneSuggestionSchema.nullish(),
})

const errorDraftSchema = z.object({
  pattern: z.string().trim().min(1).max(300),
  category: z
    .enum(['grammar', 'usage', 'spelling', 'pronunciation', 'other'])
    .default('other'),
  explanation: z.string().trim().max(2000).nullish(),
  correction: z.string().trim().max(2000).nullish(),
  example: z.string().trim().max(2000).nullish(),
})

const summarySchema = z.object({
  summary: z.string().min(1),
  entries: z.array(draftSchema).max(30).default([]),
  errors: z.array(errorDraftSchema).max(20).default([]),
})

function parseSummary(raw: string): {
  summary: string
  entries: Array<DraftEntry & { scene?: RawSceneSuggestion | null }>
  errors: LearnerErrorDraft[]
} {
  let text = raw.trim()

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) text = fenced[1].trim()

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1))
      const validated = summarySchema.parse(parsed)
      return {
        summary: validated.summary,
        entries: validated.entries.map((entry) => ({
          type: entry.type,
          text: entry.text,
          meaning: entry.meaning ?? null,
          explanation: entry.explanation ?? null,
          scene: entry.scene ?? null,
        })),
        errors: validated.errors.map((error) => ({
          pattern: error.pattern,
          category: error.category,
          explanation: error.explanation ?? null,
          correction: error.correction ?? null,
          example: error.example ?? null,
        })),
      }
    } catch {
      // 退化为纯 Markdown 总结
    }
  }

  return { summary: text || raw, entries: [], errors: [] }
}

function resolveSceneSuggestion(
  raw: RawSceneSuggestion | null | undefined,
  sceneById: Map<number, { id: number; name: string }>,
  sceneByName: Map<string, { id: number; name: string }>,
): SceneSuggestion | null {
  if (!raw || raw.action === 'none') return null

  if (raw.action === 'existing') {
    const byId = raw.sceneId ? sceneById.get(raw.sceneId) : null
    const byName = raw.sceneName
      ? sceneByName.get(raw.sceneName.trim().toLowerCase())
      : null
    const scene = byId ?? byName
    if (!scene) return null
    return {
      action: 'existing',
      sceneId: scene.id,
      sceneName: scene.name,
      section: raw.section ?? null,
      reason: raw.reason ?? null,
    }
  }

  const name = raw.sceneName?.trim()
  if (!name) return null
  const existing = sceneByName.get(name.toLowerCase())
  if (existing) {
    return {
      action: 'existing',
      sceneId: existing.id,
      sceneName: existing.name,
      section: raw.section ?? null,
      reason: raw.reason ?? null,
    }
  }
  return {
    action: 'new',
    sceneId: null,
    sceneName: name,
    section: raw.section ?? null,
    reason: raw.reason ?? null,
  }
}

/** 在今天的对话里找包含该词条的最新一条消息，用于溯源。 */
function findSourceMessage(
  text: string,
  start: string,
  end: string,
): { sessionId: number; messageId: number } | null {
  const row = db
    .prepare(
      `SELECT id, session_id FROM chat_messages
       WHERE created_at >= ? AND created_at < ?
         AND instr(lower(content), lower(?)) > 0
       ORDER BY id DESC LIMIT 1`,
    )
    .get(start, end, text) as { id: number; session_id: number } | undefined
  return row ? { sessionId: row.session_id, messageId: row.id } : null
}

app.get('/api/summary/today', (c) => {
  const { date } = dayRange()
  const row = db.prepare('SELECT * FROM daily_summaries WHERE date = ?').get(date)
  if (!row) return c.json({ date, summary: null })
  const saved = mapDailySummary(row)
  return c.json({
    date,
    summary: {
      ...saved,
      // 重新核对当前词库，避免保存后新增词条导致重复标记过期。
      entries: markDraftDuplicates(saved.entries),
    },
  })
})

app.post('/api/summary/today/generate', async (c) => {
  if (!isConfigured(getAiConfig())) {
    return c.json({ error: 'AI 尚未配置，请先到「设置」页填写 Base URL、模型和 API Key。' }, 400)
  }

  const { start, end, date } = dayRange()

  const messages = db
    .prepare(
      `SELECT id, session_id, role, content FROM chat_messages
       WHERE created_at >= ? AND created_at < ? AND role IN ('user', 'assistant')
       ORDER BY id ASC`,
    )
    .all(start, end) as Array<{
    id: number
    session_id: number
    role: 'user' | 'assistant'
    content: string
  }>

  const addedRows = db
    .prepare(`${ENTRY_SELECT} WHERE e.created_at >= ? AND e.created_at < ? ORDER BY e.created_at ASC`)
    .all(start, end)
  const reviewedRows = db
    .prepare(
      `${ENTRY_SELECT}
       WHERE e.id IN (SELECT entry_id FROM review_logs WHERE reviewed_at >= ? AND reviewed_at < ?)
       ORDER BY e.created_at ASC`,
    )
    .all(start, end)

  const seen = new Set<number>()
  const entries = [...addedRows, ...reviewedRows].map(mapEntry).filter((entry) => {
    if (seen.has(entry.id)) return false
    seen.add(entry.id)
    return true
  })

  if (!messages.length && !entries.length) {
    return c.json({ error: '今天还没有学习记录。先去对话里问点什么，或添加几个词条吧。' }, 400)
  }

  const existingTexts = (
    db
      .prepare('SELECT text FROM entries ORDER BY created_at DESC, id DESC LIMIT 120')
      .all() as Array<{ text: string }>
  ).map((row) => row.text)

  const existingScenes = listSceneSummaries()
  const teaching = getAiTeachingSettings()
  const sceneById = new Map(
    existingScenes.map((scene) => [scene.id, { id: scene.id, name: scene.name }]),
  )
  const sceneByName = new Map<string, { id: number; name: string }>(
    existingScenes.map((scene) => [
      scene.name.trim().toLowerCase(),
      { id: scene.id, name: scene.name },
    ]),
  )

  try {
    const raw = await completeChat(
      [
        { role: 'system', content: buildSummarySystemPrompt(teaching.explanationMode) },
        {
          role: 'user',
          content: buildSummaryUserPrompt({
            date,
            messages,
            entries,
            existingTexts,
            scenes: existingScenes.map((scene) => ({
              id: scene.id,
              name: scene.name,
              description: scene.description,
            })),
            explanationMode: teaching.explanationMode,
          }),
        },
      ],
      { temperature: 0.3, maxTokens: 3500 },
    )

    const parsed = parseSummary(raw)
    const marked = markDraftDuplicates(parsed.entries) as Array<
      DraftEntry & { scene?: RawSceneSuggestion | null }
    >
    const candidates: DraftEntry[] = marked.map((entry) => {
      const sceneSuggestion = resolveSceneSuggestion(
        entry.scene,
        sceneById,
        sceneByName,
      )
      const source = findSourceMessage(entry.text, start, end)
      return {
        type: entry.type,
        text: entry.text,
        meaning: entry.meaning ?? null,
        explanation: entry.explanation ?? null,
        duplicate: entry.duplicate,
        existingEntryId: entry.existingEntryId ?? null,
        sourceSessionId: source?.sessionId ?? null,
        sourceMessageId: source?.messageId ?? null,
        sceneSuggestion,
        sceneAccepted: Boolean(sceneSuggestion),
      }
    })

    const savedErrors: LearnerError[] = []
    const seenErrorIds = new Set<number>()
    for (const draft of parsed.errors) {
      const saved = upsertLearnerError(draft)
      if (saved && !seenErrorIds.has(saved.id)) {
        seenErrorIds.add(saved.id)
        savedErrors.push(saved)
      }
    }

    const now = nowIso()
    db.prepare(
      `INSERT INTO daily_summaries (date, content, entries, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         content = excluded.content,
         entries = excluded.entries,
         updated_at = excluded.updated_at`,
    ).run(date, parsed.summary, JSON.stringify(candidates), now, now)

    const result: SummaryResult = {
      date,
      summary: parsed.summary,
      entries: candidates,
      errors: savedErrors,
      saved: true,
    }
    return c.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: `AI 整理失败：${message}` }, 502)
  }
})

export default app
