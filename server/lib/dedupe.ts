import type { DraftEntry, EntryType } from '../../shared/types'
import { db } from '../db'
import { normalizeEntryText } from './text'

export { normalizeEntryText }

export function entryKey(type: EntryType | string, text: string): string {
  return `${type}:${normalizeEntryText(text)}`
}

/** 已有词条的 key → id 映射，用于批量入库时报告重复项来源。 */
export function loadExistingEntryKeyMap(): Map<string, number> {
  const rows = db.prepare('SELECT id, type, text FROM entries').all() as Array<{
    id: number
    type: EntryType
    text: string
  }>
  return new Map(rows.map((row) => [entryKey(row.type, row.text), row.id]))
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
    const key = entryKey(entry.type, entry.text)
    const existingEntryId = existing.get(key) ?? null
    const duplicate = existingEntryId !== null || seen.has(key)
    seen.add(key)
    return { ...entry, duplicate, existingEntryId }
  })
}
