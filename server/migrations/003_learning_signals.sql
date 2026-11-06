-- 反复错误档案：由 AI 总结从对话中抽取，按 pattern 去重累加。
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
