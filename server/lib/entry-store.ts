import type { Entry, EntryInput } from '../../shared/types'
import { db } from '../db'
import { getEntryById } from './queries'
import { initialSchedule } from './scheduler'
import { normalizeEntryText } from './text'
import { nowIso } from './time'

export interface InsertEntryOptions {
  source?: string
  reviewEnabled?: boolean
  sourceSessionId?: number | null
  sourceMessageId?: number | null
  /** Anki 原始 GUID，用于再次导入时识别同一条词 */
  externalId?: string | null
  /**
   * 学习流程状态。缺省为当前时间（手动/总结/Markdown 导入都视为已学习）；
   * Anki 批量导入传 null，让词条先进入学习流程。
   */
  learnedAt?: string | null
}

/**
 * 写入词条并创建初始复习状态。
 * review_enabled = 0 的词条仍保留复习状态，方便用户以后重新打开复习；
 * 复习队列和到期统计会按该开关过滤。
 */
export function insertEntry(input: EntryInput, options: InsertEntryOptions = {}): Entry {
  const now = nowIso()
  const reviewEnabled = options.reviewEnabled ?? input.reviewEnabled ?? true
  const learnedAt = options.learnedAt === undefined ? now : options.learnedAt
  const info = db
    .prepare(
      `INSERT INTO entries
        (type, text, meaning, explanation, examples, notes, tags,
         phonetic, english_definition, images, external_id,
         source, review_enabled, learned_at,
         normalized_text, source_session_id, source_message_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.type,
      input.text,
      input.meaning ?? null,
      input.explanation ?? null,
      JSON.stringify(input.examples ?? []),
      input.notes ?? null,
      JSON.stringify(input.tags ?? []),
      input.phonetic ?? null,
      input.englishDefinition ?? null,
      JSON.stringify(input.images ?? []),
      options.externalId ?? null,
      options.source ?? input.source ?? 'manual',
      reviewEnabled ? 1 : 0,
      learnedAt,
      normalizeEntryText(input.text),
      options.sourceSessionId ?? input.sourceSessionId ?? null,
      options.sourceMessageId ?? input.sourceMessageId ?? null,
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

/**
 * 导入「更新已有词条」模式：只替换内容字段，保留复习状态、错误率和来源。
 */
export function updateEntryContent(
  id: number,
  input: EntryInput,
  options: { externalId?: string | null; source?: string } = {},
): Entry | null {
  const now = nowIso()
  const fields = [
    'type = ?',
    'text = ?',
    'meaning = ?',
    'explanation = ?',
    'examples = ?',
    'notes = ?',
    'tags = ?',
    'phonetic = ?',
    'english_definition = ?',
    'images = ?',
    'normalized_text = ?',
    'updated_at = ?',
  ]
  const params: unknown[] = [
    input.type,
    input.text,
    input.meaning ?? null,
    input.explanation ?? null,
    JSON.stringify(input.examples ?? []),
    input.notes ?? null,
    JSON.stringify(input.tags ?? []),
    input.phonetic ?? null,
    input.englishDefinition ?? null,
    JSON.stringify(input.images ?? []),
    normalizeEntryText(input.text),
    now,
  ]
  if (options.source) {
    fields.push('source = ?')
    params.push(options.source)
  }
  if (options.externalId !== undefined) {
    fields.push('external_id = ?')
    params.push(options.externalId)
  }
  db.prepare(`UPDATE entries SET ${fields.join(', ')} WHERE id = ?`).run(...params, id)
  return getEntryById(id)
}

export function setEntryReviewEnabled(id: number, enabled: boolean): Entry | null {
  db.prepare('UPDATE entries SET review_enabled = ?, updated_at = ? WHERE id = ?').run(
    enabled ? 1 : 0,
    nowIso(),
    id,
  )
  return getEntryById(id)
}
