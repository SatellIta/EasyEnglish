import type {
  AnkiFieldInfo,
  AnkiFieldMapping,
  AnkiMappedSample,
  AnkiMediaMode,
  EntryInput,
  EntryType,
} from '../../../shared/types'
import { MediaStore } from './media-store'

const FIELD_LIMITS = {
  text: 2000,
  meaning: 4000,
  explanation: 8000,
  englishDefinition: 8000,
  notes: 8000,
  phonetic: 200,
  examples: 12,
  exampleLength: 1000,
  tags: 50,
  tagLength: 50,
  images: 10,
}

const TEXT_NAMES = [
  'front',
  'word',
  'expression',
  'question',
  'sentence',
  'text',
  '单词',
  '英文',
  '原文',
  '句子',
]
const MEANING_NAMES = [
  '基本释义',
  '释义',
  '中文',
  'meaning',
  'translation',
  'definition_cn',
  '翻译',
  '答案',
  'back',
]
const ENGLISH_DEFINITION_NAMES = [
  '英英释义',
  '英文释义',
  'english definition',
  'definition_en',
  'definition',
]
const PHONETIC_NAMES = ['音标', 'phonetic', 'pronunciation', 'ipa']
const IMAGE_NAMES = ['图片', 'image', 'picture', 'img']
const EXAMPLE_NAMES = ['例句', 'example', 'examples', 'example sentence']
const COLLINS_NAMES = ['柯林斯', 'collins']
const NOTES_NAMES = ['笔记', 'notes', 'note', 'extra']
const EXPLANATION_NAMES = ['易混', '说明', '解释', 'explanation', '用法']
const TAG_FIELD_NAMES = ['考纲', '考试', 'exam', 'tags', 'tag']

const ENTITY_MAP: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&ldquo;': '“',
  '&rdquo;': '”',
  '&middot;': '·',
  '&times;': '×',
  '&rarr;': '→',
  '&larr;': '←',
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ''
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ''
    })
    .replace(/&[a-z]+;/gi, (entity) => ENTITY_MAP[entity.toLowerCase()] ?? entity)
}

/** 去掉 Anki 字段里的 HTML / cloze / 媒体标记，保留可读文本和图片引用。 */
export function cleanAnkiHtml(
  html: string,
  mediaMode: AnkiMediaMode = 'placeholder',
): { text: string; images: string[] } {
  if (!html) return { text: '', images: [] }
  let value = html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  const images: string[] = []
  value = value.replace(/<img\b[^>]*>/gi, (tag) => {
    const match = tag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
    const src = (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim()
    if (src) images.push(decodeEntities(src))
    return ''
  })

  value = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|section)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<hr\b[^>]*>/gi, '\n---\n')
    .replace(/<td\b[^>]*>/gi, ' | ')
    .replace(/\[sound:[^\]]*\]/gi, mediaMode === 'placeholder' ? '' : '')
    .replace(/<[^>]+>/g, '')

  // cloze: {{c1::answer::hint}} -> answer
  for (let i = 0; i < 5; i += 1) {
    const next = value.replace(/\{\{c\d+::([\s\S]*?)(?:::([\s\S]*?))?\}\}/gi, '$1')
    if (next === value) break
    value = next
  }
  value = value.replace(/\{\{[\s\S]*?\}\}/g, '')

  const text = decodeEntities(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text, images }
}

/** 从柯林斯字段的 HTML 中提取「英文例句 — 中文翻译」。 */
export function extractCollinsExamples(html: string): string[] {
  const paragraphs: string[] = []
  const regex = /<p\b[^>]*class\s*=\s*["'][^"']*secondary[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) !== null) {
    const text = cleanAnkiHtml(match[1]).text
    if (text && !/^例[：:]?$/.test(text)) paragraphs.push(text)
  }

  const examples: string[] = []
  const paired: string[] = []
  for (let index = 0; index < paragraphs.length; index += 1) {
    const current = paragraphs[index]
    const next = paragraphs[index + 1]
    if (next && /[㐀-鿿]/.test(next) && !/[㐀-鿿]/.test(current)) {
      paired.push(`${current} — ${next}`)
      index += 1
    } else {
      examples.push(current)
    }
    if (paired.length >= FIELD_LIMITS.examples) break
  }
  return (paired.length >= 3 ? paired : [...paired, ...examples]).slice(0, FIELD_LIMITS.examples)
}

export function inferEntryType(text: string, isCloze = false): EntryType {
  const compact = text.trim()
  if (!compact) return 'word'
  if (isCloze || /[.!?。！？]$/.test(compact) || compact.split(/\s+/).length > 4) {
    return 'sentence'
  }
  return compact.split(/\s+/).length > 1 ? 'phrase' : 'word'
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

function pickField(
  fields: AnkiFieldInfo[],
  names: string[],
  used: Set<number>,
): number | null {
  const wanted = names.map(normalizeName)
  for (const field of fields) {
    const name = normalizeName(field.name)
    if (wanted.includes(name) && !used.has(field.ord)) return field.ord
  }
  for (const field of fields) {
    const name = normalizeName(field.name)
    if (!used.has(field.ord) && wanted.some((item) => name.includes(item))) return field.ord
  }
  return null
}

function pickFields(fields: AnkiFieldInfo[], names: string[], used: Set<number>): number[] {
  const wanted = names.map(normalizeName)
  const result: number[] = []
  for (const field of fields) {
    const name = normalizeName(field.name)
    if (used.has(field.ord)) continue
    if (wanted.some((item) => name === item || name.includes(item))) {
      result.push(field.ord)
      used.add(field.ord)
    }
  }
  return result
}

/** 按字段名自动推断映射；用户可以在导入预览里覆盖。 */
export function autoMapFields(fields: AnkiFieldInfo[]): AnkiFieldMapping {
  const sorted = [...fields].sort((a, b) => a.ord - b.ord)
  const used = new Set<number>()

  let text = pickField(sorted, TEXT_NAMES, used)
  if (text === null) {
    text = sorted[0]?.ord ?? 0
  }
  used.add(text)

  let meaning = pickField(sorted, MEANING_NAMES, used)
  if (meaning === null) {
    const fallback = sorted.find((field) => !used.has(field.ord))
    meaning = fallback ? fallback.ord : null
  }
  if (meaning !== null) used.add(meaning)

  const englishDefinition = pickField(sorted, ENGLISH_DEFINITION_NAMES, used)
  if (englishDefinition !== null) used.add(englishDefinition)

  const phonetic = pickField(sorted, PHONETIC_NAMES, used)
  if (phonetic !== null) used.add(phonetic)

  const image = pickField(sorted, IMAGE_NAMES, used)
  if (image !== null) used.add(image)

  const examples = [
    ...pickFields(sorted, EXAMPLE_NAMES, used),
    ...pickFields(sorted, COLLINS_NAMES, used),
  ]
  const notes = pickFields(sorted, NOTES_NAMES, used)
  const explanation = pickFields(sorted, EXPLANATION_NAMES, used)
  const tagFields = pickFields(sorted, TAG_FIELD_NAMES, used)

  return {
    text,
    meaning,
    englishDefinition,
    phonetic,
    image,
    examples,
    explanation,
    notes,
    tagFields,
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

function normalizeTag(value: string): string {
  return truncate(value.trim().replace(/\s+/g, ' '), FIELD_LIMITS.tagLength)
}

export interface AnkiNoteForMap {
  row: number
  guid: string
  mid: number
  tags: string[]
  fields: string[]
  deck: string | null
}

export interface MapNoteOptions {
  mapping: AnkiFieldMapping
  fieldNames: string[]
  isCloze: boolean
  useAnkiTags: boolean
  addDeckTag: boolean
  mediaMode: AnkiMediaMode
  mediaStore: MediaStore | null
}

export interface MappedAnkiNote {
  row: number
  externalId: string
  input: EntryInput
  imageRefs: string[]
}

export function mapAnkiNote(
  note: AnkiNoteForMap,
  options: MapNoteOptions,
): MappedAnkiNote | null {
  const { mapping } = options
  const cleaned = note.fields.map((value) => cleanAnkiHtml(value, options.mediaMode))

  const fieldText = (index: number | null): string => {
    if (index === null || index < 0 || index >= cleaned.length) return ''
    return cleaned[index].text
  }
  const rawField = (index: number | null): string => {
    if (index === null || index < 0 || index >= note.fields.length) return ''
    return note.fields[index]
  }

  const text = truncate(fieldText(mapping.text), FIELD_LIMITS.text)
  if (!text) return null

  const used = new Set<number>()
  const add = (index: number | null) => {
    if (index !== null) used.add(index)
  }
  add(mapping.text)
  add(mapping.meaning)
  add(mapping.englishDefinition)
  add(mapping.phonetic)
  add(mapping.image)
  for (const index of [
    ...mapping.examples,
    ...mapping.explanation,
    ...mapping.notes,
    ...mapping.tagFields,
  ]) {
    used.add(index)
  }

  const imageRefs: string[] = []
  const pushImages = (refs: string[]) => {
    for (const ref of refs) {
      if (!imageRefs.includes(ref)) imageRefs.push(ref)
    }
  }
  if (mapping.image !== null) pushImages(cleaned[mapping.image]?.images ?? [])
  for (const field of cleaned) pushImages(field.images)

  const images: string[] = []
  if (options.mediaStore && options.mediaMode === 'placeholder') {
    for (const ref of imageRefs.slice(0, FIELD_LIMITS.images)) {
      const url = options.mediaStore.resolve(ref)
      if (url && !images.includes(url)) images.push(url)
    }
  }

  const meaning = fieldText(mapping.meaning) || null
  let englishDefinition = fieldText(mapping.englishDefinition) || null
  if (englishDefinition) {
    englishDefinition = truncate(
      englishDefinition
        .replace(/\s*\n+\s*/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+-\s+(?=(?:\d+\.|[a-z]{1,5}\.)\s)/gi, ' ')
        .replace(/^-\s+/, '')
        .replace(/(?:同义词|近义词)[：:]\s*/g, 'Synonyms: ')
        .replace(/以上来源于[:：]\s*WordNet/gi, 'Source: WordNet')
        .trim(),
      FIELD_LIMITS.englishDefinition,
    )
  }
  const phonetic = truncate(fieldText(mapping.phonetic), FIELD_LIMITS.phonetic) || null

  const exampleValues: string[] = []
  for (const index of mapping.examples) {
    const name = options.fieldNames[index] ?? ''
    if (COLLINS_NAMES.some((item) => name.toLowerCase().includes(item))) {
      exampleValues.push(...extractCollinsExamples(rawField(index)))
    } else {
      const value = fieldText(index)
      exampleValues.push(
        ...value
          .split(/\n+/)
          .map((line) => line.replace(/^[-•]\s*/, '').trim())
          .filter(Boolean),
      )
    }
  }
  const examples: string[] = []
  const seenExamples = new Set<string>()
  for (const example of exampleValues) {
    const value = truncate(example, FIELD_LIMITS.exampleLength)
    const key = value.toLowerCase()
    if (!value || seenExamples.has(key)) continue
    seenExamples.add(key)
    examples.push(value)
    if (examples.length >= FIELD_LIMITS.examples) break
  }

  const explanationParts: string[] = []
  for (const index of mapping.explanation) {
    const value = fieldText(index)
    if (value) explanationParts.push(value)
  }
  for (let index = 0; index < note.fields.length; index += 1) {
    if (used.has(index)) continue
    const value = fieldText(index)
    if (!value) continue
    const name = options.fieldNames[index]?.trim()
    explanationParts.push(name ? `${name}: ${value}` : value)
  }
  const explanation = truncate(explanationParts.join('\n\n'), FIELD_LIMITS.explanation) || null

  const notesParts = mapping.notes.map((index) => fieldText(index)).filter(Boolean)
  const notes = truncate(notesParts.join('\n\n'), FIELD_LIMITS.notes) || null

  const tags: string[] = []
  if (options.useAnkiTags) {
    for (const tag of note.tags) {
      const value = normalizeTag(tag)
      if (value && !tags.includes(value)) tags.push(value)
    }
    for (const index of mapping.tagFields) {
      for (const part of fieldText(index).split(/[\s,，;；]+/)) {
        const value = normalizeTag(part)
        if (value && !tags.includes(value)) tags.push(value)
      }
    }
  }
  if (options.addDeckTag && note.deck) {
    const value = normalizeTag(note.deck.replace(/\x1f/g, '::'))
    if (value && !tags.includes(value)) tags.push(value)
  }

  return {
    row: note.row,
    externalId: note.guid,
    imageRefs,
    input: {
      type: inferEntryType(text, options.isCloze),
      text,
      meaning,
      explanation,
      examples,
      notes,
      tags: tags.slice(0, FIELD_LIMITS.tags),
      phonetic,
      englishDefinition,
      images: images.slice(0, FIELD_LIMITS.images),
    },
  }
}

/** 预览时展示的一条映射结果。 */
export function mapSample(
  note: AnkiNoteForMap,
  options: MapNoteOptions,
  mapped: MappedAnkiNote | null,
): AnkiMappedSample {
  if (!mapped) {
    return {
      text: '',
      meaning: null,
      englishDefinition: null,
      phonetic: null,
      images: [],
      examples: [],
      explanation: null,
      notes: null,
      tags: note.tags,
      type: 'word',
    }
  }
  return {
    text: mapped.input.text,
    meaning: mapped.input.meaning ?? null,
    englishDefinition: mapped.input.englishDefinition ?? null,
    phonetic: mapped.input.phonetic ?? null,
    images: mapped.input.images ?? [],
    examples: mapped.input.examples ?? [],
    explanation: mapped.input.explanation ?? null,
    notes: mapped.input.notes ?? null,
    tags: mapped.input.tags ?? [],
    type: mapped.input.type,
  }
}
