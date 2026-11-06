import type { DraftEntry, EntryType } from '../../shared/types'
import { db } from '../db'

/**
 * 词条去重 key：类型 + 规范化文本。
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

export function entryKey(type: EntryType | string, text: string): string {
  return `${type}:${normalizeEntryText(text)}`
}

export function loadExistingEntryKeys(): Set<string> {
  const rows = db.prepare('SELECT type, text FROM entries').all() as Array<{
    type: EntryType
    text: string
  }>
  return new Set(rows.map((row) => entryKey(row.type, row.text)))
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
    const key = entryKey(entry.type, entry.text)
    const duplicate = existing.has(key) || seen.has(key)
    seen.add(key)
    return { ...entry, duplicate }
  })
}
