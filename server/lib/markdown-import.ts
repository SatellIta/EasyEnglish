import type { EntryType } from '../../shared/types'
import { ENTRY_TYPE_LABELS } from '../../shared/types'

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
  /** 场景中 - 开头的行按句子处理 */
  bullet?: boolean
}

const CJK = /[㐀-鿿]/

function stripQuotes(value: string): string {
  return value.replace(/^["“”'‘’]+/, '').replace(/["“”'‘’]+$/, '').trim()
}

function cleanInline(value: string): string {
  return value
    .replace(/^>\s?/, '')
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
 * 表格行不走这里，直接使用第一/二/三列。
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
 * 仅用于明确是单词的目录（# words / 场景 ### 单词）。
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

/** Scenery 下 H3 的分类：单词 / 短语 / 句子。 */
function sceneTypeFromHeading(value: string): EntryType | null {
  const text = value.trim().toLowerCase().replace(/[*_`]/g, '')
  if (/句子/.test(text) || /\bsentences?\b/.test(text)) return 'sentence'
  if (/短语|搭配/.test(text) || /\b(phrases?|collocations?)\b/.test(text)) return 'phrase'
  if (/单词|词汇/.test(text) || /\b(words?|vocabulary)\b/.test(text)) return 'word'
  return null
}

function h1Type(category: CategoryName): EntryType | null {
  if (category === 'words') return 'word'
  if (category === 'collocations') return 'phrase'
  if (category === 'sentences') return 'sentence'
  return null
}

/**
 * 解析约定格式的 Markdown 笔记：
 *
 * - `# words` / `# collocations` / `# sentences`：H1 决定类型，一行一个词条。
 * - `# Scenery`：H2 = 场景名，H3 = 单词/短语/句子分类；
 *   普通行按 H3 类型，`-` 开头的行一律按句子。
 * - 表格：第一列英文，第二列含义，第三列补充；第四列及以后忽略。
 * - 非场景分类的 H2/H3 作为标签和预览分组保留。
 */
export function parseMarkdownNotes(markdown: string): ParsedMarkdown {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const items: ParsedImportItem[] = []
  const warnings: string[] = []
  const warnedCategories = new Set<string>()
  const warnedSceneSections = new Set<string>()
  let warnedMissingScene = false

  let h1 = ''
  let h2 = ''
  let h3 = ''
  let inFence = false

  const category = () => normalizeCategory(h1)

  const warnSceneType = () => {
    if (category() !== 'scenery') return
    if (sceneTypeFromHeading(h3)) return
    const key = `${h2}::${h3}`
    if (warnedSceneSections.has(key)) return
    warnedSceneSections.add(key)
    warnings.push(
      `场景「${h2.trim() || '未命名场景'}」下的「${h3.trim() || '未指定分类'}」不是可识别的分类；已按内容自动判断。建议使用 ### 单词 / ### 短语 / ### 句子。`,
    )
  }

  const resolveType = (text: string, bullet: boolean): EntryType => {
    if (category() === 'scenery') {
      if (bullet) return 'sentence'
      const mode = sceneTypeFromHeading(h3)
      if (mode) return mode
      warnSceneType()
      return detectType(text)
    }
    return h1Type(category()) ?? detectType(text)
  }

  const addContent = (raw: string, options: AddOptions = {}) => {
    let text = stripQuotes(cleanInline(raw))
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

    const isScene = category() === 'scenery'
    const isBullet = options.bullet === true
    const explicitWord =
      category() === 'words' ||
      (isScene && !isBullet && sceneTypeFromHeading(h3) === 'word')
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

    for (const value of alternatives) {
      const type = resolveType(value, isBullet)
      items.push({
        type,
        text: value,
        meaning,
        explanation,
        examples: [],
        notes: null,
        tags,
        category: h1.trim() || '未分类',
        group,
        scene,
        section: isScene ? ENTRY_TYPE_LABELS[type] : null,
        subsection: null,
        reviewEnabled: !isScene,
      })
    }
  }

  const addTableRow = (rowLine: string) => {
    const cells = splitRow(rowLine)
    if (!cells.some(Boolean)) return

    const text = cells[0] ?? ''
    if (!text.trim()) {
      warnings.push(`跳过无法解析的表格行：${rowLine.slice(0, 80)}`)
      return
    }

    addContent(text, {
      meaning: cells[1]?.trim() || null,
      explanation: cells[2]?.trim() || null,
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
        const categoryName = normalizeCategory(h1)
        if (
          categoryName === 'other' &&
          h1 &&
          !warnedCategories.has(h1)
        ) {
          warnedCategories.add(h1)
          warnings.push(`未识别的分类「${h1}」，已按内容自动判断词条类型。`)
        }
      } else if (depth === 2) {
        h2 = title
        h3 = ''
      } else if (depth === 3) {
        h3 = title
      }
      // H4 及更深不参与解析。
      continue
    }

    // Markdown 表格：当前行是表头，下一行是分隔行。
    if (line.includes('|') && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      const header = splitRow(line)
      i += 2
      let rowCount = 0
      let warnedColumns = false
      while (i < lines.length) {
        const row = lines[i].trim()
        if (!row || !row.includes('|') || /^#{1,6}\s/.test(row)) break
        const cells = splitRow(row)
        if (!warnedColumns && cells.length > 3) {
          warnedColumns = true
          warnings.push(
            `表格「${header.join(' / ')}」超过 3 列，第 4 列及以后已忽略。`,
          )
        }
        addTableRow(row)
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
