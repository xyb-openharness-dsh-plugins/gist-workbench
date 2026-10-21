#!/usr/bin/env node
/**
 * 独立启动（不进 DSH 宿主时用它）：
 *   npm start -- --workspace <目录>
 *
 * 三条刻意的"不"：
 * 1. 不给 --workspace 就打 help 并退出 2，**不静默建目录**——资料目录只能由用户选定（A21/A22）；
 * 2. 目录不存在时才创建（用户已经确认过的位置），主目录 / 桌面 / 下载根 / /tmp / /var 一律拒绝；
 * 3. 退出时先关库再退，避免"最后一次写入没落盘"。
 *
 * 用法：
 *   node scripts/dev-server.mjs --workspace ~/Documents/GistPalWorkspace [--port 4173] [--open]
 */
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { Workbench, validateWorkspacePath } from '../dsh/workbench.js'
import { startWorkbenchServer } from '../dsh/server.js'
import { displayVersion, build as buildStamp } from '../lib/version.js'

const HELP = `小吉宝 GistPal 开发版服务

用法：
  npm start -- --workspace <目录> [选项]
  node scripts/dev-server.mjs -w <目录> [选项]

选项：
  -w, --workspace <目录>   必填。资料目录（数据库与将来的原件放这里）
  -p, --port <端口>        默认 4173；0 表示由系统分配
      --host <地址>        默认 127.0.0.1
      --open               启动后尝试打开浏览器（失败不影响服务）
  -h, --help              显示本帮助

说明：资料目录必须是你在某个位置下新建的目录；主目录、桌面/下载根目录、/tmp、/var 会被拒绝。`

function parseArgs(argv) {
  const out = { port: 4173, host: '127.0.0.1', open: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') out.help = true
    else if (a === '-w' || a === '--workspace') out.workspace = argv[++i]
    else if (a === '-p' || a === '--port') out.port = Number(argv[++i])
    else if (a === '--host') out.host = argv[++i]
    else if (a === '--open') out.open = true
    else if (a.startsWith('-')) { console.error(`✗ 不认识的选项：${a}\n`); console.error(HELP); process.exit(2) }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
if (args.help) { console.log(HELP); process.exit(0) }

if (!args.workspace) {
  console.error('✗ 缺少 --workspace：请指定一个你选定的资料目录（不自动猜测、不静默创建）\n')
  console.error(HELP)
  process.exit(2)
}

const workspace = resolve(args.workspace)
const problems = validateWorkspacePath(workspace)
if (problems.length) {
  console.error(`✗ 资料目录不可用：${problems.join('；')}\n`)
  console.error(HELP)
  process.exit(2)
}

let workbench
try {
  workbench = await Workbench.open(workspace)
} catch (error) {
  console.error(`✗ 打不开工作台：${error.message}`)
  process.exit(1)
}

const { server, port, url } = await startWorkbenchServer({ port: args.port, host: args.host, workbench })
const subjects = workbench.listSubjects()
const payload = workbench.bootstrap()
const points = Object.values(payload.profiles).reduce((a, p) => a + p.metrics.reduce((b, m) => b + m.points.length, 0), 0)

console.log(`✓ 小吉宝 GistPal ${displayVersion}（build ${buildStamp}）`)
console.log(`  资料目录：${workspace}`)
console.log(`  档案：${subjects.map((s) => `${s.profile_key}=${s.name}`).join(' / ')} · 指标点 ${points} 条 · 临床研究 ${payload.trials.length} 条`)
console.log(`  本机访问：${url}`)

if (args.open) {
  try { spawn('open', [url], { stdio: 'ignore', detached: true }).unref() } catch { /* 打不开浏览器不影响服务 */ }
}

let closing = false
async function shutdown(signal) {
  if (closing) return
  closing = true
  console.log(`\n收到 ${signal}，正在关闭…`)
  try { workbench.close() } catch (error) { console.error(`关库失败：${error.message}`) }
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1500).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
