import type {
  Entry,
  EntryInput,
  ImportCommitItem,
  ImportCommitResult,
} from '../../shared/types'
import { db } from '../db'
import { entryKey, loadExistingEntryKeyMap } from './dedupe'
import { insertEntry, updateEntryContent } from './entry-store'
import { getEntryById } from './queries'
import { addEntryToScene, getOrCreateScene } from './scenes'

export interface CommitMarkdownOptions {
  /**
   * 已有词条存在时，用 Markdown 内容更新它的含义、解释、例句等字段。
   * 复习开关、学习状态、错误率和场景归属保持不变。
   */
  updateExisting?: boolean
}

function entryInputFrom(item: ImportCommitItem, images: string[] = []): EntryInput {
  return {
    type: item.type,
    text: item.text,
    meaning: item.meaning ?? null,
    englishDefinition: item.englishDefinition ?? null,
    explanation: item.explanation ?? null,
    examples: item.examples ?? [],
    notes: item.notes ?? null,
    tags: item.tags ?? [],
    phonetic: item.phonetic ?? null,
    images,
  }
}

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '') === (b ?? '')
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/**
 * 同步已有词条时只覆盖 Markdown 里实际提供了的字段：
 * 没写的释义、例句、音标等保持原样，标签取并集，避免快速笔记清空已有内容。
 */
function mergedInputFrom(existing: Entry, item: ImportCommitItem): EntryInput {
  return {
    type: item.type,
    text: item.text,
    meaning: item.meaning?.trim() ? item.meaning : existing.meaning,
    englishDefinition: item.englishDefinition?.trim()
      ? item.englishDefinition
      : existing.englishDefinition,
    explanation: item.explanation?.trim() ? item.explanation : existing.explanation,
    examples: item.examples?.length ? item.examples : existing.examples,
    notes: item.notes?.trim() ? item.notes : existing.notes,
    tags: item.tags?.length
      ? [...new Set([...existing.tags, ...item.tags])]
      : existing.tags,
    phonetic: item.phonetic?.trim() ? item.phonetic : existing.phonetic,
    images: existing.images,
  }
}

/** 只比较 Markdown 能提供的字段，图片、复习状态、来源不在其中。 */
function inputDiffers(existing: Entry, input: EntryInput): boolean {
  return (
    existing.type !== input.type ||
    existing.text !== input.text ||
    !sameText(existing.meaning, input.meaning) ||
    !sameText(existing.englishDefinition, input.englishDefinition) ||
    !sameText(existing.explanation, input.explanation) ||
    !sameText(existing.notes, input.notes) ||
    !sameText(existing.phonetic, input.phonetic) ||
    !sameList(existing.examples, input.examples ?? []) ||
    !sameList(existing.tags, input.tags ?? [])
  )
}

/** 内容越多，越适合作为同一个英文文本的内容来源。标签不算内容，避免裸词覆盖已有释义。 */
function contentScore(item: ImportCommitItem): number {
  let score = 0
  if (item.meaning) score += 1
  if (item.englishDefinition) score += 1
  if (item.explanation) score += 1
  if (item.notes) score += 1
  if (item.phonetic) score += 1
  score += Math.min(item.examples?.length ?? 0, 3)
  return score
}

/**
 * 批量提交 Markdown 词条。
 *
 * 去重仍然只看规范化英文文本：
 * - 已存在的词条不会新建，而是直接加入当前场景（如果给了 scene）；
 * - updateExisting 为 true 时，同时更新已有词条的内容，但保留复习开关和学习状态；
 * - 同一批次里先创建的词条会复用，后续场景只增加关联；
 * - 同一文本出现多次时，用内容最完整的那个作为内容来源，避免场景里的稀疏行覆盖完整词条。
 */
export function commitMarkdownItems(
  items: ImportCommitItem[],
  options: CommitMarkdownOptions = {},
): ImportCommitResult {
  const result: ImportCommitResult = {
    created: 0,
    linked: 0,
    updated: 0,
    skipped: 0,
    scenes: [],
    entryIds: [],
  }
  const sceneNames = new Set<string>()
  const touchedIds = new Set<number>()
  const createdIds = new Set<number>()
  const contentHandledIds = new Set<number>()

  const contentByKey = new Map<string, { item: ImportCommitItem; score: number }>()
  const reviewByKey = new Map<string, boolean>()
  for (const item of items) {
    const key = entryKey(item.text)
    const score = contentScore(item)
    const current = contentByKey.get(key)
    if (!current || score > current.score) contentByKey.set(key, { item, score })
    reviewByKey.set(
      key,
      (reviewByKey.get(key) ?? false) || (item.reviewEnabled ?? true),
    )
  }

  db.transaction(() => {
    const keyToId = loadExistingEntryKeyMap()

    for (const item of items) {
      const key = entryKey(item.text)
      const contentItem = contentByKey.get(key)?.item ?? item
      const existingId = keyToId.get(key)
      const scene = item.scene ? getOrCreateScene(item.scene) : null
      if (scene) sceneNames.add(scene.name)

      if (existingId !== undefined) {
        let touched = false

        if (
          options.updateExisting &&
          !createdIds.has(existingId) &&
          !contentHandledIds.has(existingId)
        ) {
          contentHandledIds.add(existingId)
          const existing = getEntryById(existingId)
          // 只有 Markdown 真的提供了内容字段时才更新；裸词只建立场景关联。
          if (existing && contentScore(contentItem) > 0) {
            const input = mergedInputFrom(existing, contentItem)
            if (inputDiffers(existing, input)) {
              updateEntryContent(existingId, input)
              result.updated += 1
              touched = true
            }
          }
        }

        if (scene) {
          const linked = addEntryToScene(
            scene.id,
            existingId,
            item.section ?? null,
            item.subsection ?? null,
            { updatePlacement: true },
          )
          if (linked) {
            // 本批次内先创建、后续场景再复用的词条也计入 linked，
            // 这样「新建 / 复用」能覆盖所有未新建的词条。
            result.linked += 1
            touched = true
          }
        }

        if (touched) touchedIds.add(existingId)
        else result.skipped += 1
        continue
      }

      const entry = insertEntry(entryInputFrom(contentItem), {
        source: 'markdown-import',
        reviewEnabled: reviewByKey.get(key) ?? contentItem.reviewEnabled ?? true,
      })
      keyToId.set(key, entry.id)
      createdIds.add(entry.id)
      result.created += 1
      touchedIds.add(entry.id)

      if (scene) {
        addEntryToScene(
          scene.id,
          entry.id,
          item.section ?? null,
          item.subsection ?? null,
          { updatePlacement: true },
        )
      }
    }
  })()

  result.scenes = [...sceneNames].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  result.entryIds = [...touchedIds]
  return result
}
