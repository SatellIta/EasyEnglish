/**
 * AnkiWeb 共享牌组的只读客户端。
 * AnkiWeb 的 SvelteKit 前端通过 protobuf 二进制接口取数据，这里做最小解码。
 */

export interface AnkiWebDeckRow {
  id: number
  title: string
  thumbsUp: number
  thumbsDown: number
  /** Unix 秒 */
  mtime: number
  notes: number
  audio: number
  images: number
}

export interface AnkiWebDeckInfo {
  id: number
  title: string
  tags: string
  description: string
  /** 字节数；0 表示 AnkiWeb 没有返回大小 */
  size: number
  notes: number
  audio: number
  images: number
  lastUpdated: number
  downloadKey: string
}

export interface DownloadedDeck {
  buffer: Buffer
  fileName: string
}

export class AnkiWebError extends Error {
  status: number
  code?: string

  constructor(message: string, status = 502, code?: string) {
    super(message)
    this.name = 'AnkiWebError'
    this.status = status
    this.code = code
  }
}

const ANKIWEB_BASE = process.env.ANKIWEB_BASE_URL || 'https://ankiweb.net'
const USER_AGENT = 'EasyEnglish/0.1 (local Anki deck importer)'
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])

function readVarint(buffer: Buffer, index: number): [number, number] {
  let shift = 0
  let value = 0
  while (index < buffer.length) {
    const byte = buffer[index]
    index += 1
    value += (byte & 0x7f) * 2 ** shift
    if (!(byte & 0x80)) return [value, index]
    shift += 7
    if (shift > 49) throw new AnkiWebError('AnkiWeb 数据格式不正确')
  }
  throw new AnkiWebError('AnkiWeb 数据格式不正确')
}

interface ProtoField {
  field: number
  value: number | Buffer
}

function parseFields(buffer: Buffer): ProtoField[] {
  const fields: ProtoField[] = []
  let index = 0
  while (index < buffer.length) {
    const [key, next] = readVarint(buffer, index)
    index = next
    const field = key >> 3
    const wire = key & 7
    if (wire === 0) {
      const [value, after] = readVarint(buffer, index)
      index = after
      fields.push({ field, value })
    } else if (wire === 2) {
      const [length, after] = readVarint(buffer, index)
      index = after
      if (index + length > buffer.length) throw new AnkiWebError('AnkiWeb 数据格式不正确')
      fields.push({ field, value: buffer.subarray(index, index + length) })
      index += length
    } else if (wire === 5) {
      index += 4
    } else if (wire === 1) {
      index += 8
    } else {
      throw new AnkiWebError('AnkiWeb 数据格式不正确')
    }
  }
  return fields
}

function numberField(fields: ProtoField[], field: number): number {
  const found = fields.find((item) => item.field === field)
  return found && typeof found.value === 'number' ? found.value : 0
}

function stringField(fields: ProtoField[], field: number): string {
  const found = fields.find((item) => item.field === field)
  return found && Buffer.isBuffer(found.value) ? found.value.toString('utf8') : ''
}

function bufferField(fields: ProtoField[], field: number): Buffer | null {
  const found = fields.find((item) => item.field === field)
  return found && Buffer.isBuffer(found.value) ? found.value : null
}

function decodeDeckRows(buffer: Buffer): AnkiWebDeckRow[] {
  const rows: AnkiWebDeckRow[] = []
  for (const field of parseFields(buffer)) {
    if (field.field !== 1 || !Buffer.isBuffer(field.value)) continue
    const row = parseFields(field.value)
    const id = numberField(row, 1)
    if (!id) continue
    rows.push({
      id,
      title: stringField(row, 2),
      thumbsUp: numberField(row, 3),
      thumbsDown: numberField(row, 4),
      mtime: numberField(row, 5),
      notes: numberField(row, 6),
      audio: numberField(row, 7),
      images: numberField(row, 8),
    })
  }
  return rows
}

function decodeDeckInfo(buffer: Buffer, deckId: number): AnkiWebDeckInfo {
  const outer = parseFields(buffer)
  const available =
    bufferField(outer, 1) ??
    null
  if (!available) {
    if (bufferField(outer, 2)) {
      throw new AnkiWebError('这个共享牌组已被删除', 404, 'missing')
    }
    throw new AnkiWebError('无法访问这个共享牌组', 403, 'access_denied')
  }
  const info = parseFields(available)
  const deck = bufferField(info, 10)
  if (!deck) {
    throw new AnkiWebError('这不是一个可下载的 Anki 牌组', 400, 'not_deck')
  }
  const deckFields = parseFields(deck)
  const downloadKey = stringField(deckFields, 5)
  if (!downloadKey) {
    throw new AnkiWebError('AnkiWeb 没有返回下载凭证，请稍后重试', 502, 'no_key')
  }
  return {
    id: deckId,
    title: stringField(info, 5),
    tags: stringField(info, 6),
    size: numberField(info, 7),
    lastUpdated: numberField(info, 8),
    description: stringField(info, 9),
    notes: numberField(deckFields, 1),
    audio: numberField(deckFields, 2),
    images: numberField(deckFields, 3),
    downloadKey,
  }
}

async function fetchBytes(url: string, timeoutMs: number): Promise<Buffer> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/octet-stream',
        Referer: `${ANKIWEB_BASE}/shared/decks`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw new AnkiWebError('无法连接 AnkiWeb，请检查网络后重试', 502, 'network')
  }
  if (!response.ok) {
    if (response.status === 429) {
      throw new AnkiWebError(
        'AnkiWeb 请求次数过多，请稍后再试。',
        429,
        'rate_limited',
      )
    }
    throw new AnkiWebError(`AnkiWeb 请求失败（${response.status}）`, 502, 'upstream')
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('text/html')) {
    throw new AnkiWebError('AnkiWeb 返回了网页而不是数据，请稍后重试', 502, 'upstream')
  }
  return Buffer.from(await response.arrayBuffer())
}

/** 搜索共享牌组；AnkiWeb 要求 search 非空。 */
export async function fetchSharedDecks(search: string): Promise<AnkiWebDeckRow[]> {
  const url = new URL('/svc/shared/list-decks', ANKIWEB_BASE)
  url.searchParams.set('search', search)
  const buffer = await fetchBytes(url.toString(), 15_000)
  return decodeDeckRows(buffer)
}

export async function fetchSharedDeckInfo(deckId: number): Promise<AnkiWebDeckInfo> {
  const url = new URL('/svc/shared/item-info', ANKIWEB_BASE)
  url.searchParams.set('sharedId', String(deckId))
  const buffer = await fetchBytes(url.toString(), 15_000)
  return decodeDeckInfo(buffer, deckId)
}

function fileNameFromDisposition(value: string | null, deckId: number): string {
  if (!value) return `${deckId}.apkg`
  const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i)
  const plain = value.match(/filename="?([^";]+)"?/i)
  const raw = utf8?.[1] ?? plain?.[1] ?? `${deckId}.apkg`
  try {
    return decodeURIComponent(raw).replace(/[\\/]/g, '_').trim() || `${deckId}.apkg`
  } catch {
    return `${deckId}.apkg`
  }
}

/** 下载 .apkg；AnkiWeb 下载需要 item-info 返回的 downloadKey。 */
export async function downloadSharedDeck(
  deckId: number,
  downloadKey: string,
  maxBytes: number,
): Promise<DownloadedDeck> {
  const url = new URL(`/svc/shared/download-deck/${deckId}`, ANKIWEB_BASE)
  url.searchParams.set('t', downloadKey)

  let response: Response
  try {
    response = await fetch(url.toString(), {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/octet-stream',
        Referer: `${ANKIWEB_BASE}/shared/info/${deckId}`,
      },
      signal: AbortSignal.timeout(120_000),
    })
  } catch {
    throw new AnkiWebError('下载牌组失败，请检查网络后重试', 502, 'network')
  }
  if (!response.ok) {
    if (response.status === 429) {
      throw new AnkiWebError(
        'AnkiWeb 请求次数过多，请稍后再试。',
        429,
        'rate_limited',
      )
    }
    throw new AnkiWebError(`下载牌组失败（${response.status}）`, 502, 'upstream')
  }

  const fileName = fileNameFromDisposition(
    response.headers.get('content-disposition'),
    deckId,
  )
  // AnkiWeb 共享牌组只提供 .apkg；明确拒绝其他格式。
  if (!fileName.toLowerCase().endsWith('.apkg')) {
    throw new AnkiWebError('只支持导入 .apkg 格式的共享牌组', 400, 'not_apkg')
  }

  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength > maxBytes) {
    throw new AnkiWebError('牌组超过 200MB，暂不支持下载导入', 413, 'too_large')
  }

  const reader = response.body?.getReader()
  if (!reader) throw new AnkiWebError('无法读取下载内容', 502, 'upstream')
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        throw new AnkiWebError('牌组超过 200MB，暂不支持下载导入', 413, 'too_large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const buffer = Buffer.concat(chunks, total)
  if (buffer.length < 4 || !buffer.subarray(0, 4).equals(ZIP_MAGIC)) {
    throw new AnkiWebError('下载到的文件不是有效的 Anki 牌组', 400, 'invalid')
  }
  return { buffer, fileName }
}
