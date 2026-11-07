import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { zstdDecompressSync } from 'node:zlib'
import type { AnkiFieldInfo, AnkiPackageVersion } from '../../../shared/types'
import { parseMediaMap } from './media-store'
import { readZipEntries, readZipEntry, type ZipEntry } from './zip'

const MAX_SQLITE_BYTES = 300 * 1024 * 1024
const MAX_NOTES = 100_000
const COLLECTION_NAMES = ['collection.anki21b', 'collection.anki21', 'collection.anki2']

export interface AnkiNotetypeRecord {
  id: number
  name: string
  fields: AnkiFieldInfo[]
  isCloze: boolean
  noteCount: number
}

export interface AnkiPackageMetadata {
  packageVersion: AnkiPackageVersion
  schemaVersion: number
  collectionName: string
  decks: string[]
  deckById: Map<number, string>
  notetypes: AnkiNotetypeRecord[]
  noteCount: number
  cardCount: number
  mediaCount: number
  mediaMap: Map<string, string>
}

export interface AnkiPackageFiles {
  zipBuffer: Buffer
  zipEntries: ZipEntry[]
  sqlitePath: string
  packageVersion: AnkiPackageVersion
  collectionName: string
  mediaMap: Map<string, string>
  mediaCount: number
}

export interface RawAnkiNote {
  row: number
  id: number
  guid: string
  mid: number
  tags: string[]
  fields: string[]
  deck: string | null
}

function isZstd(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x28 &&
    buffer[1] === 0xb5 &&
    buffer[2] === 0x2f &&
    buffer[3] === 0xfd
  )
}

function toSqliteBuffer(buffer: Buffer): Buffer {
  let value = buffer
  if (isZstd(value)) {
    value = zstdDecompressSync(value, { maxOutputLength: MAX_SQLITE_BYTES })
  }
  if (value.length < 16 || value.subarray(0, 16).toString('utf8') !== 'SQLite format 3\0') {
    throw new Error('包内数据库格式不受支持')
  }
  if (value.byteLength > MAX_SQLITE_BYTES) {
    throw new Error('数据库解压后过大')
  }
  return value
}

function pickCollection(files: Record<string, Buffer>): {
  name: string
  version: AnkiPackageVersion
  bytes: Buffer
} | null {
  const latest = files['collection.anki21b']
  if (latest) return { name: 'collection.anki21b', version: 'latest', bytes: latest }
  const legacy2 = files['collection.anki21']
  if (legacy2) return { name: 'collection.anki21', version: 'legacy2', bytes: legacy2 }
  const legacy1 = files['collection.anki2']
  if (legacy1) return { name: 'collection.anki2', version: 'legacy1', bytes: legacy1 }
  return null
}

/** 读取 ZIP、选出集合成员、解压到 workDir/collection.sqlite。 */
export function prepareAnkiPackage(zipPath: string, workDir: string): AnkiPackageFiles {
  const zipBuffer = readFileSync(zipPath)
  const zipEntries = readZipEntries(zipBuffer)
  const byName = new Map(zipEntries.map((entry) => [entry.name, entry]))
  const mediaAmount = zipEntries.filter((entry) => /^\d+$/.test(entry.name)).length
  const mediaEntry = byName.get('media')
  const mediaMap = parseMediaMap(
    mediaEntry ? readZipEntry(zipBuffer, mediaEntry, 64 * 1024 * 1024) : null,
  )

  if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true })
  const sqlitePath = join(workDir, 'collection.sqlite')
  const metaPath = join(workDir, 'package-meta.json')

  let packageVersion: AnkiPackageVersion = 'latest'
  let collectionName = 'collection.anki21b'

  if (existsSync(sqlitePath) && existsSync(metaPath)) {
    const saved = parseJsonObject<{
      packageVersion?: AnkiPackageVersion
      collectionName?: string
    }>(readFileSync(metaPath, 'utf8'))
    packageVersion = saved?.packageVersion ?? packageVersion
    collectionName = saved?.collectionName ?? collectionName
  } else {
    const chosen: Record<string, Buffer> = {}
    for (const name of COLLECTION_NAMES) {
      const entry = byName.get(name)
      if (!entry) continue
      chosen[name] = readZipEntry(zipBuffer, entry, MAX_SQLITE_BYTES)
    }
    const collection = pickCollection(chosen)
    if (!collection) throw new Error('包内没有找到 Anki 数据库')

    const sqlite = toSqliteBuffer(collection.bytes)
    writeFileSync(sqlitePath, sqlite)
    packageVersion = collection.version
    collectionName = collection.name
    writeFileSync(
      metaPath,
      JSON.stringify({
        packageVersion,
        collectionName,
        mediaMap: Object.fromEntries(mediaMap),
        mediaCount: mediaAmount,
      }),
    )
  }

  return {
    zipBuffer,
    zipEntries,
    sqlitePath,
    packageVersion,
    collectionName,
    mediaMap,
    mediaCount: mediaAmount,
  }
}

export function openAnkiDatabase(sqlitePath: string): DatabaseSync {
  const db = new DatabaseSync(sqlitePath, { readOnly: true })
  db.exec('PRAGMA query_only = ON')
  return db
}

function tableExists(db: DatabaseSync, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { name?: string } | undefined
  return Boolean(row?.name)
}

interface Schema11Model {
  id?: number | string
  name?: string
  type?: number
  flds?: Array<{ name?: string; ord?: number | string }>
}

function parseJsonObject<T>(value: unknown): T | null {
  if (typeof value !== 'string' || !value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function readNotetypes(db: DatabaseSync): AnkiNotetypeRecord[] {
  const counts = new Map<number, number>()
  for (const row of db
    .prepare('SELECT mid, count(*) AS n FROM notes GROUP BY mid')
    .all() as Array<{ mid: number; n: number }>) {
    counts.set(Number(row.mid), Number(row.n))
  }

  const result: AnkiNotetypeRecord[] = []

  if (tableExists(db, 'notetypes')) {
    const notetypes = db.prepare('SELECT id, name FROM notetypes').all() as Array<{
      id: number
      name: string
    }>
    const fields = tableExists(db, 'fields')
      ? (db.prepare('SELECT ntid, ord, name FROM fields ORDER BY ntid, ord').all() as Array<{
          ntid: number
          ord: number
          name: string
        }>)
      : []
    const clozeTypes = new Set<number>()
    if (tableExists(db, 'templates')) {
      for (const row of db.prepare('SELECT ntid, name FROM templates').all() as Array<{
        ntid: number
        name: string
      }>) {
        if (/cloze/i.test(row.name)) clozeTypes.add(Number(row.ntid))
      }
    }

    for (const notetype of notetypes) {
      const id = Number(notetype.id)
      result.push({
        id,
        name: notetype.name,
        fields: fields
          .filter((field) => Number(field.ntid) === id)
          .map((field) => ({ ord: Number(field.ord), name: field.name }))
          .sort((a, b) => a.ord - b.ord),
        isCloze: clozeTypes.has(id),
        noteCount: counts.get(id) ?? 0,
      })
    }
    return result
  }

  const row = db.prepare('SELECT models FROM col LIMIT 1').get() as
    | { models?: string }
    | undefined
  const models = parseJsonObject<Record<string, Schema11Model>>(row?.models)
  if (!models) return []
  for (const [key, model] of Object.entries(models)) {
    const id = Number(model.id ?? key)
    result.push({
      id,
      name: model.name ?? `Notetype ${id}`,
      fields: (model.flds ?? [])
        .map((field, index) => ({
          ord: Number(field.ord ?? index),
          name: field.name ?? `Field ${index + 1}`,
        }))
        .sort((a, b) => a.ord - b.ord),
      isCloze: Number(model.type) === 1,
      noteCount: counts.get(id) ?? 0,
    })
  }
  return result
}

function readDecks(db: DatabaseSync): { decks: string[]; deckById: Map<number, string> } {
  const deckById = new Map<number, string>()
  const add = (id: unknown, name: unknown) => {
    if (typeof name !== 'string') return
    const deckId = Number(id)
    if (!Number.isFinite(deckId)) return
    deckById.set(deckId, name.replace(/\x1f/g, '::'))
  }

  if (tableExists(db, 'decks')) {
    for (const row of db.prepare('SELECT id, name FROM decks').all() as Array<{
      id: number
      name: string
    }>) {
      add(row.id, row.name)
    }
  } else {
    const row = db.prepare('SELECT decks FROM col LIMIT 1').get() as
      | { decks?: string }
      | undefined
    const decks = parseJsonObject<Record<string, { id?: number; name?: string }>>(row?.decks)
    if (decks) {
      for (const [key, deck] of Object.entries(decks)) add(deck.id ?? Number(key), deck.name)
    }
  }

  const decks = [...deckById.values()].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  return { decks, deckById }
}

export function readAnkiMetadata(
  db: DatabaseSync,
  options: {
    packageVersion: AnkiPackageVersion
    collectionName: string
    mediaCount: number
    mediaMap: Map<string, string>
  },
): AnkiPackageMetadata {
  let schemaVersion = 0
  try {
    const row = db.prepare('SELECT ver FROM col LIMIT 1').get() as
      | { ver?: number }
      | undefined
    schemaVersion = Number(row?.ver ?? 0)
  } catch {
    schemaVersion = 0
  }
  if (!schemaVersion) {
    const row = db.prepare('PRAGMA user_version').get() as Record<string, number> | undefined
    schemaVersion = Number(Object.values(row ?? {})[0] ?? 0)
  }
  if (schemaVersion > 18) {
    throw new Error(`暂不支持该 Anki 数据库版本（schema ${schemaVersion}）`)
  }

  const noteCount = Number(
    (db.prepare('SELECT count(*) AS n FROM notes').get() as { n: number } | undefined)?.n ?? 0,
  )
  const cardCount = tableExists(db, 'cards')
    ? Number(
        (db.prepare('SELECT count(*) AS n FROM cards').get() as { n: number } | undefined)?.n ?? 0,
      )
    : 0
  if (noteCount > MAX_NOTES) {
    throw new Error(`词条数量过多（${noteCount}），最多支持 ${MAX_NOTES} 条`)
  }

  const { decks, deckById } = readDecks(db)
  return {
    packageVersion: options.packageVersion,
    schemaVersion,
    collectionName: options.collectionName,
    decks,
    deckById,
    notetypes: readNotetypes(db),
    noteCount,
    cardCount,
    mediaCount: options.mediaCount,
    mediaMap: options.mediaMap,
  }
}

interface NoteRow {
  id: number
  guid: string
  mid: number
  tags: string
  flds: string
  did: number | null
  odid: number | null
}

function toRawNote(row: NoteRow, index: number, deckById: Map<number, string>): RawAnkiNote {
  const deckId = row.odid && Number(row.odid) !== 0 ? Number(row.odid) : Number(row.did)
  return {
    row: index + 1,
    id: Number(row.id),
    guid: row.guid,
    mid: Number(row.mid),
    tags: row.tags.trim() ? row.tags.trim().split(/\s+/) : [],
    fields: row.flds.split('\x1f'),
    deck: Number.isFinite(deckId) ? deckById.get(deckId) ?? null : null,
  }
}

const NOTE_SELECT = `
  SELECT n.id, n.guid, n.mid, n.tags, n.flds, c.did, c.odid
  FROM notes n
  LEFT JOIN cards c ON c.id = (
    SELECT id FROM cards WHERE nid = n.id ORDER BY id LIMIT 1
  )
`

export function readSampleNotes(
  db: DatabaseSync,
  metadata: AnkiPackageMetadata,
  limit = 5,
): RawAnkiNote[] {
  const rows = db.prepare(`${NOTE_SELECT} ORDER BY n.id LIMIT ?`).all(limit) as unknown as NoteRow[]
  return rows.map((row, index) => toRawNote(row, index, metadata.deckById))
}

/** 流式遍历 note，避免一次性把 10 万条富文本读进内存。 */
export function* iterateNotes(
  db: DatabaseSync,
  deckById: Map<number, string>,
  notetypeIds?: number[],
): Generator<RawAnkiNote> {
  const filter = notetypeIds?.length
    ? `WHERE n.mid IN (${notetypeIds.map(() => '?').join(', ')})`
    : ''
  const statement = db.prepare(`${NOTE_SELECT} ${filter} ORDER BY n.id`)
  let index = 0
  for (const row of statement.iterate(...(notetypeIds ?? [])) as Iterable<NoteRow>) {
    yield toRawNote(row, index, deckById)
    index += 1
  }
}

export function closeAnkiDatabase(db: DatabaseSync): void {
  db.close()
}
