import type { EntryType } from '../../shared/types'
import { ENTRY_TYPE_LABELS } from '../../shared/types'

export interface ParsedImportItem {
  type: EntryType
  text: string
  meaning: string | null
  englishDefinition: string | null
  explanation: string | null
  examples: string[]
  notes: string | null
  tags: string[]
  phonetic: string | null
  category: string
  group: string | null
  scene: string | null
  section: string | null
  subsection: string | null
  reviewEnabled: boolean
}

export interface ParsedMarkdown {
  items: ParsedImportItem[]
  warnings: string[]
}

type CategoryName = 'words' | 'collocations' | 'sentences' | 'scenery' | 'other'

type FieldKey =
  | 'text'
  | 'meaning'
  | 'englishDefinition'
  | 'explanation'
  | 'examples'
  | 'notes'
  | 'phonetic'
  | 'tags'

interface EntryFields {
  meaning?: string | null
  englishDefinition?: string | null
  explanation?: string | null
  examples?: string[]
  notes?: string | null
  phonetic?: string | null
  tags?: string[]
}

interface AddOptions extends EntryFields {
  /** 场景中 - 开头的行按句子处理 */
  bullet?: boolean
  /** 表格行已经有明确字段，不再解析行内的 = / — */
  explicit?: boolean
}

const CJK = /[㐀-鿿]/

function stripQuotes(value: string): string {
  return value.replace(/^["“”'‘’]+/, '').replace(/["“”'‘’]+$/, '').trim()
}

function cleanInline(value: string): string {
  return value
    .replace(/^>\s?/, '')
    .replace(/<br\s*\/?>/gi, ' / ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanCell(value: string): string {
  // 反引号在表格里常用来包住符号；先全部去掉，避免单边反引号残留。
  return stripQuotes(cleanInline(value.replace(/`/g, ' ')))
}

function splitRow(line: string): string[] {
  let text = line.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|')) text = text.slice(0, -1)

  const cells: string[] = []
  let current = ''
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '\\' && text[i + 1] === '|') {
      current += '|'
      i += 1
      continue
    }
    if (char === '|') {
      cells.push(current)
      current = ''
      continue
    }
    current += char
  }
  cells.push(current)
  return cells.map(cleanCell)
}

function isSeparatorRow(line: string): boolean {
  const cells = splitRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.trim()))
}

/**
 * 普通行可选使用 `text = explanation` 或 `text — 中文释义`。
 * 表格行不走这里，直接使用具名列。
 */
function splitExplanation(raw: string): {
  text: string
  meaning: string | null
  explanation: string | null
} {
  let text = raw.trim()
  let rhs: string | null = null

  const eq = text.indexOf('=')
  if (eq > 0) {
    rhs = text.slice(eq + 1).trim()
    text = text.slice(0, eq).trim()
  } else {
    const dash = /\s+[—–]\s*/.exec(text)
    if (dash && dash.index > 0) {
      rhs = text.slice(dash.index + dash[0].length).trim()
      text = text.slice(0, dash.index).trim()
    }
  }

  return {
    text,
    meaning: rhs && CJK.test(rhs) ? rhs : null,
    explanation: rhs && !CJK.test(rhs) ? rhs : null,
  }
}

function detectType(text: string): EntryType {
  const clean = text.trim()
  if (!clean || !/[a-z]/i.test(clean)) return 'word'
  const words = clean.split(/\s+/).filter(Boolean)
  if (/[.!?。！？]$/.test(clean) || /\.\.\.$/.test(clean)) {
    return words.length >= 2 ? 'sentence' : 'word'
  }
  if (words.length >= 5) return 'sentence'
  if (words.length > 1) return 'phrase'
  return 'word'
}

/**
 * 仅用于明确是单词的目录（# words / 场景 #### 单词）。
 * 允许用带空格的 ` / ` 分隔多个单词；短语、句子、自动判断的目录不拆分。
 */
function splitWordAlternatives(text: string): string[] {
  if (!/\s\/\s/.test(text)) return [text]
  const parts = text
    .split(/\s+\/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length < 2 || parts.length > 8) return [text]
  if (parts.some((part) => part.split(/\s+/).length > 5)) return [text]
  return parts
}

function normalizeCategory(value: string): CategoryName {
  const text = value.trim().toLowerCase().replace(/[*_`]/g, '')
  if (/^(words?|vocabulary|词汇|单词)$/.test(text)) return 'words'
  if (/^(collocations?|phrases?|搭配|短语)$/.test(text)) return 'collocations'
  if (/^(sentences?|句子|expressions?)$/.test(text)) return 'sentences'
  if (/^(scenery|scenes?|场景)$/.test(text)) return 'scenery'
  return 'other'
}

/** 场景中的类型标题：H3（旧格式）或 H4（新格式）。 */
export function sceneTypeFromHeading(value: string): EntryType | null {
  const text = value.trim().toLowerCase().replace(/[*_`]/g, '').replace(/[：:]\s*$/, '')
  if (!text) return null
  const english = text.replace(/^the\s+/, '')
  if (/句子/.test(text) || /^sentences?$/.test(english)) return 'sentence'
  if (/短语|搭配/.test(text) || /^(phrases?|collocations?)$/.test(english)) return 'phrase'
  if (/单词|词汇/.test(text) || /^(words?|vocabulary)$/.test(english)) return 'word'
  return null
}

function h1Type(category: CategoryName): EntryType | null {
  if (category === 'words') return 'word'
  if (category === 'collocations') return 'phrase'
  if (category === 'sentences') return 'sentence'
  return null
}

/** 把例句列表拆开；支持 <br>、换行、` / ` 和中文分号。 */
export function splitExamples(value: string): string[] {
  const seen = new Set<string>()
  const examples: string[] = []
  for (const raw of value.split(/<br\s*\/?>|\n|\s+\/\s+|[；;]/i)) {
    const example = cleanInline(raw)
    if (!example || seen.has(example)) continue
    seen.add(example)
    examples.push(example)
  }
  return examples
}

/** 标签用逗号、分号或斜杠分隔。 */
export function splitTags(value: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const part of value.split(/[,，;；/]/)) {
    const tag = cleanInline(part)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
  }
  return tags
}

/* ------------------------------------------------------------------ */
/* 具名表格列                                                          */
/* ------------------------------------------------------------------ */

const HEADER_ALIASES: Array<{ field: FieldKey; pattern: RegExp }> = [
  {
    field: 'englishDefinition',
    pattern:
      /^(english\s*definition|definition|engdef|英英释义|英文释义|英文解释|英文含义|英语释义)$/i,
  },
  { field: 'examples', pattern: /^(examples?|例句|例子|示例)$/i },
  { field: 'explanation', pattern: /^(explanation|supplement|解释|说明|补充)$/i },
  { field: 'notes', pattern: /^(notes?|笔记|备注)$/i },
  { field: 'phonetic', pattern: /^(phonetic|ipa|音标|发音)$/i },
  { field: 'tags', pattern: /^(tags?|标签|分类)$/i },
  { field: 'meaning', pattern: /^(meaning|chinese|含义|中文|中文释义|释义|意思)$/i },
  {
    field: 'text',
    pattern: /^(english|word|phrase|sentence|text|content|英文|单词|短语|句子|词条|内容)$/i,
  },
]

function tableField(header: string): FieldKey | null {
  const text = header.trim().replace(/[*_`]/g, '')
  if (!text) return null
  return HEADER_ALIASES.find((alias) => alias.pattern.test(text))?.field ?? null
}

/** 续行标签，例如「英英释义：...」「例句: ...」。 */
function continuationField(label: string): FieldKey | null {
  const text = label.trim().replace(/[*_`]/g, '')
  return tableField(text)
}

function appendText(current: string | null, value: string): string {
  const clean = value.trim()
  if (!clean) return current ?? ''
  return current ? `${current}\n${clean}` : clean
}

/* ------------------------------------------------------------------ */
/* 解析                                                                 */
/* ------------------------------------------------------------------ */

/**
 * 解析约定格式的 Markdown 笔记：
 *
 * - `# words` / `# collocations` / `# sentences`：H1 决定类型，一行一个词条。
 * - `# Scenery`：H2 = 场景名；H3 = 场景片段（可选）；H4 = 单词/短语/句子分类。
 *   旧格式的 `### 单词` 仍然兼容。
 * - 表格支持具名列，也兼容旧的 English | 含义 | 补充 三列。
 * - 缩进标签续行（英英释义 / 例句 / ...）可以给上一条词条补充字段；`>` 续行补充例句。
 */
export function parseMarkdownNotes(markdown: string): ParsedMarkdown {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const items: ParsedImportItem[] = []
  const warnings: string[] = []
  const warnedCategories = new Set<string>()
  let warnedMissingScene = false
  let warnedContinuation = false

  let h1 = ''
  let h2 = ''
  let h3 = ''
  let h4 = ''
  let inFence = false
  let lastItems: ParsedImportItem[] = []

  const category = () => normalizeCategory(h1)

  const headingType = (): EntryType | null =>
    sceneTypeFromHeading(h4) ?? sceneTypeFromHeading(h3)

  const resolveType = (text: string, bullet: boolean): EntryType => {
    if (category() === 'scenery') {
      if (bullet) return 'sentence'
      return headingType() ?? detectType(text)
    }
    return h1Type(category()) ?? detectType(text)
  }

  const addContent = (raw: string, options: AddOptions = {}) => {
    let text = stripQuotes(cleanInline(raw))
    if (!text) return

    let meaning = options.meaning ?? null
    let englishDefinition = options.englishDefinition ?? null
    let explanation = options.explanation ?? null
    if (!options.explicit) {
      const parsed = splitExplanation(text)
      text = parsed.text
      meaning = parsed.meaning
      explanation = parsed.explanation
    }
    if (!text) return

    const isScene = category() === 'scenery'
    const isBullet = options.bullet === true
    const explicitWord = category() === 'words' || (isScene && !isBullet && headingType() === 'word')
    const alternatives = explicitWord ? splitWordAlternatives(text) : [text]

    if (isScene && !h2.trim() && !warnedMissingScene) {
      warnedMissingScene = true
      warnings.push('Scenery 下有没有写到 ## 场景名的内容，已归入「未命名场景」。')
    }

    const scene = isScene ? h2.trim() || '未命名场景' : null
    const group = isScene
      ? null
      : [h2, h3]
          .map((part) => part.trim())
          .filter(Boolean)
          .join(' / ') || null
    const tags = isScene
      ? []
      : [h2, h3]
          .map((part) => part.trim())
          .filter(Boolean)
          .slice(0, 4)
    const explicitTags = options.tags ?? []
    const mergedTags = [...new Set([...explicitTags, ...tags])]

    const created: ParsedImportItem[] = []
    for (const value of alternatives) {
      const type = resolveType(value, isBullet)
      const item: ParsedImportItem = {
        type,
        text: value,
        meaning,
        englishDefinition,
        explanation,
        examples: options.examples ? [...options.examples] : [],
        notes: options.notes ?? null,
        tags: [...mergedTags],
        phonetic: options.phonetic ?? null,
        category: h1.trim() || '未分类',
        group,
        scene,
        section: isScene ? h3.trim() || ENTRY_TYPE_LABELS[type] : null,
        subsection: isScene ? h4.trim() || null : null,
        reviewEnabled: !isScene,
      }
      items.push(item)
      created.push(item)
    }
    lastItems = created
  }

  const attachContinuation = (field: FieldKey, value: string) => {
    const clean = value.trim()
    if (!clean) return
    for (const item of lastItems) {
      if (field === 'text') continue
      if (field === 'meaning') item.meaning = appendText(item.meaning, clean)
      else if (field === 'englishDefinition') {
        item.englishDefinition = appendText(item.englishDefinition, clean)
      } else if (field === 'explanation') {
        item.explanation = appendText(item.explanation, clean)
      } else if (field === 'notes') item.notes = appendText(item.notes, clean)
      else if (field === 'phonetic') item.phonetic = appendText(item.phonetic, clean)
      else if (field === 'examples') {
        for (const example of splitExamples(clean)) {
          if (!item.examples.includes(example)) item.examples.push(example)
        }
      } else if (field === 'tags') {
        for (const tag of splitTags(clean)) {
          if (!item.tags.includes(tag)) item.tags.push(tag)
        }
      }
    }
  }

  const addTableRow = (rowLine: string, fields: Array<{ field: FieldKey; value: string }>) => {
    const first = fields.find((entry) => entry.field === 'text')?.value ?? ''
    if (!first.trim()) {
      warnings.push(`跳过无法解析的表格行：${rowLine.slice(0, 80)}`)
      return
    }

    const options: AddOptions = { explicit: true }
    for (const { field, value } of fields) {
      if (field === 'text' || !value.trim()) continue
      if (field === 'meaning') options.meaning = value.trim()
      else if (field === 'englishDefinition') options.englishDefinition = value.trim()
      else if (field === 'explanation') options.explanation = value.trim()
      else if (field === 'notes') options.notes = value.trim()
      else if (field === 'phonetic') options.phonetic = value.trim()
      else if (field === 'examples') options.examples = splitExamples(value)
      else if (field === 'tags') options.tags = splitTags(value)
    }
    addContent(first, options)
  }

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i]
    const line = rawLine.trim()

    if (line.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence || !line) continue
    if (/^([-*_])\1{2,}$/.test(line)) continue

    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      const depth = heading[1].length
      const title = cleanInline(heading[2])
      if (depth === 1) {
        h1 = title
        h2 = ''
        h3 = ''
        h4 = ''
        const categoryName = normalizeCategory(h1)
        if (categoryName === 'other' && h1 && !warnedCategories.has(h1)) {
          warnedCategories.add(h1)
          warnings.push(`未识别的分类「${h1}」，已按内容自动判断词条类型。`)
        }
      } else if (depth === 2) {
        h2 = title
        h3 = ''
        h4 = ''
      } else if (depth === 3) {
        h3 = title
        h4 = ''
      } else if (depth === 4) {
        h4 = title
      }
      // H5 及更深不参与解析。
      lastItems = []
      continue
    }

    // 缩进标签续行：给上一条词条补字段。
    const continuation = /^(?:\t+| {2,})([^:：]{1,24})\s*[:：]\s*(.+)$/.exec(rawLine)
    if (continuation) {
      const field = continuationField(continuation[1])
      if (field) {
        if (!lastItems.length) {
          if (!warnedContinuation) {
            warnedContinuation = true
            warnings.push(
              '有一行缩进字段（例如「例句：...」）前面没有可附加的词条，已跳过。请把它写在词条下一行。',
            )
          }
          continue
        }
        attachContinuation(field, continuation[2])
        continue
      }
    }

    // 「> ...」续行：作为上一条词条的例句。
    const quote = /^>\s*(.+)$/.exec(rawLine)
    if (quote && lastItems.length) {
      attachContinuation('examples', cleanInline(quote[1]))
      continue
    }

    // Markdown 表格：当前行是表头，下一行是分隔行。
    if (line.includes('|') && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      const header = splitRow(line)
      const mapped = header.map((cell) => ({ header: cell, field: tableField(cell) }))
      const recognized = mapped.filter((value) => value.field)
      const useNames = recognized.length > 0

      if (!useNames) {
        warnings.push(
          `表格「${header.join(' / ')}」的表头未识别，已按 English | 含义 | 补充 三列解析。`,
        )
      } else {
        const unknown = mapped
          .filter((value) => !value.field && value.header.trim())
          .map((value) => value.header)
        if (unknown.length) {
          warnings.push(`表格中未识别的列已忽略：${unknown.join(' / ')}。`)
        }
      }

      i += 2
      let rowCount = 0
      while (i < lines.length) {
        const row = lines[i].trim()
        if (!row || !row.includes('|') || /^#{1,6}\s/.test(row)) break
        const cells = splitRow(row)
        if (!cells.some(Boolean)) break

        if (useNames) {
          const fields = mapped
            .map(({ field }, index) => ({ field, value: cells[index] ?? '' }))
            .filter((value): value is { field: FieldKey; value: string } => Boolean(value.field))
          if (!fields.some((value) => value.field === 'text')) {
            fields.unshift({ field: 'text', value: cells[0] ?? '' })
          }
          addTableRow(row, fields)
        } else {
          addTableRow(row, [
            { field: 'text', value: cells[0] ?? '' },
            { field: 'meaning', value: cells[1] ?? '' },
            { field: 'explanation', value: cells[2] ?? '' },
          ])
        }
        rowCount += 1
        i += 1
      }
      if (!rowCount) warnings.push(`表格「${header.join(' / ')}」没有数据行。`)
      i -= 1
      continue
    }

    const bullet = /^(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line)
    if (bullet) {
      addContent(bullet[1].trim(), { bullet: true })
      continue
    }

    addContent(line)
  }

  if (!items.length) {
    warnings.push(
      '没有识别到可导入的内容。请确认文档使用 # words / # collocations / # sentences / # Scenery，并用普通行、列表或表格记录内容。',
    )
  }

  return { items, warnings }
}
