import Database from 'better-sqlite3'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { normalizeEntryText } from './lib/text'

const dbPath = resolve(process.cwd(), process.env.DB_PATH || 'data/easy-english.db')
mkdirSync(dirname(dbPath), { recursive: true })

export const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')

const SCHEMA_VERSION = 7
const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
const migration2 = readFileSync(new URL('./migrations/002_scenes.sql', import.meta.url), 'utf8')
const migration3 = readFileSync(
  new URL('./migrations/003_learning_signals.sql', import.meta.url),
  'utf8',
)
const migration4 = readFileSync(new URL('./migrations/004_scene_chat.sql', import.meta.url), 'utf8')
const migration5 = readFileSync(new URL('./migrations/005_personas.sql', import.meta.url), 'utf8')
const migration6 = readFileSync(
  new URL('./migrations/006_rich_entries.sql', import.meta.url),
  'utf8',
)
const migration7 = readFileSync(new URL('./migrations/007_senses.sql', import.meta.url), 'utf8')

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
    db.pragma('user_version = 2')
  })()
  currentVersion = 2
}

if (currentVersion < 3) {
  db.transaction(() => {
    const columns = db.pragma('table_info(entries)') as Array<{ name: string }>
    const hasColumn = (name: string) => columns.some((column) => column.name === name)
    const addColumn = (name: string, ddl: string) => {
      if (!hasColumn(name)) db.exec(`ALTER TABLE entries ADD COLUMN ${ddl}`)
    }

    addColumn('error_rate', 'error_rate REAL NOT NULL DEFAULT 0')
    addColumn('error_samples', 'error_samples INTEGER NOT NULL DEFAULT 0')
    addColumn('normalized_text', 'normalized_text TEXT')
    addColumn('source_session_id', 'source_session_id INTEGER')
    addColumn('source_message_id', 'source_message_id INTEGER')

    db.exec(migration3)
    db.exec('CREATE INDEX IF NOT EXISTS idx_entries_normalized ON entries(type, normalized_text)')
    db.exec('CREATE INDEX IF NOT EXISTS idx_entries_error_rate ON entries(error_rate)')

    // 回填去重文本。
    const missingText = db
      .prepare("SELECT id, text FROM entries WHERE normalized_text IS NULL OR normalized_text = ''")
      .all() as Array<{ id: number; text: string }>
    const updateText = db.prepare('UPDATE entries SET normalized_text = ? WHERE id = ?')
    for (const row of missingText) {
      updateText.run(normalizeEntryText(row.text), row.id)
    }

    // 用历史复习记录回填近期加权错误率：越新的记录权重越高。
    const entries = db.prepare('SELECT id FROM entries').all() as Array<{ id: number }>
    const logsStmt = db.prepare(
      `SELECT rating FROM review_logs WHERE entry_id = ?
       ORDER BY reviewed_at DESC, id DESC`,
    )
    const updateRate = db.prepare(
      'UPDATE entries SET error_rate = ?, error_samples = ? WHERE id = ?',
    )
    const decay = 0.7
    for (const entry of entries) {
      const logs = logsStmt.all(entry.id) as Array<{ rating: 'remembered' | 'forgot' }>
      if (!logs.length) continue
      let weighted = 0
      let weightSum = 0
      for (let index = 0; index < logs.length; index += 1) {
        const weight = Math.pow(decay, index)
        weighted += (logs[index].rating === 'forgot' ? 1 : 0) * weight
        weightSum += weight
      }
      updateRate.run(weightSum ? weighted / weightSum : 0, logs.length, entry.id)
    }

    db.pragma(`user_version = 3`)
  })()
}

if (currentVersion < 4) {
  db.transaction(() => {
    const columns = db.pragma('table_info(chat_sessions)') as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'scene_id')) {
      db.exec('ALTER TABLE chat_sessions ADD COLUMN scene_id INTEGER')
    }
    db.exec(migration4)
    db.pragma('user_version = 4')
  })()
}

if (currentVersion < 5) {
  db.transaction(() => {
    db.exec(migration5)
    db.pragma('user_version = 5')
  })()
}

if (currentVersion < 6) {
  db.transaction(() => {
    // 全新数据库的 schema.sql 已经包含这些列；旧库才需要 ALTER。
    const columns = db.pragma('table_info(entries)') as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'phonetic')) {
      db.exec(migration6)
    } else {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_entries_external ON entries(source, external_id);
        CREATE INDEX IF NOT EXISTS idx_entries_learned ON entries(learned_at);
        UPDATE entries SET learned_at = created_at WHERE learned_at IS NULL;
      `)
    }
    db.pragma('user_version = 6')
  })()
  currentVersion = 6
}

if (currentVersion < 7) {
  db.transaction(() => {
    const columns = db.pragma('table_info(entries)') as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'senses')) {
      db.exec("ALTER TABLE entries ADD COLUMN senses TEXT NOT NULL DEFAULT '[]'")
    }

    // FTS5 的列不能原地增加：旧索引整体重建，把 senses 也纳入检索。
    const ftsColumns = db.pragma('table_info(entries_fts)') as Array<{ name: string }>
    if (!ftsColumns.some((column) => column.name === 'senses')) {
      db.exec(migration7)
    }
    db.pragma('user_version = 7')
  })()
  currentVersion = 7
}
