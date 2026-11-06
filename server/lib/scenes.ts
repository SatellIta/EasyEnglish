import type { Scene, SceneSummary } from '../../shared/types'
import { db } from '../db'
import { mapScene, mapSceneSummary } from './mappers'
import { nowIso } from './time'

export const SCENE_SUMMARY_SELECT = `
  SELECT
    s.id, s.name, s.description, s.created_at, s.updated_at,
    COUNT(se.entry_id) AS total,
    COALESCE(SUM(CASE WHEN e.type = 'word' THEN 1 ELSE 0 END), 0) AS word,
    COALESCE(SUM(CASE WHEN e.type = 'phrase' THEN 1 ELSE 0 END), 0) AS phrase,
    COALESCE(SUM(CASE WHEN e.type = 'sentence' THEN 1 ELSE 0 END), 0) AS sentence
  FROM scenes s
  LEFT JOIN scene_entries se ON se.scene_id = s.id
  LEFT JOIN entries e ON e.id = se.entry_id
`

export function listSceneSummaries(): SceneSummary[] {
  const rows = db
    .prepare(`${SCENE_SUMMARY_SELECT} GROUP BY s.id ORDER BY s.updated_at DESC, s.id DESC`)
    .all()
  return rows.map(mapSceneSummary)
}

export function getSceneSummary(id: number): SceneSummary | null {
  const row = db.prepare(`${SCENE_SUMMARY_SELECT} WHERE s.id = ? GROUP BY s.id`).get(id)
  return row ? mapSceneSummary(row) : null
}

export function getSceneByName(name: string): Scene | null {
  const row = db.prepare('SELECT * FROM scenes WHERE name = ? COLLATE NOCASE').get(name.trim())
  return row ? mapScene(row) : null
}

export function createScene(name: string, description: string | null = null): Scene {
  const now = nowIso()
  const info = db
    .prepare('INSERT INTO scenes (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(name.trim(), description, now, now)
  const row = db.prepare('SELECT * FROM scenes WHERE id = ?').get(Number(info.lastInsertRowid))
  return mapScene(row)
}

export function getOrCreateScene(name: string, description: string | null = null): Scene {
  return getSceneByName(name) ?? createScene(name, description)
}

export function updateScene(id: number, input: { name?: string; description?: string | null }): Scene | null {
  const fields: string[] = []
  const params: unknown[] = []
  if (input.name !== undefined) {
    fields.push('name = ?')
    params.push(input.name.trim())
  }
  if (input.description !== undefined) {
    fields.push('description = ?')
    params.push(input.description)
  }
  if (!fields.length) {
    const row = db.prepare('SELECT * FROM scenes WHERE id = ?').get(id)
    return row ? mapScene(row) : null
  }
  fields.push('updated_at = ?')
  params.push(nowIso(), id)
  db.prepare(`UPDATE scenes SET ${fields.join(', ')} WHERE id = ?`).run(...params)
  const row = db.prepare('SELECT * FROM scenes WHERE id = ?').get(id)
  return row ? mapScene(row) : null
}

export function deleteScene(id: number): boolean {
  return db.prepare('DELETE FROM scenes WHERE id = ?').run(id).changes > 0
}

export function addEntryToScene(
  sceneId: number,
  entryId: number,
  section: string | null = null,
  subsection: string | null = null,
): boolean {
  const next = db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM scene_entries WHERE scene_id = ?')
    .get(sceneId) as { next: number }
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO scene_entries (scene_id, entry_id, section, subsection, position, added_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(sceneId, entryId, section, subsection, Number(next.next), nowIso())
  if (info.changes > 0) {
    db.prepare('UPDATE scenes SET updated_at = ? WHERE id = ?').run(nowIso(), sceneId)
  }
  return info.changes > 0
}

export function removeEntryFromScene(sceneId: number, entryId: number): boolean {
  const info = db
    .prepare('DELETE FROM scene_entries WHERE scene_id = ? AND entry_id = ?')
    .run(sceneId, entryId)
  if (info.changes > 0) {
    db.prepare('UPDATE scenes SET updated_at = ? WHERE id = ?').run(nowIso(), sceneId)
  }
  return info.changes > 0
}
