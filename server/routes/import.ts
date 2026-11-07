import { Hono } from 'hono'
import { z } from 'zod'
import type { ImportCommitResult, ImportItem, ImportPreview } from '../../shared/types'
import { db } from '../db'
import { entryKey, loadExistingEntryKeys } from '../lib/dedupe'
import { insertEntry } from '../lib/entry-store'
import { parseMarkdownNotes } from '../lib/markdown-import'
import { addEntryToScene, getOrCreateScene } from '../lib/scenes'

const app = new Hono()

const previewInput = z.object({
  markdown: z.string().min(1, '请粘贴或上传 Markdown 内容').max(2_000_000),
  filename: z.string().trim().max(200).optional(),
})

const commitItem = z.object({
  type: z.enum(['word', 'phrase', 'sentence']),
  text: z.string().trim().min(1).max(2000),
  meaning: z.string().trim().max(4000).nullish(),
  englishDefinition: z.string().trim().max(4000).nullish(),
  explanation: z.string().trim().max(8000).nullish(),
  examples: z.array(z.string().trim().min(1).max(1000)).max(50).optional(),
  notes: z.string().trim().max(8000).nullish(),
  tags: z.array(z.string().trim().min(1).max(50)).max(50).optional(),
  phonetic: z.string().trim().max(200).nullish(),
  scene: z.string().trim().max(60).nullish(),
  section: z.string().trim().max(200).nullish(),
  subsection: z.string().trim().max(200).nullish(),
  reviewEnabled: z.boolean().optional(),
})

const commitInput = z.object({
  items: z.array(commitItem).min(1, '没有选中任何词条').max(5000),
})

app.post('/api/import/markdown/preview', async (c) => {
  const input = previewInput.parse(await c.req.json())
  const parsed = parseMarkdownNotes(input.markdown)

  const existing = loadExistingEntryKeys()
  const seen = new Set<string>()

  const items: ImportItem[] = parsed.items.map((item, index) => {
    const key = entryKey(item.text)
    const duplicate = existing.has(key) || seen.has(key)
    seen.add(key)
    return {
      ...item,
      id: `item-${index}`,
      duplicate,
    }
  })

  const stats: ImportPreview['stats'] = {
    total: items.length,
    word: items.filter((item) => item.type === 'word').length,
    phrase: items.filter((item) => item.type === 'phrase').length,
    sentence: items.filter((item) => item.type === 'sentence').length,
    scenes: new Set(items.map((item) => item.scene).filter(Boolean)).size,
    duplicates: items.filter((item) => item.duplicate).length,
  }

  const preview: ImportPreview = {
    items,
    stats,
    warnings: parsed.warnings,
  }
  return c.json(preview)
})

app.post('/api/import/markdown/commit', async (c) => {
  const { items } = commitInput.parse(await c.req.json())

  const result: ImportCommitResult = {
    created: 0,
    skipped: 0,
    scenes: [],
    entryIds: [],
  }
  const seen = new Set<string>()
  const sceneNames = new Set<string>()

  db.transaction(() => {
    const existing = loadExistingEntryKeys()
    for (const item of items) {
      const key = entryKey(item.text)
      if (existing.has(key) || seen.has(key)) {
        result.skipped += 1
        continue
      }
      seen.add(key)

      const entry = insertEntry(
        {
          type: item.type,
          text: item.text,
          meaning: item.meaning ?? null,
          englishDefinition: item.englishDefinition ?? null,
          explanation: item.explanation ?? null,
          examples: item.examples ?? [],
          notes: item.notes ?? null,
          tags: item.tags ?? [],
          phonetic: item.phonetic ?? null,
        },
        {
          source: 'markdown-import',
          reviewEnabled: item.reviewEnabled ?? (item.scene ? false : true),
        },
      )
      result.created += 1
      result.entryIds.push(entry.id)

      if (item.scene) {
        const scene = getOrCreateScene(item.scene)
        sceneNames.add(scene.name)
        addEntryToScene(scene.id, entry.id, item.section ?? null, item.subsection ?? null)
      }
    }
  })()

  result.scenes = [...sceneNames].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  return c.json(result, 201)
})

export default app
