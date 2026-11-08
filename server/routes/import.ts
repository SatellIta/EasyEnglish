import { Hono } from 'hono'
import { z } from 'zod'
import type {
  ImportCommitItem,
  ImportItem,
  ImportPreview,
  MarkdownSyncResult,
} from '../../shared/types'
import { db } from '../db'
import { entryKey, loadExistingEntryKeys } from '../lib/dedupe'
import { commitMarkdownItems } from '../lib/markdown-commit'
import { parseMarkdownNotes } from '../lib/markdown-import'
import { readMarkdownSyncFile } from '../lib/markdown-sync'

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
  /** 用 Markdown 内容更新已存在词条；复习开关和学习状态保持不变 */
  updateExisting: z.boolean().optional(),
})

app.post('/api/import/markdown/preview', async (c) => {
  const input = previewInput.parse(await c.req.json())
  const parsed = parseMarkdownNotes(input.markdown)

  const existing = loadExistingEntryKeys()
  const seen = new Set<string>()

  const items: ImportItem[] = parsed.items.map((item, index) => {
    const key = entryKey(item.text)
    // 同一文本的不同释义要保留下来合并成义项；只有内容完全相同的重复行才默认不勾选。
    const signature = JSON.stringify([
      key,
      item.meaning ?? '',
      item.englishDefinition ?? '',
      item.explanation ?? '',
      item.examples ?? [],
    ])
    const duplicate = existing.has(key) || seen.has(signature)
    seen.add(signature)
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
  const input = commitInput.parse(await c.req.json())
  const result = commitMarkdownItems(input.items as ImportCommitItem[], {
    updateExisting: input.updateExisting,
  })
  return c.json(result, 201)
})

/** 读取设置里配置的本地 Markdown 文件并同步；已有词条会被关联/更新。 */
app.post('/api/import/markdown/sync', async (c) => {
  try {
    const file = await readMarkdownSyncFile()
    const parsed = parseMarkdownNotes(file.markdown)
    const result: MarkdownSyncResult = {
      ...commitMarkdownItems(parsed.items, { updateExisting: true }),
      fileName: file.fileName,
      warnings: parsed.warnings,
    }
    return c.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: message }, 400)
  }
})

export default app
