import { Hono } from 'hono'
import { z } from 'zod'
import type { AiWordExplanation } from '../../shared/types'
import { completeChat } from '../ai/client'
import { getAiConfig, isConfigured } from '../ai/config'
import {
  buildExampleSystemPrompt,
  buildExampleUserPrompt,
  buildWordExplainSystemPrompt,
  buildWordExplainUserPrompt,
} from '../ai/prompts'
import { db } from '../db'
import { getAiTeachingSettings } from '../lib/ai-teaching'
import { topActiveErrors } from '../lib/errors'
import { getEntryById } from '../lib/queries'
import { normalizeEntryText } from '../lib/text'
import { nowIso } from '../lib/time'

const app = new Hono()

const input = z.object({
  count: z.number().int().min(1).max(5).default(3),
})

const exampleSchema = z.object({
  examples: z
    .array(
      z.object({
        en: z.string().trim().min(1).max(800),
        zh: z.string().trim().max(800).default(''),
      }),
    )
    .max(6)
    .default([]),
})

function parseExamples(raw: string): Array<{ en: string; zh: string }> {
  let text = raw.trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) text = fenced[1].trim()

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      const parsed = exampleSchema.parse(JSON.parse(text.slice(start, end + 1)))
      return parsed.examples
    } catch {
      // fallthrough
    }
  }
  return []
}

/** 已有例句可能带「 — 中文」，只比较英文部分。 */
function exampleLead(text: string): string {
  return text.split(/\s+[—–-]\s+/)[0] ?? text
}

const wordExplainSchema = z.object({
  meaning: z.string().trim().max(4000).default(''),
  englishDefinition: z.string().trim().max(8000).default(''),
  explanation: z.string().trim().max(8000).default(''),
  phonetic: z.string().trim().max(200).default(''),
  examples: z
    .array(
      z.object({
        en: z.string().trim().min(1).max(1000),
        zh: z.string().trim().max(1000).default(''),
      }),
    )
    .max(6)
    .default([]),
})

/** 从模型输出中提取并清洗单词草稿；格式不合格时返回 null。 */
function parseWordExplanation(
  raw: string,
  mode: 'bilingual' | 'english',
): AiWordExplanation | null {
  let text = raw.trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) text = fenced[1].trim()

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null

  try {
    const parsed = wordExplainSchema.parse(JSON.parse(text.slice(start, end + 1)))
    const examples = parsed.examples
      .map((item) => (mode === 'english' || !item.zh ? item.en : `${item.en} — ${item.zh}`))
      .filter(Boolean)
      .slice(0, 3)

    const draft: AiWordExplanation = {
      text: '',
      meaning: parsed.meaning || null,
      englishDefinition: parsed.englishDefinition || null,
      explanation: parsed.explanation || null,
      examples,
      phonetic: parsed.phonetic || null,
    }
    if (!draft.meaning && !draft.englishDefinition && !draft.explanation && !examples.length) {
      return null
    }
    return draft
  } catch {
    return null
  }
}

const explainInput = z.object({
  text: z.string().trim().min(1, '内容不能为空').max(200),
})

/** 词条详情里点击一个词库中不存在的单词时，让 AI 生成一份草稿。 */
app.post('/api/entries/explain', async (c) => {
  const { text } = explainInput.parse(await c.req.json())

  if (!isConfigured(getAiConfig())) {
    return c.json({ error: 'AI 尚未配置，请先到「设置」页填写 Base URL、模型和 API Key。' }, 400)
  }

  const existingRow = db
    .prepare('SELECT id FROM entries WHERE normalized_text = ? LIMIT 1')
    .get(normalizeEntryText(text)) as { id: number } | undefined
  if (existingRow) {
    const existing = getEntryById(existingRow.id)
    return c.json(
      {
        error: `词库中已存在相同的英文内容「${existing?.text ?? text}」。`,
        existingEntryId: existingRow.id,
      },
      409,
    )
  }

  const teaching = getAiTeachingSettings()
  try {
    const raw = await completeChat(
      [
        {
          role: 'system',
          content: buildWordExplainSystemPrompt(teaching.explanationMode),
        },
        {
          role: 'user',
          content: buildWordExplainUserPrompt({
            text,
            explanationMode: teaching.explanationMode,
          }),
        },
      ],
      { temperature: 0.4, maxTokens: 900 },
    )

    const draft = parseWordExplanation(raw, teaching.explanationMode)
    if (!draft) {
      return c.json({ error: 'AI 没有返回可用的释义，请稍后重试。' }, 502)
    }

    return c.json({ draft: { ...draft, text } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: `生成释义失败：${message}` }, 502)
  }
})


app.post('/api/entries/:id/examples', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: '无效的词条 ID' }, 400)

  if (!isConfigured(getAiConfig())) {
    return c.json({ error: 'AI 尚未配置，请先到「设置」页填写 Base URL、模型和 API Key。' }, 400)
  }

  const entry = getEntryById(id)
  if (!entry) return c.json({ error: '词条不存在' }, 404)

  const { count } = input.parse(await c.req.json().catch(() => ({})))
  const teaching = getAiTeachingSettings()
  const sceneNames = [
    ...new Set(entry.sceneRefs.map((ref) => ref.sceneName).filter(Boolean)),
  ]

  try {
    const raw = await completeChat(
      [
        { role: 'system', content: buildExampleSystemPrompt(teaching.explanationMode) },
        {
          role: 'user',
          content: buildExampleUserPrompt({
            entry,
            sceneNames,
            errors: topActiveErrors(5),
            explanationMode: teaching.explanationMode,
          }),
        },
      ],
      { temperature: 0.7, maxTokens: 800 },
    )

    const parsed = parseExamples(raw)
    if (!parsed.length) {
      return c.json({ error: 'AI 没有返回可用的例句，请稍后重试。' }, 502)
    }

    const existing = new Set(
      entry.examples.map((example) => normalizeEntryText(exampleLead(example))),
    )
    const merged = [...entry.examples]
    const added: Array<{ en: string; zh: string }> = []

    for (const example of parsed) {
      const key = normalizeEntryText(example.en)
      if (!key || existing.has(key)) continue
      existing.add(key)
      merged.push(
        teaching.explanationMode === 'english' || !example.zh
          ? example.en
          : `${example.en} — ${example.zh}`,
      )
      added.push(example)
      if (added.length >= count) break
    }

    if (added.length) {
      // 多义词的新例句归入第一个义项，并同步更新顶层例句摘要。
      const newExamples = merged.slice(entry.examples.length)
      const senses = entry.senses.length
        ? entry.senses.map((sense, index) =>
            index === 0
              ? {
                  ...sense,
                  examples: [
                    ...sense.examples,
                    ...newExamples.filter(
                      (example) => !sense.examples.includes(example),
                    ),
                  ],
                }
              : sense,
          )
        : entry.senses
      if (entry.senses.length) {
        db.prepare(
          'UPDATE entries SET examples = ?, senses = ?, updated_at = ? WHERE id = ?',
        ).run(JSON.stringify(merged), JSON.stringify(senses), nowIso(), id)
      } else {
        db.prepare('UPDATE entries SET examples = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify(merged),
          nowIso(),
          id,
        )
      }
    }

    return c.json({
      entry: getEntryById(id),
      added: added.length,
      examples: added,
      message: added.length
        ? undefined
        : 'AI 生成的例句与已有例句重复，没有添加新内容。',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: `生成例句失败：${message}` }, 502)
  }
})

export default app
