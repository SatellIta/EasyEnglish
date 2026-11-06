import type { DraftEntry, EntryType } from '../../shared/types'
import { db } from '../db'
import { normalizeEntryText } from './text'

export { normalizeEntryText }

/**
 * 词条去重只看主要英文内容，不把类型、释义、解释、例句、标签算进去。
 * normalizeEntryText 负责大小写、空白、首尾引号和结尾标点的归一化。
 */
export function entryKey(text: string): string {
  return normalizeEntryText(text)
}

export interface ExistingEntry {
  id: number
  type: EntryType
  text: string
  reviewEnabled: boolean
}

/** 按规范化英文内容查找已有词条；excludeId 用于编辑时排除自身。 */
export function findExistingEntryByText(
  text: string,
  excludeId?: number,
): ExistingEntry | null {
  const key = entryKey(text)
  if (!key) return null

  const rows = db
    .prepare('SELECT id, type, text, review_enabled FROM entries')
    .all() as Array<{ id: number; type: EntryType; text: string; review_enabled: number }>

  const row = rows.find(
    (item) => item.id !== excludeId && entryKey(item.text) === key,
  )
  return row
    ? {
        id: row.id,
        type: row.type,
        text: row.text,
        reviewEnabled: row.review_enabled !== 0,
      }
    : null
}

/** 已有词条的 key → id 映射，用于批量入库时报告重复项来源。 */
export function loadExistingEntryKeyMap(): Map<string, number> {
  const rows = db.prepare('SELECT id, text FROM entries').all() as Array<{
    id: number
    text: string
  }>
  return new Map(rows.map((row) => [entryKey(row.text), row.id]))
}

export function loadExistingEntryKeys(): Set<string> {
  return new Set(loadExistingEntryKeyMap().keys())
}

/**
 * 标记候选词条是否已存在（数据库或本批次前面的条目）。
 * 返回新数组，不修改输入。
 */
export function markDraftDuplicates(
  entries: DraftEntry[],
  existing: Map<string, number> = loadExistingEntryKeyMap(),
): DraftEntry[] {
  const seen = new Set<string>()
  return entries.map((entry) => {
    const key = entryKey(entry.text)
    const existingEntryId = existing.get(key) ?? null
    const duplicate = existingEntryId !== null || seen.has(key)
    seen.add(key)
    return { ...entry, duplicate, existingEntryId }
  })
}
