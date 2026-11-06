-- v2: scene organization + per-entry review switch
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
