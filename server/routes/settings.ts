import { Hono } from 'hono'
import { z } from 'zod'
import { testConnection } from '../ai/client'
import { getAiConfig, isLocalUrl, publicSettings } from '../ai/config'
import {
  getAiBehaviorSettings,
  saveAiBehaviorSettings,
} from '../lib/ai-behavior'
import { getAiTeachingSettings, saveAiTeachingSettings } from '../lib/ai-teaching'
import {
  getMarkdownSyncPath,
  saveMarkdownSyncPath,
} from '../lib/markdown-sync'
import { getReviewConfig, saveReviewConfig } from '../lib/review-config'
import { deleteSetting, setSetting } from '../lib/settings'

const app = new Hono()

const updateInput = z.object({
  baseUrl: z.string().trim().url('Base URL 必须是合法地址').optional(),
  model: z.string().trim().min(1).max(200).optional(),
  apiKey: z.string().trim().max(500).optional(),
  clearApiKey: z.boolean().optional(),
})

app.get('/api/settings', (c) => c.json(publicSettings()))

const reviewInput = z.object({
  intervalsDays: z.array(z.number().positive().max(3650)).min(1).max(20),
  forgotRetryMinutes: z.number().positive().max(1440),
  errorRateRecentWeight: z.number().min(0).max(1).optional(),
  errorRateIntervalPenalty: z.number().min(0).max(1).optional(),
})

const behaviorInput = z
  .object({
    memoryLimit: z.number().int().min(1).max(30),
    historyLimit: z.number().int().min(2).max(50),
    memoryCharBudget: z.number().int().min(200).max(12000),
  })
  .partial()

app.get('/api/settings/review', (c) => c.json(getReviewConfig()))

app.put('/api/settings/review', async (c) => {
  const input = reviewInput.parse(await c.req.json())
  const current = getReviewConfig()
  return c.json(
    saveReviewConfig({
      intervalsDays: input.intervalsDays,
      forgotRetryMinutes: input.forgotRetryMinutes,
      errorRateRecentWeight:
        input.errorRateRecentWeight ?? current.errorRateRecentWeight,
      errorRateIntervalPenalty:
        input.errorRateIntervalPenalty ?? current.errorRateIntervalPenalty,
    }),
  )
})

app.get('/api/settings/ai-behavior', (c) => c.json(getAiBehaviorSettings()))

app.put('/api/settings/ai-behavior', async (c) => {
  const input = behaviorInput.parse(await c.req.json())
  return c.json(saveAiBehaviorSettings(input))
})

const teachingInput = z.object({
  explanationMode: z.enum(['bilingual', 'english']),
})

app.get('/api/settings/ai-teaching', (c) => c.json(getAiTeachingSettings()))

app.put('/api/settings/ai-teaching', async (c) => {
  const input = teachingInput.parse(await c.req.json())
  return c.json(saveAiTeachingSettings(input))
})

const markdownSyncInput = z.object({
  path: z.string().trim().max(1000).nullable().optional(),
})

app.get('/api/settings/markdown', (c) => c.json({ path: getMarkdownSyncPath() }))

app.put('/api/settings/markdown', async (c) => {
  const input = markdownSyncInput.parse(await c.req.json())
  try {
    return c.json({ path: saveMarkdownSyncPath(input.path) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: message }, 400)
  }
})

app.put('/api/settings', async (c) => {
  const input = updateInput.parse(await c.req.json())

  if (input.baseUrl) setSetting('ai.baseUrl', input.baseUrl.replace(/\/+$/, ''))
  if (input.model) setSetting('ai.model', input.model)
  if (input.clearApiKey) deleteSetting('ai.apiKey')
  else if (input.apiKey) setSetting('ai.apiKey', input.apiKey)

  return c.json(publicSettings())
})

app.post('/api/settings/test', async (c) => {
  const input = z
    .object({
      baseUrl: z.string().trim().url('Base URL 必须是合法地址').optional(),
      model: z.string().trim().min(1).max(200).optional(),
      apiKey: z.string().trim().max(500).optional(),
    })
    .parse(await c.req.json().catch(() => ({})))

  const saved = getAiConfig()
  const baseUrl = (input.baseUrl || saved.baseUrl).replace(/\/+$/, '')
  const model = input.model || saved.model
  const apiKey = input.apiKey || saved.apiKey

  if (!apiKey && !isLocalUrl(baseUrl)) {
    return c.json({ ok: false, error: '请填写 API Key（本地 Ollama 等无需鉴权的服务除外）。' })
  }

  try {
    const reply = await testConnection({ baseUrl, model, apiKey })
    return c.json({ ok: true, model, reply: reply.trim().slice(0, 100) })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ ok: false, error: message })
  }
})

export default app
