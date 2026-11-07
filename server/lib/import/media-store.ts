import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import type { ZipEntry } from './zip'
import { readZipEntry } from './zip'

const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_TOTAL_BYTES = 150 * 1024 * 1024
const ALLOWED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.avif',
])

export const MEDIA_DIR = resolve(process.cwd(), 'data/media')

export function mediaUrl(name: string): string {
  return `/api/media/${name}`
}

interface MediaStoreOptions {
  /** 原始文件名 → ZIP 成员名，来自包里的 media JSON */
  mediaMap: Map<string, string>
  /** 关闭后不提取图片，只清洗文本 */
  enabled: boolean
}

export class MediaStore {
  private readonly byOriginalName: Map<string, string>
  private readonly byMemberName = new Map<string, ZipEntry>()
  private readonly cache = new Map<string, string | null>()
  private readonly enabled: boolean
  private totalBytes = 0
  private written = 0
  private failed = 0

  constructor(
    private readonly zipBuffer: Buffer,
    zipEntries: ZipEntry[],
    options: MediaStoreOptions,
  ) {
    this.byOriginalName = options.mediaMap
    this.enabled = options.enabled
    for (const entry of zipEntries) {
      if (!entry.isDirectory) this.byMemberName.set(entry.name, entry)
    }
  }

  get imageCount(): number {
    return this.written
  }

  get failedCount(): number {
    return this.failed
  }

  resolve(ref: string): string | null {
    const key = normalizeRef(ref)
    if (!key) return null
    if (this.cache.has(key)) return this.cache.get(key) ?? null

    const member =
      this.byOriginalName.get(key) ??
      this.byOriginalName.get(basename(key)) ??
      (this.byMemberName.has(key) ? key : null)
    if (!member) {
      this.cache.set(key, null)
      this.failed += 1
      return null
    }
    if (!this.enabled) {
      this.cache.set(key, null)
      return null
    }

    const entry = this.byMemberName.get(member)
    if (!entry) {
      this.cache.set(key, null)
      this.failed += 1
      return null
    }

    const ext = extname(key).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(ext) || entry.size > MAX_FILE_BYTES) {
      this.cache.set(key, null)
      this.failed += 1
      return null
    }
    if (this.totalBytes + entry.size > MAX_TOTAL_BYTES) {
      this.cache.set(key, null)
      this.failed += 1
      return null
    }

    try {
      const data = readZipEntry(this.zipBuffer, entry, MAX_FILE_BYTES)
      const hash = createHash('sha256').update(data).digest('hex').slice(0, 16)
      const fileName = `${hash}${ext}`
      const target = join(MEDIA_DIR, fileName)
      if (!existsSync(target)) {
        mkdirSync(MEDIA_DIR, { recursive: true })
        writeFileSync(target, data)
      }
      this.totalBytes += data.byteLength
      this.written += 1
      const url = mediaUrl(fileName)
      this.cache.set(key, url)
      return url
    } catch {
      this.cache.set(key, null)
      this.failed += 1
      return null
    }
  }
}

function normalizeRef(ref: string): string {
  let value = ref.trim()
  if (!value) return ''
  if (value.startsWith('data:')) return ''
  try {
    value = decodeURIComponent(value)
  } catch {
    // keep raw text
  }
  value = value.replace(/^\.\//, '').replace(/^\/+/, '')
  return value
}

/** 从 Anki 包的 media 成员解析「ZIP 成员名 → 原始文件名」。 */
export function parseMediaMap(raw: Buffer | null): Map<string, string> {
  const result = new Map<string, string>()
  if (!raw) return result
  try {
    const parsed = JSON.parse(raw.toString('utf8')) as Record<string, unknown>
    for (const [member, original] of Object.entries(parsed)) {
      if (typeof original === 'string' && original.trim()) {
        result.set(original.trim(), member)
      }
    }
  } catch {
    // 新版 Anki 的 media 是 protobuf，暂不支持；没有媒体映射时跳过图片。
  }
  return result
}
