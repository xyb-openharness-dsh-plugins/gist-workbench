/**
 * 最小 ZIP 读取器（无第三方依赖）。
 *
 * 只做一件事：从 Buffer 里列出条目、取出某个条目解压后的字节。够用就停——
 * 不支持写入、不支持加密、不支持 ZIP64（遇到就明确报错，不猜）。
 *
 * 用法（MinerU 返回的 zip 里取 `full.md`）：
 *   const zip = readZip(buffer)
 *   const md = zip.text('full.md')
 */
import { inflateRawSync } from 'node:zlib'

const EOCD_SIG = 0x06054b50 // 中央目录结束标记
const CD_SIG = 0x02014b50 // 中央目录条目
const LOCAL_SIG = 0x04034b50 // 本地文件头

export class ZipError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ZipError'
    this.code = 'ZIP_ERROR'
  }
}

/** 从尾部向前找 EOCD（注释最长 65535，所以最多回看 65557 字节）。 */
function findEocd(buf) {
  if (buf.length < 22) throw new ZipError('文件太小，不是 ZIP')
  const floor = Math.max(0, buf.length - 65557)
  for (let i = buf.length - 22; i >= floor; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i
  }
  throw new ZipError('找不到 ZIP 中央目录结尾（可能不是 ZIP，或被截断）')
}

/** 列出所有条目（不做解压）。 */
export function listEntries(buf) {
  const eocd = findEocd(buf)
  const count = buf.readUInt16LE(eocd + 10)
  let offset = buf.readUInt32LE(eocd + 16)
  if (buf.readUInt16LE(eocd + 4) !== 0 || buf.readUInt16LE(eocd + 6) !== 0) {
    throw new ZipError('分卷 ZIP 不支持')
  }
  if (count === 0xffff) throw new ZipError('ZIP64 不支持（条目数溢出），请先降级压缩包')

  const entries = []
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CD_SIG) {
      throw new ZipError(`第 ${i + 1} 个中央目录条目损坏`)
    }
    const flags = buf.readUInt16LE(offset + 8)
    const method = buf.readUInt16LE(offset + 10)
    const compressedSize = buf.readUInt32LE(offset + 20)
    const size = buf.readUInt32LE(offset + 24)
    const nameLen = buf.readUInt16LE(offset + 28)
    const extraLen = buf.readUInt16LE(offset + 30)
    const commentLen = buf.readUInt16LE(offset + 32)
    const localOffset = buf.readUInt32LE(offset + 42)
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      throw new ZipError('ZIP64 不支持（长度字段溢出）')
    }
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen)
    entries.push({
      name,
      method,
      compressedSize,
      size,
      localOffset,
      encrypted: (flags & 0x1) === 1,
    })
    offset += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** 取一个条目的解压后字节。 */
export function extractEntry(buf, entry) {
  if (entry.encrypted) throw new ZipError(`条目已加密，无法读取：${entry.name}`)
  const lo = entry.localOffset
  if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== LOCAL_SIG) {
    throw new ZipError(`条目本地头损坏：${entry.name}`)
  }
  const nameLen = buf.readUInt16LE(lo + 26)
  const extraLen = buf.readUInt16LE(lo + 28)
  const start = lo + 30 + nameLen + extraLen
  const data = buf.subarray(start, start + entry.compressedSize)
  if (data.length !== entry.compressedSize) throw new ZipError(`条目数据被截断：${entry.name}`)

  if (entry.method === 0) return Buffer.from(data)
  if (entry.method === 8) {
    try {
      return inflateRawSync(data)
    } catch (error) {
      throw new ZipError(`解压失败（${entry.name}）：${error.message}`)
    }
  }
  throw new ZipError(`不支持的压缩方法 ${entry.method}（${entry.name}）`)
}

/**
 * 便捷封装：`names` 列表 + `bytes(name)` / `text(name)`。
 * 查找时先精确匹配，再忽略大小写，最后按后缀匹配（zip 里可能多一层目录）。
 */
export function readZip(buf) {
  const entries = listEntries(buf)
  const byName = new Map(entries.map((e) => [e.name, e]))

  const find = (name) => {
    if (byName.has(name)) return byName.get(name)
    const lower = name.toLowerCase()
    const ci = entries.find((e) => e.name.toLowerCase() === lower)
    if (ci) return ci
    return entries.find((e) => e.name.toLowerCase().endsWith(`/${lower}`)) ?? null
  }

  return {
    names: entries.map((e) => e.name),
    has: (name) => find(name) !== null,
    bytes(name) {
      const entry = find(name)
      if (!entry) throw new ZipError(`ZIP 里没有这个条目：${name}`)
      return extractEntry(buf, entry)
    },
    text(name) {
      const entry = find(name)
      if (!entry) throw new ZipError(`ZIP 里没有这个条目：${name}`)
      return extractEntry(buf, entry).toString('utf8')
    },
  }
}
