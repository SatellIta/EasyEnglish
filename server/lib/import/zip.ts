import { inflateRawSync } from 'node:zlib'

/**
 * 只读 ZIP 解析器。Anki 的 .apkg/.colpkg 是普通 ZIP，
 * 只包含 stored/deflate 两种压缩方式；这里不引入第三方依赖。
 */

export interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  size: number
  localHeaderOffset: number
  flags: number
  isDirectory: boolean
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

function readUInt64(buffer: Buffer, offset: number): number {
  const value = buffer.readBigUInt64LE(offset)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('ZIP64 字段超出可处理范围')
  }
  return Number(value)
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22)
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset
  }
  throw new Error('不是有效的 ZIP 文件')
}

function readZip64Extra(
  extra: Buffer,
  needs: { uncompressed: boolean; compressed: boolean; offset: boolean },
): { size?: number; compressedSize?: number; localHeaderOffset?: number } {
  let cursor = 0
  while (cursor + 4 <= extra.length) {
    const id = extra.readUInt16LE(cursor)
    const length = extra.readUInt16LE(cursor + 2)
    const start = cursor + 4
    const end = start + length
    if (end > extra.length) break
    if (id === 0x0001) {
      let at = start
      const result: { size?: number; compressedSize?: number; localHeaderOffset?: number } = {}
      if (needs.uncompressed && at + 8 <= end) {
        result.size = readUInt64(extra, at)
        at += 8
      }
      if (needs.compressed && at + 8 <= end) {
        result.compressedSize = readUInt64(extra, at)
        at += 8
      }
      if (needs.offset && at + 8 <= end) {
        result.localHeaderOffset = readUInt64(extra, at)
        at += 8
      }
      return result
    }
    cursor = end
  }
  return {}
}

export function readZipEntries(buffer: Buffer): ZipEntry[] {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== LOCAL_SIGNATURE) {
    throw new Error('不是有效的 ZIP 文件')
  }
  const eocd = findEndOfCentralDirectory(buffer)
  const totalEntries = buffer.readUInt16LE(eocd + 10)
  const centralOffset = buffer.readUInt32LE(eocd + 16)
  if (centralOffset === 0xffffffff || totalEntries === 0xffff) {
    throw new Error('暂不支持 ZIP64 目录结构')
  }

  const entries: ZipEntry[] = []
  let cursor = centralOffset
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error('ZIP 中央目录损坏')
    }
    const flags = buffer.readUInt16LE(cursor + 8)
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSizeRaw = buffer.readUInt32LE(cursor + 20)
    const sizeRaw = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localHeaderOffsetRaw = buffer.readUInt32LE(cursor + 42)
    const name = buffer
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString(flags & 0x800 ? 'utf8' : 'latin1')
    const extra = buffer.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength)

    let size = sizeRaw
    let compressedSize = compressedSizeRaw
    let localHeaderOffset = localHeaderOffsetRaw
    if (
      sizeRaw === 0xffffffff ||
      compressedSizeRaw === 0xffffffff ||
      localHeaderOffsetRaw === 0xffffffff
    ) {
      const zip64 = readZip64Extra(extra, {
        uncompressed: sizeRaw === 0xffffffff,
        compressed: compressedSizeRaw === 0xffffffff,
        offset: localHeaderOffsetRaw === 0xffffffff,
      })
      size = zip64.size ?? size
      compressedSize = zip64.compressedSize ?? compressedSize
      localHeaderOffset = zip64.localHeaderOffset ?? localHeaderOffset
    }

    entries.push({
      name,
      method,
      compressedSize,
      size,
      localHeaderOffset,
      flags,
      isDirectory: name.endsWith('/'),
    })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

export function readZipEntry(
  buffer: Buffer,
  entry: ZipEntry,
  maxOutputBytes = 256 * 1024 * 1024,
): Buffer {
  const offset = entry.localHeaderOffset
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== LOCAL_SIGNATURE) {
    throw new Error(`ZIP 成员损坏：${entry.name}`)
  }
  const nameLength = buffer.readUInt16LE(offset + 26)
  const extraLength = buffer.readUInt16LE(offset + 28)
  const dataStart = offset + 30 + nameLength + extraLength
  const dataEnd = dataStart + entry.compressedSize
  if (dataEnd > buffer.length) throw new Error(`ZIP 成员越界：${entry.name}`)
  const data = buffer.subarray(dataStart, dataEnd)

  if (entry.size > maxOutputBytes) {
    throw new Error(`ZIP 成员解压后过大：${entry.name}`)
  }

  if (entry.method === 0) return data
  if (entry.method === 8) {
    return inflateRawSync(data, { maxOutputLength: maxOutputBytes })
  }
  throw new Error(`不支持的 ZIP 压缩方式：${entry.method}`)
}
