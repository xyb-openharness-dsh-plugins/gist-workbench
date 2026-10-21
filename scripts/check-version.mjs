#!/usr/bin/env node
/**
 * 版本号一致性校验。
 *
 * 单一来源：仓库根目录的 VERSION 文件（一行，语义化版本，可带预发布后缀）。
 * 本脚本核对所有「会显示给人看」的地方，防止页面版本与实际版本漂移。
 *
 * 两类别核对：
 * 1. **随 VERSION 走**：开发版页面（`public/`）、`lib/version.js`（生成物）、`package.json`、
 *    （若存在）DSH 工作台清单；
 * 2. **冻结在快照版本**：`prototypes/v0.2/` 是 G1/G2 签认过的视觉基准，改动它会破坏
 *    "UI 以 v0.3.0 原型为准"这条依据（D37），所以它不跟着 VERSION 前移，
 *    而是固定核对到 FROZEN_PROTOTYPE 上。
 *
 * 用法：node scripts/check-version.mjs
 * 退出码：0 全部一致；1 有不一致或读不到。
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/** 原型快照的版本：G1/G2 签认时的那个号，不再移动（D37）。 */
const FROZEN_PROTOTYPE = '0.1.0'

const problems = []
const checks = []

function check(name, actual, expected) {
  const ok = actual === expected
  checks.push({ name, actual, expected, ok })
  if (!ok) problems.push(`${name}：期望 ${expected}，实际 ${actual ?? '（未找到）'}`)
}

if (!existsSync(join(root, 'VERSION'))) {
  console.error('✗ 缺少 VERSION 文件（仓库根目录）')
  process.exit(1)
}

const version = read('VERSION').trim()
if (!SEMVER.test(version)) {
  console.error(`✗ VERSION 不是合法语义化版本：${version}`)
  process.exit(1)
}

/* 0) 冻结快照：原型不跟着版本走，只核对它没被改过号 */
if (existsSync(join(root, 'prototypes/v0.2/app.js'))) {
  const appJs = read('prototypes/v0.2/app.js')
  check('prototypes/v0.2/app.js（快照冻结）', appJs.match(/version:\s*'([^']+)'/)?.[1], FROZEN_PROTOTYPE)
  const html = read('prototypes/v0.2/index.html')
  check('prototypes/v0.2/index.html（快照冻结）', html.match(/<title>[^<]*?v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)<\/title>/)?.[1], FROZEN_PROTOTYPE)
  const literals = [...new Set([...html.matchAll(/v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/g)].map((x) => x[1]))]
  check('prototypes/v0.2/index.html 版本字面量（去重）', literals.join(', '), FROZEN_PROTOTYPE)
}

/* 1) 开发版页面标题里的 vX.Y.Z */
const indexHtml = read('public/index.html')
const title = indexHtml.match(/<title>[^<]*?v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)<\/title>/)
check('public/index.html <title>', title?.[1], version)

/* 2) 开发版页面里所有 vX.Y.Z 字面量（JS 未运行时的降级值、chip、页脚、关于） */
const publicLiterals = [...new Set([...indexHtml.matchAll(/v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/g)].map((x) => x[1]))]
check('public/index.html 版本字面量（去重）', publicLiterals.join(', '), version)

/* 3) 前端状态里的降级版本（/api/state 没回来之前先显示这个） */
const appJs = read('public/app.js')
check('public/app.js APP_INFO.version 默认值', appJs.match(/version:\s*'([^']+)'/)?.[1], version)

/* 4) 构建期注入的 lib/version.js（生成物，由 scripts/build-version.mjs 从 VERSION 生成） */
if (existsSync(join(root, 'lib/version.js'))) {
  const libVersion = read('lib/version.js').match(/export const version = '([^']+)'/)?.[1]
  check('lib/version.js version', libVersion, version)
} else {
  problems.push('缺少 lib/version.js（页面与包的唯一版本来源），请运行 npm run build:version')
}

/* 5) 若已进入打包阶段，package.json 必须一致 */
if (existsSync(join(root, 'package.json'))) {
  const pkg = JSON.parse(read('package.json'))
  check('package.json version', pkg.version, version)
}

/* 6) DSH 工作台清单（接入后存在才检查） */
for (const p of ['dsh.profile.json', 'workbench.json', 'dsh/manifest.json']) {
  if (!existsSync(join(root, p))) continue
  try {
    const json = JSON.parse(read(p))
    check(`${p} version`, json.version, version)
  } catch {
    problems.push(`${p} 不是合法 JSON，无法核对版本`)
  }
}

const pad = (s, n) => String(s ?? '（未找到）').padEnd(n)
for (const c of checks) {
  console.log(`${c.ok ? '✓' : '✗'} ${pad(c.name, 44)} ${c.actual ?? '—'}`)
}

if (problems.length) {
  console.error('\n版本号不一致：')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('\n改版本时请先改 VERSION，再让其余位置与它一致（见 docs/VERSIONING.md）。\n原型快照 prototypes/v0.2 冻结在 0.3.0，不随 VERSION 移动（D37）。')
  process.exit(1)
}

console.log(`\n✓ 版本号一致：v${version}（共核对 ${checks.length} 处；原型快照冻结在 v${FROZEN_PROTOTYPE}）`)
