import type { Entry } from '../../shared/types'
import { db } from '../db'
import { mapEntry } from './mappers'
import { normalizeEntryText } from './text'

export const ENTRY_COLUMNS = `
  e.id, e.type, e.text, e.meaning, e.explanation, e.examples, e.senses, e.notes, e.tags,
  e.phonetic, e.english_definition, e.images, e.learned_at,
  e.source, e.review_enabled, e.error_rate, e.error_samples,
  e.source_session_id, e.source_message_id, e.created_at, e.updated_at,
  (
    SELECT json_group_array(json_object(
      'sceneId', s.id,
      'sceneName', s.name,
      'section', se.section,
      'subsection', se.subsection
    ))
    FROM scene_entries se
    JOIN scenes s ON s.id = se.scene_id
    WHERE se.entry_id = e.id
  ) AS scene_refs
`

export const REVIEW_COLUMNS = `
  r.stage AS r_stage,
  r.interval_days AS r_interval_days,
  r.next_review_at AS r_next_review_at,
  r.last_reviewed_at AS r_last_reviewed_at,
  r.lapses AS r_lapses,
  r.total_reviews AS r_total_reviews,
  r.status AS r_status
`

export const ENTRY_SELECT = `
  SELECT ${ENTRY_COLUMNS}, ${REVIEW_COLUMNS}
  FROM entries e
  LEFT JOIN review_states r ON r.entry_id = e.id
`

export const SCENE_ENTRY_SELECT = `
  SELECT
    ${ENTRY_COLUMNS},
    ${REVIEW_COLUMNS},
    se.section AS se_section,
    se.subsection AS se_subsection,
    se.added_at AS se_added_at,
    se.position AS se_position
  FROM scene_entries se
  JOIN entries e ON e.id = se.entry_id
  LEFT JOIN review_states r ON r.entry_id = e.id
`

export function getEntryById(id: number): Entry | null {
  const row = db.prepare(`${ENTRY_SELECT} WHERE e.id = ?`).get(id)
  return row ? mapEntry(row) : null
}

/** 按归一化英文内容查找已有词条（去重只看文本，不看类型）。 */
export function findDuplicateEntry(_type: Entry['type'], text: string): Entry | null {
  const normalized = normalizeEntryText(text)
  if (!normalized) return null
  const row = db
    .prepare(`${ENTRY_SELECT} WHERE e.normalized_text = ? LIMIT 1`)
    .get(normalized)
  return row ? mapEntry(row) : null
}

export interface SearchFilter {
  clause: string
  params: string[]
}

/**
 * 生成搜索条件：3 个字符以上走 FTS5 trigram，短查询回退到 LIKE。
 * 返回的 clause 作用在别名 e 上。
 */
export function buildSearchFilter(query: string): SearchFilter {
  const trimmed = query.trim()
  if (!trimmed) return { clause: '', params: [] }

  const terms = trimmed
    .split(/\s+/)
    .filter((term) => term.length >= 2 && /[\p{L}\p{N}]/u.test(term))
    .slice(0, 6)

  if (trimmed.length >= 3 && terms.length > 0) {
    const match = terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ')
    return {
      clause: 'e.id IN (SELECT rowid FROM entries_fts WHERE entries_fts MATCH ?)',
      params: [match],
    }
  }

  const like = `%${trimmed}%`
  return {
    clause: '(e.text LIKE ? OR e.meaning LIKE ? OR e.explanation LIKE ? OR e.notes LIKE ? OR e.senses LIKE ?)',
    params: [like, like, like, like, like],
  }
}

export function searchEntries(query: string, limit = 8): Entry[] {
  const filter = buildSearchFilter(query)
  if (!filter.clause) return []
  try {
    const rows = db
      .prepare(`${ENTRY_SELECT} WHERE ${filter.clause} ORDER BY e.created_at DESC LIMIT ?`)
      .all(...filter.params, limit)
    return rows.map(mapEntry)
  } catch {
    return []
  }
}
