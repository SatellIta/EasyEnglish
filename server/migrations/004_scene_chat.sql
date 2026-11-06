-- 场景练习会话：chat_sessions.scene_id 在 db.ts 中按需 ALTER 添加，
-- 这里只补索引，兼容已有数据库。
CREATE INDEX IF NOT EXISTS idx_chat_sessions_scene ON chat_sessions(scene_id);
