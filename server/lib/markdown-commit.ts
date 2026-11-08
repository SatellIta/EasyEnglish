import type {
  Entry,
  EntryInput,
  EntrySense,
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

function cleanText(value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? text : null
}

function uniqueExamples(values: string[] | undefined): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of values ?? []) {
    const value = raw.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

function mergeTags(current: string[], extra: string[] | undefined): string[] {
  for (const tag of extra ?? []) {
    if (!current.includes(tag)) current.push(tag)
  }
  return current
}

/** 把一条 Markdown 记录转成一个义项；没有任何内容时返回 null。 */
function senseFromItem(item: ImportCommitItem): EntrySense | null {
  const sense: EntrySense = {
    meaning: cleanText(item.meaning),
    englishDefinition: cleanText(item.englishDefinition),
    explanation: cleanText(item.explanation),
    examples: uniqueExamples(item.examples),
  }
  if (!sense.meaning && !sense.englishDefinition && !sense.explanation && !sense.examples.length) {
    return null
  }
  return sense
}

/** 已有一词多义词条没有 senses 时，把顶层字段视为第一个义项。 */
function senseFromEntry(entry: Entry): EntrySense | null {
  const examples = uniqueExamples(entry.examples)
  if (!entry.meaning && !entry.englishDefinition && !entry.explanation && !examples.length) {
    return null
  }
  return {
    meaning: cleanText(entry.meaning),
    englishDefinition: cleanText(entry.englishDefinition),
    explanation: cleanText(entry.explanation),
    examples,
  }
}

/**
 * 义项身份优先看释义：中文含义相同视为同一个义项，即使这次补充了
 * 英英释义或例句；没有中文含义时再比较英英释义/补充说明。
 */
function sensesMatch(a: EntrySense, b: EntrySense): boolean {
  if (a.meaning && b.meaning) return a.meaning === b.meaning
  if (a.englishDefinition && b.englishDefinition) {
    return a.englishDefinition === b.englishDefinition
  }
  if (a.explanation && b.explanation) return a.explanation === b.explanation
  return isBareSense(a) && isBareSense(b)
}

/** 只有例句、没有释义的义项无法独立区分，合并时挂到第一个义项。 */
function isBareSense(sense: EntrySense): boolean {
  return !sense.meaning && !sense.englishDefinition && !sense.explanation
}

function cloneSenses(senses: EntrySense[]): EntrySense[] {
  return senses.map((sense) => ({ ...sense, examples: [...sense.examples] }))
}

/** 合并义项列表：同义项合并例句，裸例句挂到第一个义项。 */
function mergeSenseLists(base: EntrySense[], extra: EntrySense[]): EntrySense[] {
  const result = cloneSenses(base)
  for (const sense of extra) {
    if (isBareSense(sense) && result.length) {
      for (const example of sense.examples) {
        if (!result[0].examples.includes(example)) result[0].examples.push(example)
      }
      continue
    }
    const existing = result.find((item) => sensesMatch(item, sense))
    if (existing) {
      if (sense.meaning) existing.meaning = sense.meaning
      if (sense.englishDefinition) existing.englishDefinition = sense.englishDefinition
      if (sense.explanation) existing.explanation = sense.explanation
      for (const example of sense.examples) {
        if (!existing.examples.includes(example)) existing.examples.push(example)
      }
    } else {
      result.push({ ...sense, examples: [...sense.examples] })
    }
  }
  return result
}

/** 多义项词条的顶层字段：每个字段取第一个有值的义项，例句取并集。 */
function flattenSenses(senses: EntrySense[]): {
  meaning: string | null
  englishDefinition: string | null
  explanation: string | null
  examples: string[]
} {
  const first = <K extends 'meaning' | 'englishDefinition' | 'explanation'>(field: K) =>
    senses.find((sense) => sense[field])?.[field] ?? null
  return {
    meaning: first('meaning'),
    englishDefinition: first('englishDefinition'),
    explanation: first('explanation'),
    examples: uniqueExamples(senses.flatMap((sense) => sense.examples)),
  }
}

/** 内容越多，越适合作为同一个英文文本的入口字段来源。标签不算内容，避免裸词覆盖已有释义。 */
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

interface Aggregate {
  /** 内容最完整的记录，提供类型、文本、笔记、音标等入口字段 */
  item: ImportCommitItem
  score: number
  senses: EntrySense[]
  tags: string[]
  reviewEnabled: boolean
}

/** 同一英文文本的多条记录聚合到一起；不同释义各自成为一个义项。 */
function aggregateItems(items: ImportCommitItem[]): Map<string, Aggregate> {
  const aggregates = new Map<string, Aggregate>()
  for (const item of items) {
    const key = entryKey(item.text)
    const score = contentScore(item)
    let aggregate = aggregates.get(key)
    if (!aggregate) {
      aggregate = {
        item,
        score,
        senses: [],
        tags: [],
        reviewEnabled: false,
      }
      aggregates.set(key, aggregate)
    } else if (score > aggregate.score) {
      aggregate.item = item
      aggregate.score = score
    }

    aggregate.reviewEnabled = aggregate.reviewEnabled || (item.reviewEnabled ?? true)
    mergeTags(aggregate.tags, item.tags)
    const sense = senseFromItem(item)
    if (sense) aggregate.senses.push(sense)
  }
  return aggregates
}

function entryInputFrom(aggregate: Aggregate, images: string[] = []): EntryInput {
  const base = aggregate.item
  const senses = mergeSenseLists([], aggregate.senses)
  const common = {
    type: base.type,
    text: base.text,
    notes: base.notes ?? null,
    tags: [...aggregate.tags],
    phonetic: base.phonetic ?? null,
    images,
  }

  if (senses.length >= 2) {
    const flat = flattenSenses(senses)
    return {
      ...common,
      meaning: flat.meaning,
      englishDefinition: flat.englishDefinition,
      explanation: flat.explanation,
      examples: flat.examples,
      senses,
    }
  }

  return {
    ...common,
    meaning: base.meaning ?? null,
    englishDefinition: base.englishDefinition ?? null,
    explanation: base.explanation ?? null,
    examples: base.examples ?? [],
    senses: [],
  }
}

/**
 * 同步已有词条时只覆盖 Markdown 里实际提供了的字段：
 * 没写的释义、例句、音标等保持原样，标签取并集，避免快速笔记清空已有内容。
 * 义项是累加的：导入只会新增义项或给已有义项补例句，不会删除旧义项。
 */
function mergedInputFrom(existing: Entry, aggregate: Aggregate): EntryInput {
  const base = aggregate.item
  const incoming = mergeSenseLists([], aggregate.senses)
  const common = {
    type: base.type,
    text: base.text,
    notes: base.notes?.trim() ? base.notes : existing.notes,
    tags: mergeTags([...existing.tags], aggregate.tags),
    phonetic: base.phonetic?.trim() ? base.phonetic : existing.phonetic,
    images: existing.images,
  }

  if (!incoming.length) {
    // 裸词/仅有标签的同步：只保留原有内容。
    return {
      ...common,
      meaning: existing.meaning,
      englishDefinition: existing.englishDefinition,
      explanation: existing.explanation,
      examples: existing.examples,
      senses: existing.senses,
    }
  }

  const seed = existing.senses.length
    ? cloneSenses(existing.senses)
    : (() => {
        const sense = senseFromEntry(existing)
        return sense ? [sense] : []
      })()
  const mergedSenses = mergeSenseLists(seed, incoming)

  if (mergedSenses.length >= 2) {
    const flat = flattenSenses(mergedSenses)
    return {
      ...common,
      meaning: flat.meaning,
      englishDefinition: flat.englishDefinition,
      explanation: flat.explanation,
      examples: flat.examples,
      senses: mergedSenses,
    }
  }

  // 只有一个义项时继续使用扁平字段，例句按并集保留。
  const flat = flattenSenses(mergedSenses)
  return {
    ...common,
    meaning: flat.meaning,
    englishDefinition: flat.englishDefinition,
    explanation: flat.explanation,
    examples: flat.examples,
    senses: [],
  }
}

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '') === (b ?? '')
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function sameSenses(a: EntrySense[], b: EntrySense[]): boolean {
  if (a.length !== b.length) return false
  return a.every((sense, index) => {
    const other = b[index]
    return (
      sameText(sense.meaning, other.meaning) &&
      sameText(sense.englishDefinition, other.englishDefinition) &&
      sameText(sense.explanation, other.explanation) &&
      sameList(sense.examples, other.examples)
    )
  })
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
    !sameList(existing.tags, input.tags ?? []) ||
    !sameSenses(existing.senses, input.senses ?? [])
  )
}

/**
 * 批量提交 Markdown 词条。
 *
 * 去重仍然只看规范化英文文本：
 * - 已存在的词条不会新建，而是直接加入当前场景（如果给了 scene）；
 * - updateExisting 为 true 时，同时更新已有词条的内容，但保留复习开关和学习状态；
 * - 同一文本出现多次时聚合为词条：不同释义成为不同义项，同义项合并例句。
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
  const aggregates = aggregateItems(items)

  db.transaction(() => {
    const keyToId = loadExistingEntryKeyMap()

    for (const item of items) {
      const key = entryKey(item.text)
      const aggregate = aggregates.get(key)
      if (!aggregate) continue
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
          if (existing && aggregate.senses.length > 0) {
            const input = mergedInputFrom(existing, aggregate)
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

      const entry = insertEntry(entryInputFrom(aggregate), {
        source: 'markdown-import',
        reviewEnabled: aggregate.reviewEnabled,
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
