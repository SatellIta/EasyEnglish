CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('word', 'phrase', 'sentence')),
  text TEXT NOT NULL,
  meaning TEXT,
  explanation TEXT,
  examples TEXT NOT NULL DEFAULT '[]',
  -- 一词多义的义项：JSON 数组，每项含 meaning / englishDefinition / explanation / examples
  senses TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  -- Anki 导入的富字段
  phonetic TEXT,
  english_definition TEXT,
  images TEXT NOT NULL DEFAULT '[]',
  external_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  review_enabled INTEGER NOT NULL DEFAULT 1,
  -- 学习流程：NULL 表示还没有通过「认识/不认识」流程学习过
  learned_at TEXT,
  -- 近期加权错误率（0..1）与参与计算的样本数
  error_rate REAL NOT NULL DEFAULT 0,
  error_samples INTEGER NOT NULL DEFAULT 0,
  -- 去重用的归一化文本；来源对话用于词条溯源
  normalized_text TEXT,
  source_session_id INTEGER,
  source_message_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(type);
CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries(created_at);
CREATE INDEX IF NOT EXISTS idx_entries_review_enabled ON entries(review_enabled);
CREATE INDEX IF NOT EXISTS idx_entries_normalized ON entries(type, normalized_text);
CREATE INDEX IF NOT EXISTS idx_entries_error_rate ON entries(error_rate);
CREATE INDEX IF NOT EXISTS idx_entries_external ON entries(source, external_id);
CREATE INDEX IF NOT EXISTS idx_entries_learned ON entries(learned_at);

-- 场景：用户自定义的联想记忆空间。场景成员不改变复习调度，
-- 是否进入每日复习由 entries.review_enabled 决定。
CREATE TABLE IF NOT EXISTS scenes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scenes_name ON scenes(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS scene_entries (
  scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  section TEXT,
  subsection TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (scene_id, entry_id)
);

CREATE INDEX IF NOT EXISTS idx_scene_entries_entry ON scene_entries(entry_id);
CREATE INDEX IF NOT EXISTS idx_scene_entries_scene ON scene_entries(scene_id, position);

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
  -- 场景练习会话绑定的场景；普通对话为 NULL
  scene_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_scene ON chat_sessions(scene_id);

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

-- 反复错误档案：AI 从对话/总结中抽取，按 pattern 去重累加。
CREATE TABLE IF NOT EXISTS learner_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL COLLATE NOCASE,
  category TEXT NOT NULL DEFAULT 'other',
  explanation TEXT,
  correction TEXT,
  example TEXT,
  occurrences INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'ignored'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_learner_errors_pattern
  ON learner_errors(pattern COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_learner_errors_status_seen
  ON learner_errors(status, last_seen_at DESC);

-- AI 人格：默认人格 key 固定，自定义人格 key 为 NULL。
CREATE TABLE IF NOT EXISTS personas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  prompt TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_personas_order ON personas(is_default DESC, sort_order ASC, id ASC);

-- 全文检索：trigram 分词对中英文子串搜索都友好。
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  text,
  meaning,
  explanation,
  notes,
  senses,
  content = 'entries',
  content_rowid = 'id',
  tokenize = 'trigram'
);

CREATE TRIGGER IF NOT EXISTS entries_fts_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, text, meaning, explanation, notes, senses)
  VALUES (new.id, new.text, new.meaning, new.explanation, new.notes, new.senses);
END;

CREATE TRIGGER IF NOT EXISTS entries_fts_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, text, meaning, explanation, notes, senses)
  VALUES ('delete', old.id, old.text, old.meaning, old.explanation, old.notes, old.senses);
END;

CREATE TRIGGER IF NOT EXISTS entries_fts_au AFTER UPDATE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, text, meaning, explanation, notes, senses)
  VALUES ('delete', old.id, old.text, old.meaning, old.explanation, old.notes, old.senses);
  INSERT INTO entries_fts(rowid, text, meaning, explanation, notes, senses)
  VALUES (new.id, new.text, new.meaning, new.explanation, new.notes, new.senses);
END;

INSERT INTO entries_fts(entries_fts) VALUES ('rebuild');
