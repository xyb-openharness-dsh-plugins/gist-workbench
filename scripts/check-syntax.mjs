#!/usr/bin/env node
/**
 * 语法门：对仓库里所有会跑起来的 JavaScript 做一次 `node --check`。
 *
 * 为什么要有这个脚本：以前 `npm run check` 里是一串手写的文件名，
 * 新增 `dsh/readmodels.js`、`dsh/workbench.js`、`dsh/server.js`、`public/**` 之后
 * 那串清单就漏了——语法错误只有等到真启动才暴露。改成扫目录，新增文件自动纳入。
 *
 * 范围：`dsh/`、`lib/`、`public/`、`src/`、`scripts/`、`test/` 下的 .js / .mjs。
 * 不扫描 `prototypes/`：那是签认过的快照，改动它会破坏 G1/G2 的视觉基准。
 *
 * 用法：node scripts/check-syntax.mjs
 * 退出码：0 全部通过；1 有文件语法错误（打印文件名与首行错误）。
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TARGETS = ['dsh', 'lib', 'public', 'src', 'scripts', 'test']
const EXT = new Set(['.js', '.mjs'])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    const info = statSync(full)
    if (info.isDirectory()) walk(full, out)
    else if (EXT.has(full.slice(full.lastIndexOf('.')))) out.push(full)
  }
  return out
}

const files = []
for (const target of TARGETS) {
  try {
    if (statSync(join(root, target)).isDirectory()) walk(join(root, target), files)
  } catch {
    // 目录不存在就跳过（例如只装了运行时的精简包）
  }
}

let failed = 0
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (error) {
    failed += 1
    const firstLine = String(error.stderr ?? '').split('\n').find((line) => line.trim()) ?? '语法错误'
    console.error(`✗ ${relative(root, file)}`)
    console.error(`  ${firstLine.trim()}`)
  }
}

if (failed) {
  console.error(`\n✗ 语法检查失败：${failed} / ${files.length} 个文件`)
  process.exit(1)
}
console.log(`✓ 语法检查通过（${files.length} 个文件）`)
