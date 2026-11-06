import type { DraftEntry, EntryType } from '../../shared/types'
import { db } from '../db'

/**
 * 词条去重只看主要英文内容，不把类型、释义、解释、例句、标签算进去。
 * - 忽略大小写、首尾空白和多余空格
 * - 忽略首尾引号
 * - 忽略结尾的句号/问号/感叹号，避免 "You're gorgeous." 和 "You're gorgeous" 重复
 */
export function normalizeEntryText(text: string): string {
  return text
    .trim()
    .replace(/^["“”'‘’]+/, '')
    .replace(/["“”'‘’]+$/, '')
    .replace(/\s+/g, ' ')
    .replace(/[.!?。！？]+$/u, '')
    .trim()
    .toLowerCase()
}

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

export function loadExistingEntryKeys(): Set<string> {
  const rows = db.prepare('SELECT text FROM entries').all() as Array<{ text: string }>
  return new Set(rows.map((row) => entryKey(row.text)))
}

/**
 * 标记候选词条是否已存在（数据库或本批次前面的条目）。
 * 返回新数组，不修改输入。
 */
export function markDraftDuplicates(
  entries: DraftEntry[],
  existing: Set<string> = loadExistingEntryKeys(),
): DraftEntry[] {
  const seen = new Set<string>()
  return entries.map((entry) => {
    const key = entryKey(entry.text)
    const duplicate = existing.has(key) || seen.has(key)
    seen.add(key)
    return { ...entry, duplicate }
  })
}
