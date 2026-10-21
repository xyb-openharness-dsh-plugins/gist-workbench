#!/usr/bin/env node
/**
 * 冻结合同校验。
 *
 * `schema/` 下的迁移一旦执行就不许改：改历史迁移 = 两台机器的库不一样 = 数据不可复现。
 * 本脚本拿 `schema/freeze-contract.md` 里记的 sha256 与磁盘上的文件比对，
 * 缺记录、哈希不符、命名不合规，都直接失败。
 *
 * 用法：node scripts/check-schema.mjs
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const schemaDir = join(root, 'schema')
const contractPath = join(schemaDir, 'freeze-contract.md')

const FILE_RE = /^\d{4}_[a-z0-9_]+\.sql$/
const ROW_RE = /^\|\s*`?(\d{4}_[a-z0-9_]+\.sql)`?\s*\|\s*([0-9a-f]{64})\s*\|/gm

const files = readdirSync(schemaDir).filter((f) => f.endsWith('.sql'))
const unknown = files.filter((f) => !FILE_RE.test(f))
if (unknown.length) {
  console.error(`✗ schema/ 里有不符合 NNNN_name.sql 的文件：${unknown.join(', ')}`)
  process.exit(1)
}

let contract
try {
  contract = readFileSync(contractPath, 'utf8')
} catch {
  console.error('✗ 缺少 schema/freeze-contract.md（G3 签认后必须有）')
  process.exit(1)
}

const recorded = new Map()
for (const m of contract.matchAll(ROW_RE)) recorded.set(m[1], m[2])

const problems = []
for (const file of files.sort()) {
  const actual = createHash('sha256').update(readFileSync(join(schemaDir, file)), 'utf8').digest('hex')
  const expected = recorded.get(file)
  if (!expected) {
    problems.push(`${file} 没有冻结记录（请在 schema/freeze-contract.md 追加一行）`)
    continue
  }
  if (expected !== actual) {
    problems.push(`${file} 与冻结记录不符（记录 ${expected.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…）`)
  }
}

const stale = [...recorded.keys()].filter((f) => !files.includes(f))
for (const f of stale) problems.push(`freeze-contract.md 记了 ${f}，但 schema/ 里没有这个文件`)

if (problems.length) {
  console.error('✗ schema 冻结合同被破坏：')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('\n已执行过的迁移不能改。要改结构就新增 0002_*.sql，并把新文件与哈希追加到 freeze-contract.md。')
  process.exit(1)
}

console.log(`✓ schema 冻结合同通过（${files.length} 个迁移文件，哈希一致）`)
