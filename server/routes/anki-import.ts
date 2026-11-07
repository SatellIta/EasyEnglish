import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import type {
  AnkiFieldMapping,
  AnkiImportPreview,
  AnkiImportResult,
  AnkiNotetypeSummary,
  AnkiSampleNote,
  Entry,
} from '../../shared/types'
import { db as appDb } from '../db'
import { entryKey, loadExistingEntryKeyMap } from '../lib/dedupe'
import { insertEntry, updateEntryContent } from '../lib/entry-store'
import {
  autoMapFields,
  cleanAnkiHtml,
  mapAnkiNote,
  mapSample,
} from '../lib/import/anki-mapper'
import {
  closeAnkiDatabase,
  iterateNotes,
  openAnkiDatabase,
  prepareAnkiPackage,
  readAnkiMetadata,
  readSampleNotes,
  type AnkiNotetypeRecord,
} from '../lib/import/anki-package'
import { MediaStore } from '../lib/import/media-store'
import { nowIso } from '../lib/time'

const app = new Hono()

export const IMPORTS_ROOT = resolve(process.cwd(), 'data/imports')
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024
const MAX_ERRORS = 100
const SESSION_TTL_MS = 60 * 60 * 1000
const IMPORT_ID_PATTERN = /^[a-zA-Z0-9-]+$/

const mappingSchema = z.object({
  text: z.number().int().min(0),
  meaning: z.number().int().min(0).nullable(),
  englishDefinition: z.number().int().min(0).nullable(),
  phonetic: z.number().int().min(0).nullable(),
  image: z.number().int().min(0).nullable(),
  examples: z.array(z.number().int().min(0)).max(50),
  explanation: z.array(z.number().int().min(0)).max(50),
  notes: z.array(z.number().int().min(0)).max(50),
  tagFields: z.array(z.number().int().min(0)).max(50),
})

const optionsSchema = z.object({
  notetypeIds: z.array(z.number().int()).max(200).optional(),
  mappingByNotetype: z.record(z.string(), mappingSchema).optional(),
  useAnkiTags: z.boolean().default(true),
  addDeckTag: z.boolean().default(true),
  duplicateMode: z.enum(['skip', 'update', 'new']).default('skip'),
  addToReview: z.boolean().default(false),
  media: z.enum(['placeholder', 'strip']).default('placeholder'),
})

const commitSchema = z.object({
  importId: z.string().regex(IMPORT_ID_PATTERN),
  options: optionsSchema,
})

export function cleanupOldImportSessions(maxAgeMs = SESSION_TTL_MS): void {
  if (!existsSync(IMPORTS_ROOT)) return
  const now = Date.now()
  for (const name of readdirSync(IMPORTS_ROOT)) {
    if (!IMPORT_ID_PATTERN.test(name)) continue
    const dir = join(IMPORTS_ROOT, name)
    try {
      if (now - statSync(dir).mtimeMs > maxAgeMs) rmSync(dir, { recursive: true, force: true })
    } catch {
      // another request may have removed it
    }
  }
}

function sessionDir(importId: string): string {
  return join(IMPORTS_ROOT, importId)
}

function notetypeRecordToSummary(
  notetype: AnkiNotetypeRecord,
  mapping: AnkiFieldMapping,
): AnkiNotetypeSummary {
  return {
    id: notetype.id,
    name: notetype.name,
    fields: notetype.fields,
    noteCount: notetype.noteCount,
    isCloze: notetype.isCloze,
    mapping,
  }
}

function buildSample(
  note: ReturnType<typeof readSampleNotes>[number],
  notetypes: Map<number, AnkiNotetypeSummary>,
): AnkiSampleNote | null {
  const notetype = notetypes.get(note.mid)
  if (!notetype) return null
  const mapped = mapAnkiNote(note, {
    mapping: notetype.mapping,
    fieldNames: notetype.fields.map((field) => field.name),
    isCloze: notetype.isCloze || /\{\{c\d+::/i.test(note.fields.join('\n')),
    useAnkiTags: true,
    addDeckTag: true,
    mediaMode: 'strip',
    mediaStore: null,
  })
  return {
    notetypeId: notetype.id,
    notetypeName: notetype.name,
    deck: note.deck,
    fields: note.fields.map((field) => {
      const cleaned = cleanAnkiHtml(field).text.replace(/\s+/g, ' ').trim()
      return cleaned.length > 240 ? `${cleaned.slice(0, 240)}…` : cleaned
    }),
    mapped: mapSample(
      note,
      {
        mapping: notetype.mapping,
        fieldNames: notetype.fields.map((field) => field.name),
        isCloze: notetype.isCloze,
        useAnkiTags: true,
        addDeckTag: true,
        mediaMode: 'strip',
        mediaStore: null,
      },
      mapped,
    ),
  }
}

app.post('/api/import/anki/preview', async (c) => {
  cleanupOldImportSessions()

  const form = await c.req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return c.json({ error: '请选择要导入的 Anki 文件' }, 400)
  }
  if (file.size <= 0) return c.json({ error: '文件为空' }, 400)
  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json({ error: '文件过大，最大支持 200MB' }, 413)
  }

  const importId = randomUUID()
  const dir = sessionDir(importId)
  mkdirSync(dir, { recursive: true })
  const zipPath = join(dir, 'package.apkg')
  writeFileSync(zipPath, Buffer.from(await file.arrayBuffer()))

  try {
    const files = prepareAnkiPackage(zipPath, dir)
    const db = openAnkiDatabase(files.sqlitePath)
    try {
      const metadata = readAnkiMetadata(db, files)
      const notetypes: AnkiNotetypeSummary[] = metadata.notetypes
        .filter((notetype) => notetype.noteCount > 0 && notetype.fields.length > 0)
        .map((notetype) => notetypeRecordToSummary(notetype, autoMapFields(notetype.fields)))
      if (!notetypes.length) {
        throw new Error('包内没有找到可导入的笔记')
      }
      const byId = new Map(notetypes.map((notetype) => [notetype.id, notetype]))
      const sample = readSampleNotes(db, metadata, 5)
        .map((note) => buildSample(note, byId))
        .filter((item): item is AnkiSampleNote => item !== null)

      const warnings: AnkiImportPreview['warnings'] = []
      if (metadata.mediaCount > 0) {
        warnings.push({ code: 'media', count: metadata.mediaCount })
        if (metadata.mediaMap.size === 0) {
          warnings.push({ code: 'mediaIndex' })
        }
      }
      if (metadata.schemaVersion && metadata.schemaVersion < 18) {
        warnings.push({ code: 'legacySchema', version: metadata.schemaVersion })
      }

      const defaultNotetypeId =
        [...notetypes].sort((a, b) => b.noteCount - a.noteCount)[0]?.id ?? null

      const preview: AnkiImportPreview = {
        importId,
        fileName: file.name || 'deck.apkg',
        fileSize: file.size,
        packageVersion: metadata.packageVersion,
        schemaVersion: metadata.schemaVersion,
        decks: metadata.decks,
        notetypes,
        totals: {
          notes: metadata.noteCount,
          cards: metadata.cardCount,
          media: metadata.mediaCount,
        },
        sample,
        warnings,
        defaultNotetypeId,
      }
      return c.json(preview)
    } finally {
      closeAnkiDatabase(db)
    }
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    return c.json(
      { error: error instanceof Error ? error.message : '无法解析 Anki 词库' },
      400,
    )
  }
})

app.post('/api/import/anki/commit', async (c) => {
  const { importId, options } = commitSchema.parse(await c.req.json())
  const dir = sessionDir(importId)
  const zipPath = join(dir, 'package.apkg')
  if (!existsSync(zipPath)) {
    return c.json({ error: '导入会话已过期，请重新选择文件' }, 404)
  }

  try {
    const files = prepareAnkiPackage(zipPath, dir)
    const db = openAnkiDatabase(files.sqlitePath)
    let closed = false
    const closeDb = () => {
      if (closed) return
      closed = true
      closeAnkiDatabase(db)
    }
    try {
      const metadata = readAnkiMetadata(db, files)
      const allowedIds = options.notetypeIds?.length
        ? new Set(options.notetypeIds)
        : new Set(metadata.notetypes.map((notetype) => notetype.id))
      const mappingByNotetype = new Map<number, AnkiFieldMapping>()
      const fieldsByNotetype = new Map<number, string[]>()
      for (const notetype of metadata.notetypes) {
        if (!allowedIds.has(notetype.id)) continue
        const override = options.mappingByNotetype?.[String(notetype.id)]
        const mapping = override ?? autoMapFields(notetype.fields)
        if (mapping.text < 0 || mapping.text >= notetype.fields.length) {
          return c.json({ error: '字段映射不合法' }, 400)
        }
        mappingByNotetype.set(notetype.id, mapping)
        fieldsByNotetype.set(
          notetype.id,
          notetype.fields.map((field) => field.name),
        )
      }
      if (!mappingByNotetype.size) {
        return c.json({ error: '没有可导入的笔记类型' }, 400)
      }

      const mediaStore = new MediaStore(files.zipBuffer, files.zipEntries, {
        mediaMap: files.mediaMap,
        enabled: options.media !== 'strip',
      })

      const existingByText = loadExistingEntryKeyMap()
      const existingByExternal = new Map<string, number>()
      for (const row of appDb
        .prepare(
          "SELECT id, external_id FROM entries WHERE source = 'anki' AND external_id IS NOT NULL",
        )
        .all() as Array<{ id: number; external_id: string }>) {
        existingByExternal.set(row.external_id, Number(row.id))
      }

      const result: AnkiImportResult = {
        imported: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        learned: options.addToReview,
        images: 0,
        warnings: [],
        errors: [],
      }
      const seen = new Set<string>()
      const now = nowIso()

      const addError = (row: number, message: string) => {
        result.failed += 1
        if (result.errors.length < MAX_ERRORS) result.errors.push({ row, message })
      }

      appDb.transaction(() => {
        for (const note of iterateNotes(db, metadata.deckById, [...allowedIds])) {
          const mapping = mappingByNotetype.get(note.mid)
          if (!mapping) continue
          const notetype = metadata.notetypes.find((item) => item.id === note.mid)
          if (!notetype) {
            result.skipped += 1
            continue
          }

          let mapped
          try {
            mapped = mapAnkiNote(note, {
              mapping,
              fieldNames: fieldsByNotetype.get(note.mid) ?? notetype.fields.map((f) => f.name),
              isCloze: notetype.isCloze || /\{\{c\d+::/i.test(note.fields.join('\n')),
              useAnkiTags: options.useAnkiTags,
              addDeckTag: options.addDeckTag,
              mediaMode: options.media,
              mediaStore,
            })
          } catch (error) {
            addError(note.row, error instanceof Error ? error.message : '字段解析失败')
            continue
          }

          if (!mapped) {
            addError(note.row, '清洗后内容为空，已跳过')
            continue
          }

          const key = entryKey(mapped.input.text)
          if (seen.has(key)) {
            result.skipped += 1
            continue
          }
          seen.add(key)

          const existingId =
            existingByExternal.get(mapped.externalId) ?? existingByText.get(key) ?? null

          try {
            if (existingId !== null) {
              if (options.duplicateMode === 'skip') {
                result.skipped += 1
                continue
              }
              if (options.duplicateMode === 'update') {
                const updated: Entry | null = updateEntryContent(existingId, mapped.input, {
                  externalId: mapped.externalId,
                  source: 'anki',
                })
                if (!updated) {
                  addError(note.row, '已有词条不存在')
                  continue
                }
                existingByText.set(key, existingId)
                result.updated += 1
                continue
              }
            }

            const entry = insertEntry(mapped.input, {
              source: 'anki',
              externalId: options.duplicateMode === 'new' && existingId !== null ? null : mapped.externalId,
              reviewEnabled: options.addToReview,
              learnedAt: options.addToReview ? now : null,
            })
            existingByText.set(key, entry.id)
            result.imported += 1
          } catch (error) {
            addError(note.row, error instanceof Error ? error.message : '写入失败')
          }
        }
      })()

      result.images = mediaStore.imageCount
      if (mediaStore.failedCount > 0) {
        result.warnings.push({ code: 'mediaMissing', count: mediaStore.failedCount })
      }
      if (!options.addToReview && result.imported > 0) {
        result.warnings.push({ code: 'unlearned' })
      }

      closeDb()
      rmSync(dir, { recursive: true, force: true })
      return c.json(result, 201)
    } finally {
      closeDb()
    }
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : '导入失败，请重试' },
      500,
    )
  }
})

app.delete('/api/import/anki/:importId', (c) => {
  const importId = c.req.param('importId')
  if (!IMPORT_ID_PATTERN.test(importId)) return c.json({ error: '无效的导入会话' }, 400)
  rmSync(sessionDir(importId), { recursive: true, force: true })
  return c.json({ ok: true })
})

export default app
