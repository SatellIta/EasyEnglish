import type {
  ErrorCategory,
  LearnerError,
  LearnerErrorDraft,
  LearnerErrorStatus,
} from '../../shared/types'
import { db } from '../db'
import { normalizeEntryText } from './text'
import { nowIso } from './time'

const CATEGORIES: ErrorCategory[] = ['grammar', 'usage', 'spelling', 'pronunciation', 'other']
const STATUSES: LearnerErrorStatus[] = ['active', 'resolved', 'ignored']

function normalizeCategory(value: unknown): ErrorCategory {
  return CATEGORIES.includes(value as ErrorCategory) ? (value as ErrorCategory) : 'other'
}

export function normalizeErrorPattern(value: string): string {
  return normalizeEntryText(value).slice(0, 300)
}

export function mapLearnerError(row: any): LearnerError {
  return {
    id: row.id,
    pattern: row.pattern,
    category: normalizeCategory(row.category),
    explanation: row.explanation ?? null,
    correction: row.correction ?? null,
    example: row.example ?? null,
    occurrences: Number(row.occurrences ?? 1),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    status: STATUSES.includes(row.status) ? row.status : 'active',
  }
}

/**
 * 按归一化 pattern 做 upsert：同一类错误再次出现时累加次数并刷新最近出现时间。
 * 已被用户忽略的错误保持 ignored，不因为再次出现而自动恢复。
 */
export function upsertLearnerError(draft: LearnerErrorDraft): LearnerError | null {
  const pattern = normalizeErrorPattern(draft.pattern)
  if (!pattern) return null

  const now = nowIso()
  const category = normalizeCategory(draft.category)
  const existing = db
    .prepare('SELECT * FROM learner_errors WHERE pattern = ? COLLATE NOCASE LIMIT 1')
    .get(pattern) as any

  if (existing) {
    db.prepare(
      `UPDATE learner_errors
       SET occurrences = occurrences + 1,
           last_seen_at = ?,
           category = ?,
           explanation = COALESCE(?, explanation),
           correction = COALESCE(?, correction),
           example = COALESCE(?, example),
           status = CASE WHEN status = 'ignored' THEN status ELSE 'active' END
       WHERE id = ?`,
    ).run(
      now,
      category,
      draft.explanation ?? null,
      draft.correction ?? null,
      draft.example ?? null,
      existing.id,
    )
    return mapLearnerError(db.prepare('SELECT * FROM learner_errors WHERE id = ?').get(existing.id))
  }

  const info = db
    .prepare(
      `INSERT INTO learner_errors
        (pattern, category, explanation, correction, example, occurrences, first_seen_at, last_seen_at, status)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'active')`,
    )
    .run(
      pattern,
      category,
      draft.explanation ?? null,
      draft.correction ?? null,
      draft.example ?? null,
      now,
      now,
    )

  return mapLearnerError(
    db.prepare('SELECT * FROM learner_errors WHERE id = ?').get(Number(info.lastInsertRowid)),
  )
}

export function listLearnerErrors(options: {
  status?: LearnerErrorStatus
  limit?: number
} = {}): LearnerError[] {
  const status = options.status && STATUSES.includes(options.status) ? options.status : null
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100)
  const rows = status
    ? db
        .prepare(
          `SELECT * FROM learner_errors WHERE status = ?
           ORDER BY occurrences DESC, last_seen_at DESC, id DESC LIMIT ?`,
        )
        .all(status, limit)
    : db
        .prepare(
          `SELECT * FROM learner_errors
           ORDER BY status = 'active' DESC, occurrences DESC, last_seen_at DESC, id DESC LIMIT ?`,
        )
        .all(limit)
  return rows.map(mapLearnerError)
}

/** 注入系统提示词的高频错误，只取 active。 */
export function topActiveErrors(limit = 8): LearnerError[] {
  return listLearnerErrors({ status: 'active', limit })
}

export function updateLearnerErrorStatus(
  id: number,
  status: LearnerErrorStatus,
): LearnerError | null {
  if (!STATUSES.includes(status)) return null
  const info = db.prepare('UPDATE learner_errors SET status = ? WHERE id = ?').run(status, id)
  if (!info.changes) return null
  const row = db.prepare('SELECT * FROM learner_errors WHERE id = ?').get(id)
  return row ? mapLearnerError(row) : null
}

export function deleteLearnerError(id: number): boolean {
  return db.prepare('DELETE FROM learner_errors WHERE id = ?').run(id).changes > 0
}
