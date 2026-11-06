import { Hono } from 'hono'
import { z } from 'zod'
import type { DraftEntry, SummaryResult } from '../../shared/types'
import { completeChat } from '../ai/client'
import { getAiConfig, isConfigured } from '../ai/config'
import { buildSummaryUserPrompt, SUMMARY_SYSTEM_PROMPT } from '../ai/prompts'
import { db } from '../db'
import { mapDailySummary, mapEntry } from '../lib/mappers'
import { ENTRY_SELECT } from '../lib/queries'
import { dayRange, nowIso } from '../lib/time'

const app = new Hono()

const draftSchema = z.object({
  type: z.enum(['word', 'phrase', 'sentence']),
  text: z.string().trim().min(1).max(2000),
  meaning: z.string().trim().max(4000).nullish(),
  explanation: z.string().trim().max(8000).nullish(),
})

const summarySchema = z.object({
  summary: z.string().min(1),
  entries: z.array(draftSchema).max(30).default([]),
})

function parseSummary(raw: string): { summary: string; entries: DraftEntry[] } {
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
        })),
      }
    } catch {
      // 退化为纯 Markdown 总结
    }
  }

  return { summary: text || raw, entries: [] }
}

app.get('/api/summary/today', (c) => {
  const { date } = dayRange()
  const row = db.prepare('SELECT * FROM daily_summaries WHERE date = ?').get(date)
  return c.json({ date, summary: row ? mapDailySummary(row) : null })
})

app.post('/api/summary/today/generate', async (c) => {
  if (!isConfigured(getAiConfig())) {
    return c.json({ error: 'AI 尚未配置，请先到「设置」页填写 Base URL、模型和 API Key。' }, 400)
  }

  const { start, end, date } = dayRange()

  const messages = db
    .prepare(
      `SELECT role, content FROM chat_messages
       WHERE created_at >= ? AND created_at < ? AND role IN ('user', 'assistant')
       ORDER BY id ASC`,
    )
    .all(start, end) as Array<{ role: 'user' | 'assistant'; content: string }>

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

  try {
    const raw = await completeChat(
      [
        { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildSummaryUserPrompt({ date, messages, entries }),
        },
      ],
      { temperature: 0.3, maxTokens: 3000 },
    )

    const parsed = parseSummary(raw)
    const now = nowIso()
    db.prepare(
      `INSERT INTO daily_summaries (date, content, entries, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         content = excluded.content,
         entries = excluded.entries,
         updated_at = excluded.updated_at`,
    ).run(date, parsed.summary, JSON.stringify(parsed.entries), now, now)

    const result: SummaryResult = {
      date,
      summary: parsed.summary,
      entries: parsed.entries,
      saved: true,
    }
    return c.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: `AI 整理失败：${message}` }, 502)
  }
})

export default app
