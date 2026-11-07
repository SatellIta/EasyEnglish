-- 富词条字段：Anki 导入带来的音标、英英释义、图片，以及学习流程状态。
ALTER TABLE entries ADD COLUMN phonetic TEXT;
ALTER TABLE entries ADD COLUMN english_definition TEXT;
ALTER TABLE entries ADD COLUMN images TEXT NOT NULL DEFAULT '[]';
ALTER TABLE entries ADD COLUMN external_id TEXT;
ALTER TABLE entries ADD COLUMN learned_at TEXT;

CREATE INDEX IF NOT EXISTS idx_entries_external ON entries(source, external_id);
CREATE INDEX IF NOT EXISTS idx_entries_learned ON entries(learned_at);

-- 已有词条都已经被用户主动添加/确认过，视为已学习，不再进入新的学习流程。
UPDATE entries SET learned_at = created_at WHERE learned_at IS NULL;
