CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('word', 'phrase', 'sentence')),
  text TEXT NOT NULL,
  meaning TEXT,
  explanation TEXT,
  examples TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(type);
CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries(created_at);

CREATE TABLE IF NOT EXISTS review_states (
  entry_id INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  stage INTEGER NOT NULL DEFAULT 0,
  interval_days REAL NOT NULL DEFAULT 0,
  next_review_at TEXT NOT NULL,
  last_reviewed_at TEXT,
  lapses INTEGER NOT NULL DEFAULT 0,
  total_reviews INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'learning' CHECK (status IN ('learning', 'reviewing', 'mastered'))
);

CREATE INDEX IF NOT EXISTS idx_review_states_next ON review_states(next_review_at);
CREATE INDEX IF NOT EXISTS idx_review_states_status ON review_states(status);

CREATE TABLE IF NOT EXISTS review_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  rating TEXT NOT NULL CHECK (rating IN ('remembered', 'forgot')),
  reviewed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  prev_stage INTEGER NOT NULL,
  next_stage INTEGER NOT NULL,
  next_review_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_review_logs_entry ON review_logs(entry_id);
CREATE INDEX IF NOT EXISTS idx_review_logs_time ON review_logs(reviewed_at);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, id);

CREATE TABLE IF NOT EXISTS daily_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  entries TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 全文检索：trigram 分词对中英文子串搜索都友好。
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  text,
  meaning,
  explanation,
  notes,
  content = 'entries',
  content_rowid = 'id',
  tokenize = 'trigram'
);

CREATE TRIGGER IF NOT EXISTS entries_fts_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, text, meaning, explanation, notes)
  VALUES (new.id, new.text, new.meaning, new.explanation, new.notes);
END;

CREATE TRIGGER IF NOT EXISTS entries_fts_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, text, meaning, explanation, notes)
  VALUES ('delete', old.id, old.text, old.meaning, old.explanation, old.notes);
END;

CREATE TRIGGER IF NOT EXISTS entries_fts_au AFTER UPDATE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, text, meaning, explanation, notes)
  VALUES ('delete', old.id, old.text, old.meaning, old.explanation, old.notes);
  INSERT INTO entries_fts(rowid, text, meaning, explanation, notes)
  VALUES (new.id, new.text, new.meaning, new.explanation, new.notes);
END;

INSERT INTO entries_fts(entries_fts) VALUES ('rebuild');
