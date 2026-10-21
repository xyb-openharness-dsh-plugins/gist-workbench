#!/usr/bin/env node
/**
 * 医疗表述越界检查（A18）。
 *
 * 产品只提供信息，不做诊断、不给处置建议（SPEC §2 / D16）。这条红线在 UI 文案里
 * 最容易破防，所以放进 `npm run check`：命中即失败，不靠人记。
 *
 * 扫描范围：会被用户读到的实现代码——`dsh/`、`lib/`、`public/`、`src/` 下的
 * .js/.mjs/.cjs/.html/.css。**不扫** docs/ 与 prototypes/：前者是讨论稿，
 * 后者是已签认的设计产物，各自有评审。
 *
 * 三种放行方式：
 * 1. 否定语境：命中词前 12 个字符内出现「不 / 勿 / 禁止 / 别」，判为免责表述，放行；
 * 2. 显式标注：该行含 `wording-allow` 注释，放行（需在注释里写清为什么）；
 * 3. 禁用词守卫表本身（`const FORBIDDEN = [...]`）不算面向用户的文案，整行跳过。
 *
 * 用法：node scripts/check-wording.mjs
 * 退出码：0 无命中或没有可扫文件；1 有命中。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIRS = ['dsh', 'lib', 'public', 'src']
const EXTS = new Set(['.js', '.mjs', '.cjs', '.html', '.css'])

/** 越界表述：不是"提到疾病"，而是"替医生下结论或给处置"。 */
const RULES = [
  { id: 'treatment-advice', re: /建议\s*(进行|做|用|接受|采用|考虑)?\s*(治疗|手术|化疗|放疗|用药|服药|停药|加药|减药|靶向)/g },
  { id: 'recommend-drug', re: /推荐\s*(进行|使用|服用|用)?\s*(用药|服药|治疗|手术|剂量|药物)/g },
  { id: 'stop-medication', re: /(可以|可|建议|不妨)\s*停\s*(药|用|服)/g },
  { id: 'skip-care', re: /(不用|无需|不必|没必要)\s*(就医|复查|去医院|看医生)/g },
  { id: 'recurrence-claim', re: /(可能|大概率|一定|肯定|不会)\s*复发/g },
  { id: 'prognosis-claim', re: /预后\s*(良好|较好|不错|较差|很差)/g },
  { id: 'cure-rate', re: /治愈率|生存期\s*(还有|不足|大概)/g },
  { id: 'diagnose-claim', re: /(确诊|诊断)\s*为\s*(癌|肿瘤|恶性)/g },
]

const NEGATION = /[不勿禁别]$|不构成|不代表|不做|不提供|不作为|不据此/
/** 守卫表定义行：里面写的就是禁用词本身，不是给用户看的文案 */
const GUARD_LINE = /\bFORBIDDEN\b\s*=/

function walk(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walk(full))
    else if (st.isFile() && EXTS.has(extname(entry))) out.push(full)
  }
  return out
}

const files = DIRS.flatMap((d) => walk(join(root, d)))
const hits = []

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    if (line.includes('wording-allow')) return
    if (GUARD_LINE.test(line)) return
    for (const rule of RULES) {
      rule.re.lastIndex = 0
      let m
      while ((m = rule.re.exec(line)) !== null) {
        const before = line.slice(Math.max(0, m.index - 12), m.index)
        if (NEGATION.test(before)) continue
        hits.push({
          file: relative(root, file),
          line: i + 1,
          rule: rule.id,
          text: m[0].trim(),
        })
      }
    }
  })
}

/* 换癌种残留：上一个癌种的术语不能出现在实现代码里（DEV-REQUIREMENTS H16）。
 * 先剥掉块注释与行注释再扫——"不要抄食管癌那套"这类注释是允许的。 */
const RESIDUE = ['小咽宝', 'EsopPal', '食管癌', '吞咽', 'SCC-Ag', 'CEA'];
const residueHits = [];
for (const file of files) {
  const raw = readFileSync(file, 'utf8')
  const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const term of RESIDUE) {
    if (stripped.includes(term)) residueHits.push({ file: relative(root, file), term })
  }
}
if (residueHits.length) {
  console.error(`✗ 残留上一个癌种的术语 ${residueHits.length} 处：\n`)
  for (const h of residueHits) console.error(`  ${h.file}  含「${h.term}」`)
  console.error('\n换癌种时这些词必须清掉；注释里做对照说明请写成不带完整病名的形式。')
  process.exit(1)
}

if (!files.length) {
  console.log('= 没有可扫描的实现文件（dsh/ lib/ public/ src/ 为空或不存在），本次跳过')
  process.exit(0)
}

if (hits.length) {
  console.error(`✗ 医疗表述越界 ${hits.length} 处（产品只提供信息，不做诊断与处置建议）：\n`)
  for (const h of hits) console.error(`  ${h.file}:${h.line}  [${h.rule}]  「${h.text}」`)
  console.error('\n改法：改成"记录/整理/带去看医生"的表述；确属免责语句请写在否定语境里。')
  console.error('依据：docs/SPEC.md §2 产品立场、A18。')
  process.exit(1)
}

console.log(`✓ 医疗表述检查通过（${files.length} 个实现文件，0 处越界）`)
