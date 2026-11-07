import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, resolve } from 'node:path'
import { deleteSetting, getSetting, setSetting } from './settings'

const KEY = 'markdown.syncPath'
const MAX_BYTES = 2_000_000
const ALLOWED_EXTENSIONS = new Set(['.md', '.markdown', '.txt'])

export function expandHomePath(input: string): string {
  const text = input.trim()
  if (text === '~') return homedir()
  if (text.startsWith('~/') || text.startsWith('~\\')) {
    return resolve(homedir(), text.slice(2))
  }
  return resolve(text)
}

export function getMarkdownSyncPath(): string | null {
  return getSetting(KEY)
}

/** 保存同步路径；返回解析后的绝对路径，空字符串表示清除。 */
export function saveMarkdownSyncPath(input: string | null | undefined): string | null {
  const raw = input?.trim() ?? ''
  if (!raw) {
    deleteSetting(KEY)
    return null
  }
  const resolved = expandHomePath(raw)
  if (!ALLOWED_EXTENSIONS.has(extname(resolved).toLowerCase())) {
    throw new Error('Markdown 同步路径必须是 .md / .markdown / .txt 文件')
  }
  setSetting(KEY, resolved)
  return resolved
}

export interface SyncedMarkdownFile {
  path: string
  fileName: string
  markdown: string
}

export async function readMarkdownSyncFile(): Promise<SyncedMarkdownFile> {
  const configured = getMarkdownSyncPath()
  if (!configured) throw new Error('还没有配置 Markdown 同步路径')

  const filePath = expandHomePath(configured)
  if (!ALLOWED_EXTENSIONS.has(extname(filePath).toLowerCase())) {
    throw new Error('Markdown 同步路径必须是 .md / .markdown / .txt 文件')
  }

  let info
  try {
    info = await stat(filePath)
  } catch {
    throw new Error(`找不到 Markdown 同步文件：${filePath}`)
  }
  if (!info.isFile()) throw new Error('Markdown 同步路径不是文件')
  if (info.size > MAX_BYTES) throw new Error('Markdown 文件不能超过 2 MB')

  const markdown = await readFile(filePath, 'utf8')
  return { path: filePath, fileName: basename(filePath), markdown }
}
