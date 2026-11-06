import { Hono } from 'hono'
import { z } from 'zod'
import { testConnection } from '../ai/client'
import {
  deleteSetting,
  getAiConfig,
  isLocalUrl,
  publicSettings,
  setSetting,
} from '../ai/config'

const app = new Hono()

const updateInput = z.object({
  baseUrl: z.string().trim().url('Base URL 必须是合法地址').optional(),
  model: z.string().trim().min(1).max(200).optional(),
  apiKey: z.string().trim().max(500).optional(),
  clearApiKey: z.boolean().optional(),
})

app.get('/api/settings', (c) => c.json(publicSettings()))

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
