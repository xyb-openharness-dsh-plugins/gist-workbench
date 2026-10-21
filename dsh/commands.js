/* 写命令：五个入口对应「一天里最常记的五件事」。
 *
 * 为什么只有五个：
 *   1. 服药记录 adherence_rows   —— 「今天吃了没」
 *   2. 不良事件 side_effect_rows —— 「今天有什么反应」
 *   3. 指标点   metric_points    —— 「这次化验多少」
 *   4. 自己的看法 viewpoints     —— 「我怎么想的」
 *   5. 进食记录 nutrition_rows   —— 「这顿吃了什么、吃完怎么样」
 *
 * 其它表（病理、危险度、手术、线序、剂量变更）属于"医生给的事实"，
 * 录入路径要走「资料上传 → 候选 → 逐条核对」，不能走随手填。所以本段不做。
 *
 * 三条硬约束（家族契约落到写侧）：
 *   ① 看法恒不为结论：viewpoints 只存原话与心情，不设结论字段，返回值里也不出现"结论"字样；
 *   ② 更正只新增版本：同一天同一件事改了内容，追加一行 ord+1，不 UPDATE、不 DELETE；
 *   ③ 不猜：档案不存在、指标未定义、日期格式不对，一律报错返回，不替用户建一条“看起来合理”的记录。
 *
 * 幂等：同一个自然键（档案 + 日期 + 药物/事件名）内容完全相同，返回 `unchanged` 且不写库，
 * 前端重复点击不会把同一条记录记两遍。
 */

import { StoreError } from './store.js';

/** 写命令的可诊断异常。status 直接给 HTTP 层用，message 是可以给用户看的人话。 */
export class CommandError extends StoreError {
  constructor(code, message, status = 400) {
    super(code, message);
    this.status = status;
  }
}

const MAX_TEXT = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------------- 校验 ---------------- */

function assertSubject(db, profile) {
  if (typeof profile !== 'string' || !profile.trim()) {
    throw new CommandError('PROFILE_REQUIRED', '缺少档案标识：这条记录属于哪一位');
  }
  const row = db.prepare('SELECT profile_key FROM subjects WHERE profile_key = ?').get(profile);
  if (!row) throw new CommandError('PROFILE_NOT_FOUND', `没有这个档案：${profile}`, 404);
  return profile;
}

/** 日期必须是真实存在的 YYYY-MM-DD，且不晚于今天（提前记未来的事没有意义，通常意味着填错）。 */
function assertDate(d, today = () => new Date().toISOString().slice(0, 10)) {
  if (typeof d !== 'string' || !DATE_RE.test(d)) {
    throw new CommandError('DATE_INVALID', '日期要写成 YYYY-MM-DD，例如 2026-10-21');
  }
  const parsed = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== d) {
    throw new CommandError('DATE_INVALID', `这一天不存在：${d}`);
  }
  if (d > today()) throw new CommandError('DATE_FUTURE', `日期不能晚于今天：${d}`);
  return d;
}

function text(v, field, { required = false, max = MAX_TEXT } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new CommandError('FIELD_REQUIRED', `缺少必填内容：${field}`);
    return null;
  }
  if (typeof v !== 'string') throw new CommandError('FIELD_TYPE', `${field} 必须是文本`);
  const s = v.trim();
  if (!s) {
    if (required) throw new CommandError('FIELD_REQUIRED', `缺少必填内容：${field}`);
    return null;
  }
  if (s.length > max) throw new CommandError('FIELD_TOO_LONG', `${field} 最多 ${max} 个字`);
  return s;
}

/** 在事务里算出 ord（并发时也不撞），失败统一回滚。 */
function inTx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* 回滚失败时保留原始错误更有用 */ }
    throw error;
  }
}

const nextOrd = (db, table, where, args) =>
  (db.prepare(`SELECT COALESCE(MAX(ord), 0) + 1 AS n FROM ${table} WHERE ${where}`).get(...args).n);

/* ---------------- ① 服药记录 ---------------- */

const ADHERENCE_COLS = 'profile_key, d, drug, planned, taken, note, ord';

/**
 * 记一天的服药：按计划 / 漏服 / 减量。
 * @param {object} input { profile, date, drug, planned, taken, note }
 *   planned 与 taken 都按原文存（"400 mg" / "漏服" / "减到 300 mg"），不做依从率、不做评价。
 */
export function recordAdherence(db, input = {}) {
  const profile = assertSubject(db, input.profile);
  const d = assertDate(input.date);
  const drug = text(input.drug, '药物', { required: true, max: 80 });
  const planned = text(input.planned, '计划剂量', { max: 80 });
  const taken = text(input.taken, '实际服药', { max: 80 });
  const note = text(input.note, '备注');
  if (!planned && !taken) throw new CommandError('FIELD_REQUIRED', '计划剂量与实际服药至少写一项');

  return inTx(db, () => {
    const prev = db.prepare(
      `SELECT ${ADHERENCE_COLS} FROM adherence_rows
       WHERE profile_key = ? AND d = ? AND drug = ? ORDER BY ord DESC LIMIT 1`
    ).get(profile, d, drug);
    // 幂等：同一天同一药，内容完全一样就不再写一行
    if (prev && prev.planned === planned && prev.taken === taken && prev.note === note) {
      return { ok: true, status: 'unchanged', row: prev };
    }
    const ord = nextOrd(db, 'adherence_rows', 'profile_key = ? AND d = ? AND drug = ?', [profile, d, drug]);
    db.prepare(`INSERT INTO adherence_rows (${ADHERENCE_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(profile, d, drug, planned, taken, note, ord);
    // 有旧行且内容不同 → 这是更正，旧行保留（契约②）
    return { ok: true, status: prev ? 'superseded' : 'created', row: { profile_key: profile, d, drug, planned, taken, note, ord } };
  });
}

/* ---------------- ② 不良事件 ---------------- */

const SIDE_COLS = 'profile_key, d, term, grade, action, note, ord';

/**
 * 记一条反应：term 用报告/医生的写法，grade 抄 CTCAE 分级原文。
 * action 记实际处理（继续 / 减量 / 暂停 / 对症），不判断该不该停药。
 */
export function recordSideEffect(db, input = {}) {
  const profile = assertSubject(db, input.profile);
  const d = assertDate(input.date);
  const term = text(input.term, '症状名称', { required: true, max: 80 });
  const grade = text(input.grade, '分级');
  const action = text(input.action, '处理方式', { max: 120 });
  const note = text(input.note, '备注', { max: 400 });

  return inTx(db, () => {
    const prev = db.prepare(
      `SELECT ${SIDE_COLS} FROM side_effect_rows
       WHERE profile_key = ? AND d = ? AND term = ? ORDER BY ord DESC LIMIT 1`
    ).get(profile, d, term);
    if (prev && prev.grade === grade && prev.action === action && prev.note === note) {
      return { ok: true, status: 'unchanged', row: prev };
    }
    const ord = nextOrd(db, 'side_effect_rows', 'profile_key = ? AND d = ? AND term = ?', [profile, d, term]);
    db.prepare(`INSERT INTO side_effect_rows (${SIDE_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(profile, d, term, grade, action, note, ord);
    return { ok: true, status: prev ? 'superseded' : 'created', row: { profile_key: profile, d, term, grade, action, note, ord } };
  });
}

/* ---------------- ③ 指标点 ---------------- */

/**
 * 记一次检查结果。
 * 数值指标必须给数字（字符串 "11.2" 也收，但落库是 REAL）；分类/等级指标给原文。
 * 指标必须在 metrics 里已定义——工作台不替用户新建指标，否则一图秀会多出一条没人认识的线。
 */
export function recordMetricPoint(db, input = {}) {
  const profile = assertSubject(db, input.profile);
  const key = text(input.metric, '指标', { required: true, max: 40 });
  const d = assertDate(input.date);
  const src = text(input.src, '来源', { max: 120 });

  const metric = db.prepare('SELECT key, name, kind, dec FROM metrics WHERE profile_key = ? AND key = ?').get(profile, key);
  if (!metric) throw new CommandError('METRIC_NOT_FOUND', `这个档案里没有指标「${key}」，先确认指标名`, 404);

  const numeric = !metric.kind || metric.kind === 'numeric';
  let vNum = null;
  let vText = null;
  if (numeric) {
    const raw = typeof input.value === 'string' ? input.value.trim() : input.value;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) throw new CommandError('VALUE_NOT_NUMERIC', `「${metric.name}」是数值指标，要填数字`);
    if (n <= 0) throw new CommandError('VALUE_OUT_OF_RANGE', `「${metric.name}」的测量值必须大于 0`);
    vNum = metric.dec === null ? n : Number(n.toFixed(Math.min(metric.dec, 4)));
  } else {
    vText = text(input.value, `${metric.name} 的取值`, { required: true, max: 80 });
  }

  return inTx(db, () => {
    const prev = db.prepare(
      `SELECT d, v_num, v_text, src, ord FROM metric_points
       WHERE profile_key = ? AND metric_key = ? AND d = ? ORDER BY ord DESC LIMIT 1`
    ).get(profile, key, d);
    if (prev && prev.v_num === vNum && prev.v_text === vText && prev.src === src) {
      return { ok: true, status: 'unchanged', point: { d, v: numeric ? vNum : vText, src } };
    }
    const ord = nextOrd(db, 'metric_points', 'profile_key = ? AND metric_key = ? AND d = ?', [profile, key, d]);
    db.prepare(`INSERT INTO metric_points (profile_key, metric_key, d, v_num, v_text, src, ord) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(profile, key, d, vNum, vText, src, ord);
    // 同一天改数值 = 更正，旧值保留成前一版（契约②），读模型按 ord 取最后一条
    return { ok: true, status: prev ? 'superseded' : 'created', point: { d, v: numeric ? vNum : vText, src } };
  });
}

/* ---------------- ④ 自己的看法 ---------------- */

/**
 * 记一条「我怎么想的」。只存原话，不判断对错、不生成摘要、不进趋势。
 * 返回里刻意不带任何"结论/评估"字段——看法恒不为结论。
 */
export function recordViewpoint(db, input = {}) {
  const profile = assertSubject(db, input.profile);
  const d = assertDate(input.date);
  const mood = text(input.mood, '心情', { max: 20 });
  const body = text(input.text, '想记的内容', { required: true, max: 800 });

  return inTx(db, () => {
    const prev = db.prepare(
      'SELECT d, mood, text, ord FROM viewpoints WHERE profile_key = ? AND d = ? ORDER BY ord DESC LIMIT 1'
    ).get(profile, d);
    if (prev && (prev.mood ?? null) === mood && prev.text === body) {
      return { ok: true, status: 'unchanged', row: { d, mood, text: body } };
    }
    const ord = nextOrd(db, 'viewpoints', 'profile_key = ? AND d = ?', [profile, d]);
    db.prepare('INSERT INTO viewpoints (profile_key, d, mood, text, ord) VALUES (?, ?, ?, ?, ?)')
      .run(profile, d, mood, body, ord);
    return { ok: true, status: 'created', row: { d, mood, text: body } };
  });
}

/* ---------------- ⑤ 进食记录 ---------------- */

const NUTRITION_COLS = 'profile_key, d, slot, amount, foods, symptoms, note, ord';

/**
 * 记一笔进食：餐次、份量、吃了什么、吃完有什么症状（原话）。
 * 不做热量换算、不做食材替换建议、不给食谱——表里就没有这些字段。
 */
export function recordNutrition(db, input = {}) {
  const profile = assertSubject(db, input.profile);
  const d = assertDate(input.date);
  const slot = text(input.slot, '餐次', { required: true, max: 20 });
  const amount = text(input.amount, '份量', { max: 40 });
  const foods = text(input.foods, '吃了什么', { max: 200 });
  const symptoms = text(input.symptoms, '症状', { max: 120 });
  const note = text(input.note, '备注', { max: 300 });
  if (!foods && !amount) throw new CommandError('FIELD_REQUIRED', '份量与吃了什么至少写一项');

  return inTx(db, () => {
    const prev = db.prepare(
      `SELECT ${NUTRITION_COLS} FROM nutrition_rows
       WHERE profile_key = ? AND d = ? AND slot = ? ORDER BY ord DESC LIMIT 1`
    ).get(profile, d, slot);
    if (prev && prev.amount === amount && prev.foods === foods && prev.symptoms === symptoms && prev.note === note) {
      return { ok: true, status: 'unchanged', row: prev };
    }
    const ord = nextOrd(db, 'nutrition_rows', 'profile_key = ? AND d = ? AND slot = ?', [profile, d, slot]);
    db.prepare(`INSERT INTO nutrition_rows (${NUTRITION_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(profile, d, slot, amount, foods, symptoms, note, ord);
    return { ok: true, status: prev ? 'superseded' : 'created', row: { profile_key: profile, d, slot, amount, foods, symptoms, note, ord } };
  });
}

/* ---------------- ⑥ 候选核对 ---------------- */

const CAND_STATUS = new Set(['待核对', 'accepted', 'rejected']);

/**
 * 核对一条候选字段：待核对 → 接受 / 驳回。
 *
 * 为什么这里可以 UPDATE：候选是「从原件里抄出来、还没被确认的一句话」，
 * 核对只是改它自己的审核状态与转录值，**不动事实表**（病理 / 指标 / 用药各自另有行）。
 * 契约② 约束的是事实记录的更正，不是审核状态流转。
 */
export function reviewCandidate(db, input = {}) {
  const profile = assertSubject(db, input.profile);
  const id = text(input.id, '候选编号', { required: true, max: 60 });
  const status = text(input.status, '核对结果', { required: true, max: 20 });
  if (!CAND_STATUS.has(status)) {
    throw new CommandError('STATUS_INVALID', `核对结果只能是「待核对 / accepted / rejected」，收到：${status}`);
  }

  const found = db.prepare('SELECT id, name, value, status FROM candidate_fields WHERE profile_key = ? AND id = ?')
    .get(profile, id);
  if (!found) throw new CommandError('CANDIDATE_NOT_FOUND', `没有这条候选：${id}`, 404);

  const value = text(input.value, '转录内容', { max: 500 }) ?? found.value;

  return inTx(db, () => {
    // 只改这一行的转录值与审核状态；原文出处（source）不动
    db.prepare('UPDATE candidate_fields SET value = ?, status = ? WHERE profile_key = ? AND id = ?')
      .run(value, status, profile, id);
    return { ok: true, status: found.status === status && found.value === value ? 'unchanged' : 'updated', row: { id, value, status } };
  });
}

/* ---------------- 路由表 ----------------
 * server.js 只认这张表：加命令 = 加一行，不在 HTTP 层再写一遍分派。 */
export const COMMANDS = {
  '/api/adherence': recordAdherence,
  '/api/side-effects': recordSideEffect,
  '/api/metric-points': recordMetricPoint,
  '/api/viewpoints': recordViewpoint,
  '/api/nutrition': recordNutrition,
  '/api/candidates': reviewCandidate,
};
