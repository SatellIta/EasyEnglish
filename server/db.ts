import Database from 'better-sqlite3'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const dbPath = resolve(process.cwd(), process.env.DB_PATH || 'data/easy-english.db')
mkdirSync(dirname(dbPath), { recursive: true })

export const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')

const SCHEMA_VERSION = 2
const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
const migration2 = readFileSync(new URL('./migrations/002_scenes.sql', import.meta.url), 'utf8')

let currentVersion = db.pragma('user_version', { simple: true }) as number

if (currentVersion < 1) {
  db.transaction(() => {
    db.exec(schema)
    db.pragma('user_version = 1')
  })()
  currentVersion = 1
}

if (currentVersion < 2) {
  db.transaction(() => {
    const columns = db.pragma('table_info(entries)') as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'review_enabled')) {
      db.exec('ALTER TABLE entries ADD COLUMN review_enabled INTEGER NOT NULL DEFAULT 1')
    }
    db.exec(migration2)
    db.exec('CREATE INDEX IF NOT EXISTS idx_entries_review_enabled ON entries(review_enabled)')
    db.pragma(`user_version = ${SCHEMA_VERSION}`)
  })()
}
