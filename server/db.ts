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

const SCHEMA_VERSION = 1
const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')

const currentVersion = db.pragma('user_version', { simple: true }) as number

if (currentVersion < SCHEMA_VERSION) {
  db.transaction(() => {
    db.exec(schema)
    db.pragma(`user_version = ${SCHEMA_VERSION}`)
  })()
}
