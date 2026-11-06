import { Hono } from 'hono'
import { z } from 'zod'
import type { AiPersonaSettings } from '../../shared/types'
import {
  createPersona,
  deletePersona,
  getAiPersonaSettings,
  getPersona,
  listPersonas,
  resetPersona,
  saveAiPersonaSettings,
  updatePersona,
} from '../lib/personas'

const app = new Hono()

const personaInput = z.object({
  name: z.string().trim().min(1, '人格名称不能为空').max(80),
  description: z.string().trim().max(300).nullish(),
  prompt: z.string().trim().min(1, '人格提示词不能为空').max(4000),
})

const personaPatch = personaInput.partial()

const personaSettingInput = z.object({
  personaId: z.number().int().positive().nullable(),
})

function parseId(value: string): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

app.get('/api/personas', (c) => c.json({ items: listPersonas() }))

app.post('/api/personas', async (c) => {
  const input = personaInput.parse(await c.req.json())
  try {
    return c.json(createPersona(input), 201)
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400)
  }
})

app.patch('/api/personas/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.json({ error: '无效的人格 ID' }, 400)
  if (!getPersona(id)) return c.json({ error: '人格不存在' }, 404)

  const input = personaPatch.parse(await c.req.json())
  try {
    const persona = updatePersona(id, input)
    return c.json(persona)
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400)
  }
})

app.delete('/api/personas/:id', (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.json({ error: '无效的人格 ID' }, 400)
  const persona = getPersona(id)
  if (!persona) return c.json({ error: '人格不存在' }, 404)
  if (persona.isDefault) return c.json({ error: '默认人格不能删除' }, 400)
  return c.json({ ok: deletePersona(id) })
})

app.post('/api/personas/:id/reset', (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.json({ error: '无效的人格 ID' }, 400)
  const persona = resetPersona(id)
  if (!persona) return c.json({ error: '只有默认人格可以恢复默认' }, 400)
  return c.json(persona)
})

app.get('/api/settings/ai-persona', (c) => c.json(getAiPersonaSettings()))

app.put('/api/settings/ai-persona', async (c) => {
  const input = personaSettingInput.parse(await c.req.json())
  try {
    const result: AiPersonaSettings = saveAiPersonaSettings(input)
    return c.json(result)
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400)
  }
})

export default app
