import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../db'
import { mapSceneEntry } from '../lib/mappers'
import { SCENE_ENTRY_SELECT, getEntryById } from '../lib/queries'
import {
  addEntryToScene,
  createScene,
  deleteScene,
  getSceneByName,
  getSceneSummary,
  listSceneSummaries,
  removeEntryFromScene,
  updateScene,
} from '../lib/scenes'

const app = new Hono()

const sceneInput = z.object({
  name: z.string().trim().min(1, '场景名不能为空').max(60),
  description: z.string().trim().max(500).nullish(),
})

const scenePatch = sceneInput.partial()

const addEntriesInput = z.object({
  entryIds: z.array(z.number().int().positive()).min(1).max(500),
  section: z.string().trim().max(200).nullish(),
  subsection: z.string().trim().max(200).nullish(),
})

function parseId(value: string): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

app.get('/api/scenes', (c) => {
  return c.json({ items: listSceneSummaries() })
})

app.post('/api/scenes', async (c) => {
  const input = sceneInput.parse(await c.req.json())
  if (getSceneByName(input.name)) {
    return c.json({ error: `场景「${input.name}」已存在` }, 409)
  }
  return c.json(createScene(input.name, input.description ?? null), 201)
})

app.get('/api/scenes/:id', (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.json({ error: '无效的场景 ID' }, 400)
  const scene = getSceneSummary(id)
  if (!scene) return c.json({ error: '场景不存在' }, 404)

  const rows = db
    .prepare(`${SCENE_ENTRY_SELECT} WHERE se.scene_id = ? ORDER BY se.position ASC, e.created_at DESC, e.id DESC`)
    .all(id)

  return c.json({ scene, items: rows.map(mapSceneEntry) })
})

app.patch('/api/scenes/:id', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.json({ error: '无效的场景 ID' }, 400)
  if (!getSceneSummary(id)) return c.json({ error: '场景不存在' }, 404)

  const input = scenePatch.parse(await c.req.json())
  if (input.name) {
    const existing = getSceneByName(input.name)
    if (existing && existing.id !== id) {
      return c.json({ error: `场景「${input.name}」已存在` }, 409)
    }
  }
  return c.json(updateScene(id, input))
})

app.delete('/api/scenes/:id', (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.json({ error: '无效的场景 ID' }, 400)
  if (!deleteScene(id)) return c.json({ error: '场景不存在' }, 404)
  return c.json({ ok: true })
})

app.post('/api/scenes/:id/entries', async (c) => {
  const id = parseId(c.req.param('id'))
  if (!id) return c.json({ error: '无效的场景 ID' }, 400)
  if (!getSceneSummary(id)) return c.json({ error: '场景不存在' }, 404)

  const input = addEntriesInput.parse(await c.req.json())
  let added = 0
  db.transaction(() => {
    for (const entryId of input.entryIds) {
      if (!getEntryById(entryId)) continue
      if (addEntryToScene(id, entryId, input.section ?? null, input.subsection ?? null)) added += 1
    }
  })()

  return c.json({
    added,
    skipped: input.entryIds.length - added,
    scene: getSceneSummary(id),
  })
})

app.delete('/api/scenes/:id/entries/:entryId', (c) => {
  const id = parseId(c.req.param('id'))
  const entryId = parseId(c.req.param('entryId'))
  if (!id || !entryId) return c.json({ error: '无效的场景或词条 ID' }, 400)
  if (!getSceneSummary(id)) return c.json({ error: '场景不存在' }, 404)
  if (!removeEntryFromScene(id, entryId)) return c.json({ error: '该词条不在场景中' }, 404)
  return c.json({ ok: true })
})

export default app
