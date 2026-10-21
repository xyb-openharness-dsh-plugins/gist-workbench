/* 读模型（GIST）：把库里的行还原成**前端要的形状**。
 *
 * 契约：`GET /api/bootstrap` 的 profiles 必须与 prototypes/v0.2/demo-data.js 里的同名档案
 * 逐字段一致（test/store.test.mjs 的 parity 断言是 deepStrictEqual）。所以这里不做任何"顺手优化"：
 * 字段名、数组/对象的嵌套层级、null 与缺失的语义都跟着 demo-data.js 走。
 *
 * 四条容易踩的（前三条继承家族前几轮，第四条是 GIST 独有）：
 * 1. 数值指标点用 v_num，分类/等级用 v_text；读出来统一还原成 `v`（数字就是数字）。
 * 2. 排序：有 ord 的表按 ord，events 没有 ord，按 rowid（＝插入顺序）。复合主键表裸 SELECT
 *    会按索引字母序返回，必须 ORDER BY rowid。
 * 3. kind 列：播种时数值指标写 'numeric'、分类指标写生成器里的 kind（grade/qual）。
 *    原型数据里数值指标**没有** kind 键，所以只在 kind !== 'numeric' 时还原。
 * 4. **docs / candidates / events 在 demo-data.js 里是定长数组，不是对象**
 *    （events = [日期, 名称]，docs = [id, 名称, 日期, 类型, 状态]，candidates = [id, 名称, 值, 来源, 状态]）。
 *    这里必须 map 回数组，直接返回行对象会让 parity 断言当场红。
 *    分类指标（水肿 / 乏力 / 腹泻）在原型里没有 `unit` 键，读出来也不能补 unit:null。
 */

import { AGENT_PANE } from '../lib/layout.js';

const jp = (s, fallback = null) => {
  if (s === null || s === undefined) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};
const rows = (db, sql, ...args) => db.prepare(sql).all(...args).map((r) => ({ ...r }));

function readMetrics(db, key) {
  /* 必须 ORDER BY rowid：metrics 主键是 (profile_key, key)，裸 SELECT 会按 key 字母序返回 */
  const list = rows(db, 'SELECT * FROM metrics WHERE profile_key = ? ORDER BY rowid', key);
  return list.map((m) => ({
    key: m.key,
    name: m.name,
    ...(m.unit === null ? {} : { unit: m.unit }),
    dec: m.dec ?? null,
    band: m.band_low === null && m.band_high === null ? null : [m.band_low, m.band_high],
    note: m.note ?? null,
    cat: m.cat ?? null,
    color: m.color ?? null,
    ...(m.kind && m.kind !== 'numeric' ? { kind: m.kind } : {}),
    points: rows(db, 'SELECT d, v_num, v_text, src FROM metric_points WHERE profile_key = ? AND metric_key = ? ORDER BY ord, d', key, m.key)
      .map((p) => ({ d: p.d, v: p.v_num === null ? p.v_text : p.v_num, src: p.src ?? null })),
  }));
}

/* 演示数据里的表行是「变长数组」：末尾字段没写就是没有，不是 null。
 * sqlite 读出来是 NULL，若不还原，parity 会把 [.., null] 和 [..] 判成不一致。
 * 只裁尾部，中间的 null 原样保留。 */
function trimTail(arr) {
  let n = arr.length;
  while (n > 0 && (arr[n - 1] === null || arr[n - 1] === undefined)) n -= 1;
  return arr.slice(0, n);
}

function readProfile(db, key) {
  const found = db.prepare('SELECT * FROM subjects WHERE profile_key = ?').get(key);
  if (!found) return null;
  const s = { ...found };

  const pathwayRows = rows(db, 'SELECT phase, name, window, detail, note FROM pathway_rows WHERE profile_key = ? ORDER BY ord', key)
    .map((r) => trimTail([r.phase, r.name, r.window, r.detail, r.note]));
  const riskRows = rows(db, 'SELECT system, grade, basis, source, note FROM risk_rows WHERE profile_key = ? ORDER BY ord', key)
    .map((r) => trimTail([r.system, r.grade, r.basis, r.source, r.note]));
  const surgeryRows = rows(db, 'SELECT d, kind, resection, margin, rupture, institution, note FROM surgery_rows WHERE profile_key = ? ORDER BY ord', key)
    .map((r) => trimTail([r.d, r.kind, r.resection, r.margin, r.rupture, r.institution, r.note]));
  const medRows = rows(db, 'SELECT name, dose, schedule, start, end, status, note FROM med_rows WHERE profile_key = ? ORDER BY ord', key)
    .map((r) => trimTail([r.name, r.dose, r.schedule, r.start, r.end, r.status, r.note]));
  const doseRows = rows(db, 'SELECT d, drug, from_dose, to_dose, reason FROM dose_rows WHERE profile_key = ? ORDER BY ord', key)
    .map((r) => trimTail([r.d, r.drug, r.from_dose, r.to_dose, r.reason]));
  const adherenceRows = rows(db, 'SELECT d, drug, planned, taken, note FROM adherence_rows WHERE profile_key = ? ORDER BY ord', key)
    .map((r) => trimTail([r.d, r.drug, r.planned, r.taken, r.note]));
  const sideRows = rows(db, 'SELECT d, term, grade, action, note FROM side_effect_rows WHERE profile_key = ? ORDER BY ord', key)
    .map((r) => trimTail([r.d, r.term, r.grade, r.action, r.note]));
  const imagingRows = rows(db, 'SELECT d, kind, site, finding, next, note FROM imaging_rows WHERE profile_key = ? ORDER BY ord', key)
    .map((r) => trimTail([r.d, r.kind, r.site, r.finding, r.next, r.note]));
  const monitorRows = rows(db, 'SELECT item, freq, last, next, note FROM monitor_rows WHERE profile_key = ? ORDER BY ord', key)
    .map((r) => trimTail([r.item, r.freq, r.last, r.next, r.note]));
  const bleedRows = rows(db, 'SELECT d, kind, detail FROM bleed_rows WHERE profile_key = ? ORDER BY ord', key)
    .map((r) => trimTail([r.d, r.kind, r.detail]));
  const nutritionRows = rows(db, 'SELECT d, slot, amount, foods, symptoms, note FROM nutrition_rows WHERE profile_key = ? ORDER BY ord', key)
    .map((r) => trimTail([r.d, r.slot, r.amount, r.foods, r.symptoms, r.note]));
  const pathRows = rows(db, "SELECT a, b FROM pathology_rows WHERE profile_key = ? AND kind = 'row' ORDER BY ord", key).map((r) => trimTail([r.a, r.b]));
  const pathGaps = rows(db, "SELECT a, b FROM pathology_rows WHERE profile_key = ? AND kind = 'gap' ORDER BY ord", key).map((r) => trimTail([r.a, r.b]));

  const profile = {
    name: s.name,
    sex: s.sex,
    age: s.age,
    meta: s.meta,
    headline: s.headline,
    stage: s.stage,
    mindset: s.mindset,
    dash_keys: jp(s.dash_keys, []),
    path: jp(s.path, []),
    activity: s.activity ?? null,
    familyTalk: s.family_talk ?? null,
    molecular: rows(db, 'SELECT k, v, src, state, note FROM molecular WHERE profile_key = ? ORDER BY ord', key)
      .map((r) => ({ k: r.k, v: r.v, src: r.src, state: r.state, note: r.note })),
    lines: rows(db, 'SELECT name, detail, done FROM treatment_lines WHERE profile_key = ? ORDER BY ord', key)
      .map((r) => ({ name: r.name, detail: r.detail, done: !!r.done })),
    cycles: rows(db, 'SELECT name, date, drugs, status, done FROM cycles WHERE profile_key = ? ORDER BY ord', key)
      .map((r) => trimTail([r.name, r.date, r.drugs, r.status, r.done])),
    pathology: s.pathology_title ? { title: s.pathology_title, status: s.pathology_status, rows: pathRows, gaps: pathGaps } : null,
    risk: s.risk_title ? { title: s.risk_title, rows: riskRows } : null,
    pathway: s.pathway_title ? { title: s.pathway_title, rows: pathwayRows } : null,
    surgery: s.surgery_title ? { title: s.surgery_title, rows: surgeryRows } : null,
    meds: s.meds_title ? { title: s.meds_title, rows: medRows } : null,
    dose: { title: '剂量变更', rows: doseRows },
    adherence: s.adherence_title ? { title: s.adherence_title, rows: adherenceRows } : null,
    sideEffects: s.side_title ? { title: s.side_title, rows: sideRows } : null,
    imaging: s.imaging_title ? { title: s.imaging_title, rows: imagingRows } : null,
    monitor: s.monitor_title ? { title: s.monitor_title, rows: monitorRows } : null,
    bleeds: s.bleed_title ? { title: s.bleed_title, rows: bleedRows } : null,
    nutrition: s.nutrition_title ? { title: s.nutrition_title, rows: nutritionRows } : null,
    rhythm: rows(db, 'SELECT item, freq, guideline, next FROM rhythm WHERE profile_key = ? ORDER BY ord', key)
      .map((r) => trimTail([r.item, r.freq, r.guideline, r.next])),
    events: rows(db, 'SELECT d, label FROM events WHERE profile_key = ? ORDER BY rowid', key).map((r) => trimTail([r.d, r.label])),
    viewpoints: rows(db, 'SELECT d, mood, text FROM viewpoints WHERE profile_key = ? ORDER BY ord', key).map((r) => trimTail([r.d, r.mood, r.text])),
    docs: rows(db, 'SELECT id, name, date, type, status FROM documents WHERE profile_key = ? ORDER BY ord', key)
      .map((r) => trimTail([r.id, r.name, r.date, r.type, r.status])),
    candidates: rows(db, 'SELECT id, name, value, source, status FROM candidate_fields WHERE profile_key = ? ORDER BY ord', key)
      .map((r) => trimTail([r.id, r.name, r.value, r.source, r.status])),
    metrics: readMetrics(db, key),
  };
  /* 没有这一节就整键省略（不是 null）：演示数据里"未手术"就是没有 surgery 这个键，
     返回 null 会让 parity 判成不一致，前端也会多出一条空卡片。 */
  for (const section of ['pathology', 'risk', 'pathway', 'surgery', 'meds', 'adherence',
    'sideEffects', 'imaging', 'monitor', 'bleeds', 'nutrition']) {
    if (profile[section] === null) delete profile[section];
  }
  return profile;
}

export function listSubjects(db) {
  return rows(db, 'SELECT profile_key, name, meta FROM subjects ORDER BY profile_key');
}

export function getProfile(db, key) {
  return readProfile(db, key);
}

/** `/api/bootstrap` 的 payload。version/build 由调用方注入（唯一来源 lib/version.js）。 */
export function bootstrap(db, { version, build } = {}) {
  const profiles = {};
  for (const s of listSubjects(db)) profiles[s.profile_key] = readProfile(db, s.profile_key);
  const trials = rows(db, 'SELECT nct_id AS id, title, phase, status, sponsor, url FROM trials ORDER BY rowid');
  const meta = {};
  for (const r of rows(db, 'SELECT k, v FROM demo_meta')) meta[r.k] = r.v;
  return {
    version: version ?? null,
    build: build ?? null,
    profiles,
    trials,
    demo_meta: meta,
    agent: { available: true, mode: 'dev-mount' },
    layout: { agentPane: AGENT_PANE },
  };
}
