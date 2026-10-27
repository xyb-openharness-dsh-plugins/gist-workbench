#!/usr/bin/env node
/**
 * 36 号疾病概要 · 开发版副本一致性（public/ ↔ prototypes/v0.2/）
 *
 * 为什么需要：开发版 public/ 与定稿原型是两份静态文件，primer 三件套若只改一份，
 * 线上「?」浮窗就会和原型慢慢分叉（文案/链接/排版任一处）。链接断言（L1–L6）只跑数据文件，
 * 这个脚本补的是「副本同源」这一层。
 *
 * 判据：
 *   C1 public/primer.js / primer.css / primer-data.js 三件都在
 *   C2 三件与活动原型（prototypes/<最高版本>/）逐字节一致
 *   C3 public/index.html 引入三件（primer.css / primer-data.js / primer.js）且顺序为 数据 → 模块
 *   C4 顶栏有 [data-primer-open] 入口（模块接管后渲染「?」）
 *
 * 用法：node scripts/check-primer-copies.mjs
 * 退出码：0 通过；1 有缺失/分叉
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = join(ROOT, 'public')
const FILES = ['primer.js', 'primer.css', 'primer-data.js']

function activePrototype() {
  const dir = join(ROOT, 'prototypes')
  if (!existsSync(dir)) return null
  const dirs = readdirSync(dir)
    .filter((d) => existsSync(join(dir, d, 'primer-data.js')))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  return dirs.length ? join(dir, dirs[dirs.length - 1]) : null
}

const fails = []
const ok = (m) => console.log(`PASS  ${m}`)
const bad = (m) => fails.push(m)

const proto = activePrototype()
if (!proto) bad('C0 找不到 prototypes/*/primer-data.js（活动原型）')
else ok(`C0 活动原型 ${proto.replace(ROOT + '/', '')}`)

for (const f of FILES) {
  const p = join(PUBLIC, f)
  if (!existsSync(p) || !statSync(p).isFile()) { bad(`C1 public/${f} 缺失`); continue }
  ok(`C1 public/${f} 存在`)
  if (proto) {
    const same = readFileSync(p).equals(readFileSync(join(proto, f)))
    same ? ok(`C2 public/${f} 与原型逐字节一致`) : bad(`C2 public/${f} 与 ${proto.replace(ROOT + '/', '')}/${f} 不一致（请同步，勿改副本）`)
  }
}

const idxPath = join(PUBLIC, 'index.html')
if (!existsSync(idxPath)) bad('C3 public/index.html 缺失')
else {
  const html = readFileSync(idxPath, 'utf8')
  const pos = (needle) => html.indexOf(needle)
  const iCss = pos('href="primer.css"')
  const iData = pos('src="primer-data.js"')
  const iMod = pos('src="primer.js"')
  iCss >= 0 ? ok('C3 index.html 引入 primer.css') : bad('C3 index.html 未引入 primer.css')
  iData >= 0 ? ok('C3 index.html 引入 primer-data.js') : bad('C3 index.html 未引入 primer-data.js')
  iMod >= 0 ? ok('C3 index.html 引入 primer.js') : bad('C3 index.html 未引入 primer.js')
  if (iData >= 0 && iMod >= 0 && !(iData < iMod)) bad('C3 primer-data.js 必须先于 primer.js 加载')
  else if (iData >= 0 && iMod >= 0) ok('C3 加载顺序 数据 → 模块')
  if (/data-primer-open/.test(html)) ok('C4 顶栏有 [data-primer-open] 入口')
  else bad('C4 顶栏缺少 [data-primer-open] 入口')
}

console.log(`\n${fails.length ? '✗' : '✓'} 开发版副本一致性：${fails.length ? fails.join('；') : '三件同源、入口齐全'}`)
process.exit(fails.length ? 1 : 0)
