/* 列一致性校验（H6）
 *
 * 为什么要有这个脚本：胃癌那轮生成器连续 6 次 INSERT 列数不匹配
 * （`resection_rows` 8 列 / 7 值、`meal_log` 少一个 symptoms…），
 * 都是位置式 INSERT 造成的，而且只有跑到那一步才报错。
 *
 * 做法：把 `schema/00*.sql` **按编号全部执行**进一个 :memory: 库（0002 起是 ALTER 追加，
 * 只跑 0001 会漏掉后续列），再把生成的 `demo/demo-data.sqlite` 打开，
 * 逐表比对 PRAGMA table_info 的列名与顺序。
 * 这样比"盯着 SQL 数逗号"可靠，也不依赖生成器里那段 CREATE TABLE 的写法。
 *
 * 额外检查：
 *   - 表集合双向相等（schema 多出来的表说明生成器没建；生成器多的表说明 schema 落后）；
 *   - 每张通用表都有行（除 demo_meta 之外的空表大概率是播种漏了，打印告警不失败）；
 *   - metric_points 的 v_num / v_text 互斥（数值指标不得带文字值，反之亦然）。
 *
 * 用法：node scripts/check-demo-columns.mjs   （先跑 node demo/build-demo-data.mjs）
 * 退出码 0 = 通过；1 = 不一致（打印差异）。
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCHEMA_DIR = join(ROOT, 'schema');
const SQLITE = join(ROOT, 'demo/demo-data.sqlite');

const problems = [];
const warnings = [];

if (!existsSync(SQLITE)) {
  console.error(`✗ 找不到 ${SQLITE}，先跑 \`node demo/build-demo-data.mjs\``);
  process.exit(1);
}

const info = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all()
  .map((c) => ({ name: c.name, type: (c.type || '').toUpperCase(), notnull: c.notnull ? 1 : 0, pk: c.pk || 0 }));

const schemaDb = new DatabaseSync(':memory:');
for (const f of readdirSync(SCHEMA_DIR).filter((x) => x.endsWith('.sql')).sort()) {
  schemaDb.exec(readFileSync(join(SCHEMA_DIR, f), 'utf8'));
}
const dataDb = new DatabaseSync(SQLITE);

const tablesOf = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all().map((r) => r.name);

const schemaTables = tablesOf(schemaDb);
const dataTables = tablesOf(dataDb);

/* ---------- 1. 表集合 ---------- */
for (const t of schemaTables) {
  if (!dataTables.includes(t)) problems.push(`schema 有表 ${t}，demo-data.sqlite 里没有`);
}
for (const t of dataTables) {
  if (!schemaTables.includes(t)) problems.push(`demo-data.sqlite 有表 ${t}，schema 里没有（schema 落后了？）`);
}

/* ---------- 2. 列名 / 顺序 / 类型 ---------- */
for (const t of schemaTables.filter((x) => dataTables.includes(x))) {
  const a = info(schemaDb, t);
  const b = info(dataDb, t);
  const an = a.map((c) => c.name);
  const bn = b.map((c) => c.name);
  if (an.join(',') !== bn.join(',')) {
    const missing = an.filter((x) => !bn.includes(x));
    const extra = bn.filter((x) => !an.includes(x));
    problems.push(`表 ${t} 列不一致：schema [${an.join(', ')}] / 生成器 [${bn.join(', ')}]`
      + (missing.length ? `；缺 ${missing.join(',')}` : '')
      + (extra.length ? `；多 ${extra.join(',')}` : ''));
    continue;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].type !== b[i].type) {
      problems.push(`表 ${t}.${a[i].name} 类型不一致：schema ${a[i].type || '(空)'} / 生成器 ${b[i].type || '(空)'}`);
    }
    if (a[i].pk !== b[i].pk) {
      problems.push(`表 ${t}.${a[i].name} 主键标记不一致：schema pk=${a[i].pk} / 生成器 pk=${b[i].pk}`);
    }
  }
}

/* ---------- 3. 空表告警（demo_meta 之外） ---------- */
const OPTIONAL_EMPTY = new Set(['surgery_rows']);   // A 未手术，但 B 有；若整表空才是问题
for (const t of dataTables) {
  const n = dataDb.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  if (n === 0 && t !== 'demo_meta' && !OPTIONAL_EMPTY.has(t)) {
    warnings.push(`表 ${t} 是空的（播种漏了？）`);
  }
}

/* ---------- 4. 指标点互斥 ---------- */
{
  const bad = dataDb.prepare('SELECT profile_key, metric_key, d, v_num, v_text FROM metric_points WHERE (v_num IS NULL AND v_text IS NULL) OR (v_num IS NOT NULL AND v_text IS NOT NULL)').all();
  if (bad.length) problems.push(`metric_points 有 ${bad.length} 行 v_num / v_text 不互斥，例如 ${JSON.stringify(bad[0])}`);
}

/* ---------- 5. 指标 kind 与 dec 的一致性 ---------- */
{
  const bad = dataDb.prepare("SELECT profile_key, key, dec, kind FROM metrics WHERE (dec IS NULL AND kind = 'numeric') OR (dec IS NOT NULL AND kind <> 'numeric')").all();
  if (bad.length) problems.push(`metrics 有 ${bad.length} 行 kind 与 dec 矛盾（dec 为 NULL 才是分类指标），例如 ${JSON.stringify(bad[0])}`);
}

/* ---------- 汇总 ---------- */
const totalCols = schemaTables.reduce((a, t) => a + info(schemaDb, t).length, 0);
console.log(`表 ${schemaTables.length} 张 / 列 ${totalCols} 个；demo-data.sqlite 表 ${dataTables.length} 张`);
for (const w of warnings) console.log(`  ! ${w}`);

if (problems.length) {
  console.error(`\n✗ 列一致性校验失败（${problems.length} 项）：`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('✓ 生成器与 schema 的列名 / 顺序 / 类型 / 主键全部一致');
