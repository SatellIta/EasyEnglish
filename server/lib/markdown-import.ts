import type { EntryType } from '../../shared/types'

export interface ParsedImportItem {
  type: EntryType
  text: string
  meaning: string | null
  explanation: string | null
  examples: string[]
  notes: string | null
  tags: string[]
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

interface AddOptions {
  meaning?: string | null
  explanation?: string | null
  forceType?: EntryType
  forceWord?: boolean
  allowSplit?: boolean
}

const CJK = /[㐀-鿿]/

function stripQuotes(value: string): string {
  return value.replace(/^["“”'‘’]+/, '').replace(/["“”'‘’]+$/, '').trim()
}

function cleanInline(value: string): string {
  return value
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanCell(value: string): string {
  return stripQuotes(cleanInline(value))
}

function prepareContent(value: string): string {
  let text = value.trim()
  text = text.replace(/^>\s?/, '')
  text = text.replace(/^(?:[-*+]|\d+[.)])\s+/, '')
  text = stripQuotes(text)
  return text.trim()
}

function splitRow(line: string): string[] {
  let text = line.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|')) text = text.slice(0, -1)
  return text.split('|').map(cleanCell)
}

function isSeparatorRow(line: string): boolean {
  const cells = splitRow(line)
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.trim()))
}

/** 处理 "She's widowed   widow / widower" 这类用多个空格并列的笔记。 */
function splitLooseSegments(text: string): string[] {
  if (!/\s{2,}/.test(text) || !/\s\/\s/.test(text)) return [text]
  // "Got me! / Beats me!  = I have no idea!" 里的双空格属于释义分隔，
  // 不能把 "= ..." 拆成独立词条。
  if (/[=—–]/.test(text)) return [text]
  const parts = text
    .split(/\s{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.length > 1 ? parts : [text]
}

function splitExplanation(raw: string): {
  text: string
  meaning: string | null
  explanation: string | null
} {
  let text = raw.trim()
  let meaning: string | null = null
  let explanation: string | null = null

  const paren = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(text)
  if (paren && paren[1].trim()) {
    text = paren[1].trim()
    explanation = paren[2].trim() || null
  }

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

  if (rhs) {
    if (CJK.test(rhs)) {
      meaning = rhs
    } else if (!/\s/.test(text) && !/\s/.test(rhs)) {
      // 单词同义词，例如 renovation = decoration
      meaning = rhs
    } else {
      explanation = explanation ? `${explanation}；${rhs}` : rhs
    }
  }

  return { text, meaning, explanation }
}

/** 把 "index finger / middle finger / ..." 拆成多个词条；句子不拆。 */
function splitAlternatives(text: string): string[] {
  if (!/\s\/\s/.test(text)) return [text]
  const parts = text
    .split(/\s+\/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length < 2 || parts.length > 8) return [text]
  if (parts.some((part) => part.split(/\s+/).length > 5)) return [text]
  return parts
}

function detectType(text: string, forceWord = false): EntryType {
  if (forceWord) return 'word'
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

function normalizeCategory(value: string): CategoryName {
  const text = value.trim().toLowerCase().replace(/[*_`]/g, '')
  if (/^(words?|vocabulary|词汇|单词)$/.test(text)) return 'words'
  if (/^(collocations?|phrases?|搭配|短语)$/.test(text)) return 'collocations'
  if (/^(sentences?|句子|expressions?)$/.test(text)) return 'sentences'
  if (/^(scenery|scenes?|场景)$/.test(text)) return 'scenery'
  return 'other'
}

function isVocabularyHeading(value: string): boolean {
  return /\bvocabulary\b|\bwords?\b|词汇|单词/i.test(value.trim())
}

function isLeadIn(line: string): boolean {
  const trimmed = line.trim()
  if (!/[:：]$/.test(trimmed)) return false
  if (/["“”]/.test(trimmed)) return false
  if (trimmed.length > 80) return false
  const words = trimmed.replace(/[:：]$/, '').trim().split(/\s+/)
  return words.length > 0 && words.length <= 10
}

/** 把用户按 H1/H2/H3 组织的 Markdown 笔记解析成候选词条和场景。 */
export function parseMarkdownNotes(markdown: string): ParsedMarkdown {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const items: ParsedImportItem[] = []
  const warnings: string[] = []
  const warnedCategories = new Set<string>()

  let h1 = ''
  let h2 = ''
  let h3 = ''
  let label = ''
  let lead = ''
  let inFence = false

  const addContent = (raw: string, options: AddOptions = {}) => {
    const prepared = prepareContent(raw)
    if (!prepared) return
    for (const segment of splitLooseSegments(prepared)) {
      addSingle(segment, options)
    }
  }

  const addSingle = (raw: string, options: AddOptions) => {
    const categoryName = normalizeCategory(h1)
    const isVocab = isVocabularyHeading(h3) || isVocabularyHeading(h2)
    let text = cleanInline(raw)
    if (!text) return

    let meaning: string | null = options.meaning ?? null
    let explanation: string | null = options.explanation ?? null
    if (options.meaning === undefined && options.explanation === undefined) {
      const parsed = splitExplanation(text)
      text = parsed.text
      meaning = parsed.meaning
      explanation = parsed.explanation
    }
    if (!text) return

    const shouldSplit =
      options.allowSplit !== false &&
      (categoryName === 'words' ||
        categoryName === 'collocations' ||
        (categoryName === 'sentences' && isVocab) ||
        categoryName === 'scenery' ||
        categoryName === 'other')

    const alternatives = shouldSplit ? splitAlternatives(text) : [text]
    for (const alternative of alternatives) {
      const value = alternative.trim()
      if (!value) continue

      let type: EntryType
      if (options.forceType) type = options.forceType
      else if (categoryName === 'words') type = 'word'
      else if (categoryName === 'collocations') type = 'phrase'
      else if (categoryName === 'sentences') type = isVocab ? 'word' : 'sentence'
      else type = detectType(value, options.forceWord === true)

      const scene = categoryName === 'scenery' ? h2.trim() || '未命名场景' : null
      const section = categoryName === 'scenery' ? h3.trim() || null : null
      const subsection =
        categoryName === 'scenery'
          ? [label, lead]
              .map((part) => part.trim())
              .filter(Boolean)
              .join(' · ') || null
          : null
      const group =
        categoryName === 'scenery'
          ? null
          : [h2, h3]
              .map((part) => part.trim())
              .filter(Boolean)
              .join(' / ') || null
      const tags =
        categoryName === 'sentences'
          ? [h2, h3]
              .map((part) => part.trim())
              .filter(Boolean)
              .slice(0, 4)
          : []

      items.push({
        type,
        text: value,
        meaning,
        explanation,
        examples: [],
        notes: categoryName === 'scenery' ? null : lead.trim() || null,
        tags,
        category: h1.trim() || '未分类',
        group,
        scene,
        section,
        subsection,
        reviewEnabled: categoryName !== 'scenery',
      })
    }
  }

  const addTableRow = (rowLine: string, header: string[]) => {
    const cells = splitRow(rowLine)
    if (!cells.some(Boolean)) return

    let text = cells[0] ?? ''
    let meaning = cells[1] ?? ''
    let explanation = cells.slice(2).filter(Boolean).join(' · ')

    // 用户笔记里竖线符号那一行会把 Markdown 表格拆坏，单独兜底。
    if (/vertical bar/i.test(rowLine) && !text.replace(/`/g, '').trim()) {
      text = '|'
      meaning = 'Vertical bar / Pipe'
      explanation = ''
    }

    if (!text.trim()) {
      warnings.push(`跳过无法解析的表格行：${rowLine.slice(0, 80)}`)
      return
    }

    const headerText = header.join(' ').toLowerCase()
    const forceWord = /symbol|符号/.test(headerText) || !/[a-z]/i.test(text)

    addContent(text, {
      meaning: meaning.trim() || null,
      explanation: explanation.trim() || null,
      forceWord,
    })
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
        label = ''
        lead = ''
        if (normalizeCategory(h1) === 'other' && h1 && !warnedCategories.has(h1)) {
          warnings.push(`未识别的分类「${h1}」，已按内容自动判断词条类型。`)
          warnedCategories.add(h1)
        }
      } else if (depth === 2) {
        h2 = title
        h3 = ''
        label = ''
        lead = ''
      } else if (depth === 3) {
        h3 = title
        label = ''
        lead = ''
      } else {
        label = title
        lead = ''
      }
      continue
    }

    // Markdown 表格：当前行是表头，下一行是分隔行。
    if (line.includes('|') && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      const header = splitRow(line)
      i += 2
      let rowCount = 0
      while (i < lines.length) {
        const row = lines[i].trim()
        if (!row || !row.includes('|') || /^#{1,6}\s/.test(row)) break
        addTableRow(row, header)
        rowCount += 1
        i += 1
      }
      if (!rowCount) warnings.push(`表格「${header.join(' / ')}」没有数据行。`)
      i -= 1
      continue
    }

    const bold = /^\*\*(.+?)\*\*:?\s*$/.exec(line)
    if (bold) {
      label = cleanInline(bold[1])
      lead = ''
      continue
    }

    const bullet = /^(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line)
    if (bullet) {
      const content = bullet[1].trim()
      if (!content) continue
      if (isLeadIn(content)) {
        lead = cleanInline(content.replace(/[:：]\s*$/, ''))
        continue
      }
      addContent(content)
      continue
    }

    if (isLeadIn(line)) {
      lead = cleanInline(line.replace(/[:：]\s*$/, ''))
      continue
    }

    addContent(line)
  }

  if (!items.length) {
    warnings.push('没有识别到可导入的内容。请确认文档使用 # / ## / ### 标题，并用普通行或列表记录词条。')
  }

  return { items, warnings }
}
