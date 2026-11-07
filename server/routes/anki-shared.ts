import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import type { SharedDeckPage, SharedDeckSummary } from '../../shared/types'
import {
  AnkiWebError,
  downloadSharedDeck,
  fetchSharedDeckInfo,
  fetchSharedDecks,
  type AnkiWebDeckRow,
} from '../lib/import/ankiweb'
import {
  buildAnkiPreview,
  cleanupOldImportSessions,
  MAX_UPLOAD_BYTES,
  sessionDir,
} from './anki-import'
import { nowIso } from '../lib/time'

const app = new Hono()

const listCache = new Map<string, { at: number; rows: AnkiWebDeckRow[] }>()
const LIST_TTL_MS = 5 * 60 * 1000
const MAX_CACHE_ENTRIES = 30
let activeDownload = false

const downloadInput = z.object({
  deckId: z.number().int().positive(),
})

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(Math.floor(value), min), max)
}

async function loadDeckRows(search: string): Promise<AnkiWebDeckRow[]> {
  const key = search.toLowerCase()
  const cached = listCache.get(key)
  if (cached && Date.now() - cached.at < LIST_TTL_MS) return cached.rows

  const rows = await fetchSharedDecks(search)
  listCache.set(key, { at: Date.now(), rows })
  if (listCache.size > MAX_CACHE_ENTRIES) {
    const oldest = [...listCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) listCache.delete(oldest[0])
  }
  return rows
}

function toSummary(row: AnkiWebDeckRow): SharedDeckSummary {
  return {
    id: row.id,
    title: row.title,
    thumbsUp: row.thumbsUp,
    thumbsDown: row.thumbsDown,
    mtime: row.mtime ? new Date(row.mtime * 1000).toISOString() : nowIso(),
    notes: row.notes,
    audio: row.audio,
    images: row.images,
  }
}

function errorResponse(error: unknown) {
  if (error instanceof AnkiWebError) {
    return { status: error.status, body: { error: error.message, code: error.code } }
  }
  return {
    status: 502,
    body: {
      error: error instanceof Error ? error.message : 'AnkiWeb 暂时不可用',
      code: 'upstream',
    },
  }
}

app.get('/api/anki-shared/decks', async (c) => {
  const rawSearch = (c.req.query('search') ?? '').trim().slice(0, 100)
  // AnkiWeb 不接受空搜索；默认展示英文牌组。
  const search = rawSearch || 'english'
  const sort = c.req.query('sort') === 'updated' ? 'updated' : 'rating'
  const page = clamp(Number(c.req.query('page') ?? 1), 1, 1000)
  const pageSize = clamp(Number(c.req.query('pageSize') ?? 20), 1, 50)

  try {
    const rows = await loadDeckRows(search)
    const sorted = [...rows].sort((a, b) => {
      if (sort === 'updated') return b.mtime - a.mtime || b.thumbsUp - a.thumbsUp
      const netA = a.thumbsUp - a.thumbsDown
      const netB = b.thumbsUp - b.thumbsDown
      return netB - netA || b.thumbsUp - a.thumbsUp
    })
    const total = sorted.length
    const start = (page - 1) * pageSize
    const result: SharedDeckPage = {
      items: sorted.slice(start, start + pageSize).map(toSummary),
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total,
    }
    return c.json(result)
  } catch (error) {
    const { status, body } = errorResponse(error)
    return c.json(body, status as 502)
  }
})

app.post('/api/anki-shared/download', async (c) => {
  const { deckId } = downloadInput.parse(await c.req.json())
  if (activeDownload) {
    return c.json({ error: '已有牌组正在下载，请稍候。', code: 'busy' }, 429)
  }

  activeDownload = true
  cleanupOldImportSessions()
  const importId = randomUUID()
  const dir = sessionDir(importId)
  const zipPath = join(dir, 'package.apkg')
  mkdirSync(dir, { recursive: true })

  try {
    const info = await fetchSharedDeckInfo(deckId)
    if (info.size > MAX_UPLOAD_BYTES) {
      throw new AnkiWebError('牌组超过 200MB，暂不支持下载导入', 413, 'too_large')
    }
    const downloaded = await downloadSharedDeck(deckId, info.downloadKey, MAX_UPLOAD_BYTES)
    writeFileSync(zipPath, downloaded.buffer)

    const preview = buildAnkiPreview({
      importId,
      dir,
      zipPath,
      fileName: downloaded.fileName,
      fileSize: downloaded.buffer.byteLength,
      sharedDeck: {
        id: deckId,
        title: info.title,
        url: `https://ankiweb.net/shared/info/${deckId}`,
      },
    })
    return c.json(preview)
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    const { status, body } = errorResponse(error)
    return c.json(body, status as 502)
  } finally {
    activeDownload = false
  }
})

export default app
