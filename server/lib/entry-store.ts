import type { Entry, EntryInput } from '../../shared/types'
import { db } from '../db'
import { getEntryById } from './queries'
import { initialSchedule } from './scheduler'
import { nowIso } from './time'

export interface InsertEntryOptions {
  source?: string
  reviewEnabled?: boolean
}

/**
 * 写入词条并创建初始复习状态。
 * review_enabled = 0 的词条仍保留复习状态，方便用户以后重新打开复习；
 * 复习队列和到期统计会按该开关过滤。
 */
export function insertEntry(input: EntryInput, options: InsertEntryOptions = {}): Entry {
  const now = nowIso()
  const reviewEnabled = options.reviewEnabled ?? input.reviewEnabled ?? true
  const info = db
    .prepare(
      `INSERT INTO entries
        (type, text, meaning, explanation, examples, notes, tags, source, review_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.type,
      input.text,
      input.meaning ?? null,
      input.explanation ?? null,
      JSON.stringify(input.examples ?? []),
      input.notes ?? null,
      JSON.stringify(input.tags ?? []),
      options.source ?? input.source ?? 'manual',
      reviewEnabled ? 1 : 0,
      now,
      now,
    )

  const id = Number(info.lastInsertRowid)
  const schedule = initialSchedule(new Date(now))
  db.prepare(
    `INSERT INTO review_states (entry_id, stage, interval_days, next_review_at, lapses, total_reviews, status)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
  ).run(id, schedule.stage, schedule.intervalDays, schedule.nextReviewAt, schedule.lapses, schedule.status)

  return getEntryById(id) as Entry
}

export function setEntryReviewEnabled(id: number, enabled: boolean): Entry | null {
  db.prepare('UPDATE entries SET review_enabled = ?, updated_at = ? WHERE id = ?').run(
    enabled ? 1 : 0,
    nowIso(),
    id,
  )
  return getEntryById(id)
}
