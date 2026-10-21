'use strict';
/* 开发版 —— 源自 prototypes/v0.2/app.js v0.1.0（定稿原型，勿改那份）。
   逐行迁移，除「数据加载方式」与「AI 面板五态」外与原型保持一致；改动点逐条列在下边：
   1) 数据不再从 window.DEMO_DATA 同步读取，改为 loadBootstrap() 异步拉 GET /api/bootstrap
      （返回 {version, profiles, trials, layout, agent}），成功后用同一套循环构建 PROFILES /
      METRICS / EVENTS / DASH_KEYS / DOCS / CANDS / TRIALS，中间结构与原型完全一样。
   2) fetch 失败且存在 window.DEMO_DATA 时回退用它（便于离线比对）；两者都拿不到时在 #main
      渲染明确的错误说明，不白屏。
   3) 初始化改为 loadBootstrap().then(init)（原型是顶层同步 render()）；事件注册仍在顶层。
   4) 仍是普通脚本：没有 import / export / 顶层 await，parity 测试要在 Node 里 new Function(src)() 跑它。
   5) 版本号文本：bootstrap 返回 version/build 时同步到 #ver-chip / #app-version / #app-build
      （原型是写死在 HTML 里的 v0.1.0）。这一处不在 VIEWS 输出里，parity 测试已白名单放行。
   其余：11 个视图（含「资料库」页）、二级页签分流、一图秀引擎（单调三次插值 + 每指标配色 +
   疗程泳道 + 副作用分级节点 + 缩放 + pin）、AI 对话面板（五态 + × 收起 + 可拖分隔条 + 三档）、
   上传与候选核对、data-countup 数字滚动、prefers-reduced-motion 降级，全部与原型一致。 */

const APP_INFO = {
  version: '0.1.0',
  build: '2026-10-21',
  channel: 'dev',
  channelLabel: '开发版 · 本机优先',
  dataSource: 'api'
};
APP_INFO.displayVersion = `v${APP_INFO.version}`;

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let uidSeq = 0;
const uid = (p) => p + (++uidSeq);

/* ---------------- icons & nav ---------------- */
const icons = {
  home: 'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
  badge: 'M12 3l7 4v10l-7 4-7-4V7ZM9 12l2 2 4-4',
  drip: 'M12 3v6m0 0a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM7 7h10',
  /* 胶囊：靶向药是长期口服，用倾斜胶囊 + 中线表示 */
  pill: 'M14.6 3.4a4.2 4.2 0 0 1 6 6L10.4 19.6a4.2 4.2 0 0 1-6-6ZM12 6l6 6',
  /* 病理切片：方形玻片 + 中央组织块 */
  slide: 'M4 4h16v16H4ZM8 8h8v8H8',
  /* 切除：一条切除线 + 缝合点 */
  cut: 'M4 12h16M7 12v-3m4 3v-3m4 3v-3m4 3v-3',
  lab: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7 15h10',
  chart: 'M4 3v17h17M7 14l4-5 4 3 5-7',
  leaf: 'M20 4c-9.4 0-15 4.1-15 9.6A5.4 5.4 0 0 0 10.4 19C16 19 20 13.4 20 4ZM5.5 18.6C8 13.4 12 10.6 17 9.6',
  heart: 'M12 20.3c-4.6-2.9-7.4-5.6-7.4-9A4.1 4.1 0 0 1 12 8.4a4.1 4.1 0 0 1 7.4 2.9c0 3.4-2.8 6.1-7.4 9Z',
  calendar: 'M4 5h16v16H4ZM8 3v4m8-4v4M4 10h16m-12 4h2m4 0h2m-8 3h2',
  flask: 'M9 3h6v5l5 9a2 2 0 0 1-2 3H6a2 2 0 0 1-2-3l5-9Z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
  chat: 'M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H10l-6 5V5ZM8 8h8M8 11h5'
};
/* 看板任务卡用的是页面键，图标表里叫 folder / calendar / lab，这里做一次别名，
   避免拼错键时静默输出 d="undefined" 的空 path（控制台会报 moveto 错误）。 */
const ICON_ALIAS = { records: 'folder', review: 'calendar', labs: 'lab', timeline: 'chart', mind: 'heart',
  nutrition: 'leaf', treatment: 'drip', pathology: 'slide', meds: 'pill', trials: 'flask',
  dashboard: 'home', prep: 'calendar', cut: 'cut' };
const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[k] || icons[ICON_ALIAS[k]] || icons.badge}"/></svg>`;

/* 11 个一级页：看板 → 病情整理 → 病理与危险度 → 治疗历程 → 靶向用药 → 检查与指标
   → 一图秀 → 生活与营养 → 心理支持 → 复诊准备 → 临床研究。
   「靶向用药」独立成页：GIST 的日常几乎全在长期口服 TKI 上，塞进「治疗历程」会挤掉剂量与漏服。 */
const PAGES = [
  ['dashboard', '看板', 'home'], ['records', '病情整理', 'folder'], ['pathology', '病理与危险度', 'slide'],
  ['treatment', '治疗历程', 'drip'], ['meds', '靶向用药', 'pill'], ['labs', '检查与指标', 'lab'],
  ['timeline', '病情一图秀', 'chart'], ['nutrition', '生活与营养', 'leaf'], ['mind', '心理支持', 'heart'],
  ['review', '复诊准备', 'calendar'], ['trials', '临床研究', 'flask']
];
const SUBPAGES = {
  records: ['资料库', '整理草稿 / 核对', '病情档案', '指标检测', '病情汇总'],
  pathology: ['病理与免疫组化', '危险度分级', '分子与基因'],
  treatment: ['治疗路径与线序', '手术记录', '疗程与周期'],
  meds: ['当前用药', '剂量变更', '服药与漏服', '副作用记录'],
  labs: ['血象与生化', '药物浓度', '影像与复查'],
  timeline: ['数值曲线', '分类与事件', '数据口径'],
  nutrition: ['进食记录', '体重与营养'],
  mind: ['当下感受', '用药与身体', '家庭沟通'],
  review: ['复查节奏', '出血与急症', '就诊准备'],
  trials: ['2026 线索', '已收藏', '入组问题']
};
const SUBTITLES = {
  dashboard: '危险度、用药、复查与指标放在一起，让下一次讨论有据可查。',
  records: '上传 → 解析 → 确认指标 → 入库；原件永远保留，接受之前都只是候选。',
  pathology: '部位、大小、核分裂、破裂是四个独立事实；危险度按多套体系分别记录，不由工作台推算。',
  treatment: '手术、辅助、晚期线序按事实记录；路径切换只新增、不覆盖。',
  meds: '长期口服药的剂量、漏服与副作用逐条留痕；不评价该不该吃、也不建议加减量。',
  labs: '血象与肝肾功能是主线；药物浓度与影像按报告原文逐次归档。',
  timeline: '血红蛋白、体重与乏力分级放回同一段时间里，看见变化发生在哪一步。',
  nutrition: '术后食量、体重与营养指标一起看；不给食谱，也不给补充剂剂量。',
  mind: '害怕、疲惫、不想说话都算正常反应；这里的内容默认只属于你。',
  review: '该带什么、该问什么，提前写下来，诊室里就不用凭记忆。',
  trials: '线索不是推荐；先弄清入组条件，再决定要不要问。'
};

/* ---------------- 数据层（开发版：后端 GET /api/bootstrap；结构与原型 demo-data.js 一致） ----------------
   原型这里是 `const D = window.DEMO_DATA;` + 顶层同步构建；开发版把同样的构建过程收进 buildData(D)，
   由 loadBootstrap() 拿到数据后再调用。循环体保持原型的原始缩进不重排，便于逐行 diff。 */
/* 接口基址：独立启动（页面在 `/`）是空串；装进 Desktop 后页面在
   `/api/gist/ui/`，接口前缀就是 `/api/gist`。
   约定的名字只在 dsh/index.js 的 API_PREFIX 出现一次，改那边要同步这里。 */
function apiBase() {
  const path = (typeof location !== 'undefined' && location.pathname) || '';
  return path.indexOf('/api/gist/ui') === 0 ? '/api/gist' : '';
}
function loadBootstrap() {
  const fallback = (typeof window !== 'undefined' && window.DEMO_DATA) || null;
  const endpoint = `${apiBase()}/api/bootstrap`;
  let p;
  try { p = fetch(endpoint); } catch (e) { p = Promise.reject(e); }
  return Promise.resolve(p)
    .then((r) => {
      if (!r || r.ok === false) throw new Error('bootstrap 响应不可用' + (r && r.status ? `（HTTP ${r.status}）` : ''));
      return r.json();
    })
    .then((j) => {
      if (!j || !j.profiles) throw new Error('bootstrap 返回缺少 profiles');
      return j;
    })
    .catch((err) => {
      if (fallback) { APP_INFO.dataSource = 'demo-fallback'; return fallback; }
      throw err;
    });
}
const PROFILES = {}, METRICS = {}, EVENTS = {}, DASH_KEYS = {}, DOCS = {}, CANDS = {};
let TRIALS = [];
function buildData(D) {
for (const [k, p] of Object.entries(D.profiles)) {
  /* 字段逐条显式列出：生成器加字段时这里会同步补，不会静默丢字段。
     GIST 专属：pathology / risk / pathway / surgery / meds / dose / adherence / sideEffects /
     imaging / monitor / bleeds / nutrition（食管癌那套 swallow / access / dilation / endoscopy 不许抄回来）。 */
  PROFILES[k] = { name: p.name, sex: p.sex, age: p.age, meta: p.meta, headline: p.headline, stage: p.stage, mindset: p.mindset,
    molecular: p.molecular, path: p.path, lines: p.lines, cycles: p.cycles, rhythm: p.rhythm,
    pathology: p.pathology || null, risk: p.risk || null, pathway: p.pathway || null, surgery: p.surgery || null,
    meds: p.meds || null, dose: p.dose || null, adherence: p.adherence || null, sideEffects: p.sideEffects || null,
    imaging: p.imaging || null, monitor: p.monitor || null, bleeds: p.bleeds || null, nutrition: p.nutrition || null,
    viewpoints: p.viewpoints, activity: p.activity, familyTalk: p.familyTalk,
    docs: p.docs || [], candidates: p.candidates || [] };
  METRICS[k] = {};
  for (const m of p.metrics) METRICS[k][m.key] = m;
  /* 事件在 demo-data 里是 [日期, 名称] 定长数组；一图秀泳道与时间域都按 {d,label} 读，
     不归一化会让 dataBounds() 拿到 undefined → toISOString 抛 RangeError、整页渲染中断。 */
  EVENTS[k] = (p.events || []).map(e => Array.isArray(e) ? { d: e[0], label: e[1] } : e);
  DASH_KEYS[k] = p.dash_keys;
  /* 资料与候选在 demo-data 里是定长数组（id / 名称 / 日期 / 类型 / 状态），
     必须显式映射：直接展开数组只会得到 0..4 的数字键，页面里读 d.name 全是 undefined。 */
  DOCS[k] = (p.docs || []).map(d => ({ id: d[0], name: d[1], fileName: d[1], date: d[2], type: d[3], status: d[4] }));
  CANDS[k] = (p.candidates || []).map(c => ({ id: c[0], name: c[1], value: c[2], source: c[3],
    status: c[4] === '已接受' ? 'accepted' : 'candidate' }));
}
/* 原型：const TRIALS = D.trials;（顶层 const）。开发版改为在函数内赋值，并同步后端版本号。 */
  TRIALS = D.trials || [];
  /* 面板宽度参数以接口为准（唯一来源 lib/layout.js）；没给就保留兜底值。 */
  if (D.layout && D.layout.agentPane) {
    AGENT_PANE = { ...AGENT_PANE, ...D.layout.agentPane };
    state.agentRatio = AGENT_PANE.def;
  }
  /* 宿主未提供原生会话时（bootstrap 显式声明 agent.available=false），主按钮进 unavailable 态：
     禁用 + 说明降级原因，绝不自建聊天框（交互合同 20 号：缺位时走剪贴板回退）。 */
  if (D.agent && D.agent.available === false) {
    state.agentPhase = 'unavailable';
    if (D.agent.note) AGENT_HINT.unavailable = String(D.agent.note);
  }
  if (D.version) APP_INFO.version = String(D.version);
  if (D.build) APP_INFO.build = String(D.build);
  APP_INFO.displayVersion = `v${APP_INFO.version}`;
}

/* ---------------- AI 会话：五态文案（与 prompts/DSH-WORKBENCH-TOP-BAR.md §5 的按钮文案表一致） ----------------
   状态机只用这五个词，不自造文案：
   idle 无会话 / connecting 连接中（禁用，防重复创建）/ open 已展开（点它＝收起面板，不结束会话）
   closed 已收起（点它＝回到同一会话，草稿还在）/ unavailable 服务缺失（禁用并在说明里写降级原因）。 */
const AGENT_LABEL = { idle: 'AI 对话', connecting: '正在连接…', open: '收起 AI 对话', closed: '打开 AI 对话', unavailable: 'AI 对话暂不可用' };
const AGENT_HINT = {
  idle: '点「AI 对话」打开右侧会话面板；× 只是收起，不会结束会话。',
  connecting: '正在调起会话…（此时按钮禁用，避免重复创建）。',
  open: '可拖动中间那条分隔条调整面板宽度（25%–45%），键盘 ←/→ 也行；× 只是收起，不会结束会话。',
  closed: '会话还在，点「打开 AI 对话」回到刚才那一段；不会重新开始。',
  unavailable: '宿主没有提供原生会话：可用面板里的「整理本页要点」复制提示词，粘贴到会话里发送。'
};

/* ---------------- state ---------------- */
/* 一图秀默认：血红蛋白 + 体重两条数值线 + 乏力分级（分类节点，不连线）。
   进页面先看"贫血有没有改善、体重掉没掉、副作用在几级"，而不是药物浓度。 */
/* 面板宽度区间来自 bootstrap 的 layout.agentPane（唯一来源 lib/layout.js）；
   接口没给时用同一组数字兜底，保证离线/回退路径也能拖动。 */
let AGENT_PANE = { min: 0.25, max: 0.45, def: 0.35, step: 24, presets: { narrow: 0.25, std: 0.35, wide: 0.45 } };
const AGENT_STORE_KEY = 'xyb-gist-agent-ratio';
const state = { view: 'dashboard', profile: 'A', agentPhase: 'idle', agentSize: 'std', agentRatio: AGENT_PANE.def, sel: ['hgb', 'wt', 'fatigue'],
  range: 'all', zoom: 100, toggles: { treatment: true, keypoints: true }, pin: null, saved: [], sub: {},
  query: '', parsing: false, parseError: false, loaded: {}, parsingName: '', lastUpload: null, uploads: 0, mineru: null };
/* 换档案后的默认选择必须与初始状态同构：两条数值线（血红蛋白 / 体重）+ 第一条分级指标。
   只挑数值会把副作用丢掉，一图秀就退化成两条线。 */
const defaultSel = (k) => {
  const m = METRICS[k] || {};
  const num = (DASH_KEYS[k] || []).filter((c) => m[c] && numPts(m[c]).length).slice(0, 2);
  const out = num.slice();
  const qual = (DASH_KEYS[k] || []).find((c) => m[c] && !numPts(m[c]).length) ||
    Object.keys(m).find((c) => m[c].points.length && !numPts(m[c]).length);
  if (qual) out.push(qual);
  return out.slice(0, 4);
};
const P = () => PROFILES[state.profile];
const M = () => METRICS[state.profile];

/* ---------------- helpers ---------------- */
const fmtDate = (d) => d;
const delta = (m) => {
  if (!m.points || m.points.length < 2) return null;
  const a = m.points[m.points.length - 1], b = m.points[m.points.length - 2];
  if (typeof a.v !== 'number' || typeof b.v !== 'number') return null;
  const d = a.v - b.v;
  return { text: (d > 0 ? '+' : '') + d.toFixed(m.dec ?? 1), up: d > 0, from: b.d };
};
function sparkline(m, w = 200, h = 44) {
  const pts = (m.points || []).filter(p => typeof p.v === 'number');
  if (pts.length < 2) return '';
  const vs = pts.map(p => p.v);
  let lo = Math.min(...vs), hi = Math.max(...vs); if (hi === lo) { hi += 1; lo -= 1; }
  const X = i => 4 + (w - 8) * i / (pts.length - 1);
  const Y = v => h - 5 - (h - 10) * (v - lo) / (hi - lo);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  const dots = pts.map((p, i) => `<circle class="sp-dot" cx="${X(i).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="2.6" fill="${m.color}"/>`).join('');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path class="base" d="M4 ${h - 5}H${w - 4}"/><path class="sp-line" d="${path}" stroke="${m.color}"/>${dots}</svg>`;
}
/* 3D 翻面（24-METRIC-TREND-TAB-DESIGN §5）：点整卡转 180°，再点返回；
   data-flipped 是唯一的视觉开关，aria-pressed 只为兼容旧样式保留；
   两面互换 aria-hidden，隐藏面不进读屏顺序。分类记录（data-static）不翻。 */
function flipCard(key) {
  const el = document.querySelector(`[data-mcard="${key}"]`);
  if (!el || el.dataset.static) return;
  const on = el.dataset.flipped !== 'true';
  el.dataset.flipped = String(on);
  el.setAttribute('aria-pressed', String(on));
  const front = el.querySelector('[data-face="front"]');
  const back = el.querySelector('[data-face="back"]');
  if (front) front.setAttribute('aria-hidden', String(on));
  if (back) back.setAttribute('aria-hidden', String(!on));
}
function mcard(key, m) {
  const last = (m.points || []).slice(-1)[0];
  if (!last) return '';
  const numeric = typeof last.v === 'number' && m.dec !== null;
  const d = delta(m);
  const cat = `<span class="cat"><i style="background:${m.color}"></i>${esc(m.cat)}</span>`;
  if (!numeric) {
    return `<div class="mcard" data-mcard="${key}" data-static="1" role="group" aria-roledescription="指标卡"
      aria-label="${esc(m.name)}：${esc(String(last.v))}（分级记录，只按原文记录，不连折线）">
      <span class="mface front" data-face="front">${cat}<span class="name">${esc(m.name)}</span>
      <span class="na">${esc(last.v)}</span>
      <span class="meta"><span>${esc(last.src)}</span><span class="hint">分级记录</span></span></span></div>`;
  }
  const band = m.band ? `<span class="rec">参考 ${m.band[0]}–${m.band[1]} ${esc(m.unit)}</span>` : `<span class="rec">${esc(last.d)} · ${esc(last.src)}</span>`;
  return `<div class="mcard" role="group" tabindex="0" data-mcard="${key}" data-flipped="false" aria-roledescription="指标卡"
    aria-label="${esc(m.name)} 最近 ${last.v.toFixed(m.dec ?? 1)} ${esc(m.unit)}（${esc(last.d)}）；点一下翻面看趋势">
    <span class="mcard-inner">
    <span class="mface front" data-face="front">${cat}<span class="name">${esc(m.name)}</span>
      <span class="val"><span data-countup="${last.v}" data-dec="${m.dec ?? 1}">${last.v.toFixed(m.dec ?? 1)}</span><small>${esc(m.unit)}</small></span>
      ${d ? `<span class="delta">较上次 <em>${d.text}${m.unit ? ' ' + esc(m.unit) : ''}</em>（${esc(d.from)}）</span>` : ''}
      ${band}</span>
    <span class="mface back" data-face="back" aria-hidden="true">${cat}<span class="name">${esc(m.name)}</span>
      ${sparkline(m, 190, 40)}
      <span class="meta"><span>${esc(m.note)}</span><span class="hint">轻点翻回</span></span></span>
    </span></div>`;
}
/* ---------------- 一图秀引擎（统一画布 · 多序列归一化 · 移植淋巴瘤基因） ---------------- */
const CW = 980, CH = 420, CX0 = 62, CX1 = 954, CY0 = 132, CY1 = 366;
const CAT_ORDER = ['血象', '生化', '营养', '药物浓度', '用药与症状'];
const fmtNum = (v, dec) => typeof v === 'number' ? v.toFixed(dec ?? 1) : String(v ?? '');
const shortDate = (d) => d.slice(5).replace('-', '.');
const longDate = (d) => d;
const numPts = (m) => (m.points || []).filter(p => typeof p.v === 'number');
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

function dataBounds() {
  const ds = [];
  for (const m of Object.values(M())) for (const p of m.points) ds.push(p.d);
  for (const e of (EVENTS[state.profile] || [])) ds.push(e.d);
  ds.sort();
  return [Date.parse(ds[0]), Date.parse(ds[ds.length - 1])];
}
function domain() {
  const [s, e] = dataBounds();
  const months = { '3m': 3, '6m': 6, '12m': 12 }[state.range];
  const start = months ? new Date(new Date(e).setMonth(new Date(e).getMonth() - months)) : new Date(s);
  const span = e - start.getTime();
  const kept = span * state.zoom / 100;
  return [e - kept, e];
}
const inDomain = (d, t0, t1) => { const t = Date.parse(d); return t >= t0 && t <= t1; };
const xOf = (t, t0, t1) => CX0 + (t - t0) / Math.max(1, t1 - t0) * (CX1 - CX0);

/* 单调三次插值（Fritsch-Carlson，同 d3 curveMonotoneX）：
   只平滑折线，且保证曲线段不越过相邻数据点的 y 范围——不会出现"过冲鼓包"式变形 */
function smoothPath(coords) {
  const n = coords.length;
  if (!n) return '';
  if (n === 1) return `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  const dx = [], slope = [];
  for (let i = 0; i < n - 1; i++) {
    const ddx = coords[i + 1].x - coords[i].x;
    dx.push(ddx);
    slope.push(ddx ? (coords[i + 1].y - coords[i].y) / ddx : 0);
  }
  const tan = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) tan.push(0);           // 拐点处切线置平，防鼓包
    else {
      const w1 = 2 * dx[i] + dx[i - 1], w2 = dx[i] + 2 * dx[i - 1];
      tan.push((w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i])); // 调和加权，保证单调
    }
  }
  tan.push(slope[n - 2]);
  let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = coords[i].x + dx[i] / 3, c1y = coords[i].y + tan[i] * dx[i] / 3;
    const c2x = coords[i + 1].x - dx[i] / 3, c2y = coords[i + 1].y - tan[i + 1] * dx[i] / 3;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${coords[i + 1].x.toFixed(1)} ${coords[i + 1].y.toFixed(1)}`;
  }
  return d;
}

/* 治疗条：疗程带（术后 / 辅助 / 各线）+ 评估标记（手术 / 换药 / 减量），两行独立于数据区 */
function bandsFor(t0, t1) {
  const p = P(), items = [];
  p.cycles.forEach((c, i) => {
    const from = c[1];
    const to = c[4] && p.cycles[i + 1] ? p.cycles[i + 1][1] : addDays(from, 42);
    items.push({ kind: 'cycle', from, to, label: c[0], color: '#1b4f8a' });
  });
  (EVENTS[state.profile] || []).forEach((e) => {
    if (/手术|换药|减量|加量|开始/.test(e.label)) items.push({ kind: 'mark', from: e.d, to: e.d, label: e.label, color: /手术/.test(e.label) ? '#a03d5c' : '#9a6410' });
  });
  return items.filter((tr) => Date.parse(tr.to) >= t0 && Date.parse(tr.from) <= t1)
    .sort((a, b) => Date.parse(a.from) - Date.parse(b.from))
    .map((tr, lane) => { const s = Math.max(Date.parse(tr.from), t0), e2 = Math.min(Date.parse(tr.to), t1); return { ...tr, x1: xOf(s, t0, t1), x2: xOf(e2, t0, t1), lane }; });
}

function monthTicks(t0, t1) {
  const out = []; const d = new Date(t0); let cur = new Date(d.getFullYear(), d.getMonth(), 1);
  if (cur.getTime() < t0) cur.setMonth(cur.getMonth() + 1);
  while (cur.getTime() <= t1) {
    const x = xOf(cur.getTime(), t0, t1);
    if (x > CX0 + 6 && x < CX1 - 6) out.push({ x, label: `${cur.getMonth() + 1}月` });
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  if (out.length > 7) return out.filter((_, i) => i % 2 === 0);
  return out;
}

/* 分级/分类指标的固定档位：副作用按 CTCAE 分级写"1 级 / 2 级"，
   档位顺序固定从 0 级到 4 级，只画节点、不连线——连线会造出"副作用在好转"的假趋势。 */
const GRADE_LEVELS = ['0 级', '1 级', '2 级', '3 级', '4 级'];
function levelsFor(m) {
  if (m.levels && m.levels.length) return m.levels;
  const vals = Array.from(new Set((m.points || []).map(p => p.v)));
  if (vals.every(v => GRADE_LEVELS.includes(v))) return GRADE_LEVELS;
  return vals;
}

function seriesFor(code, t0, t1) {
  const m = M()[code];
  if (!m) return null;
  const nums = numPts(m);
  if (!nums.length) {
    const lv = levelsFor(m);
    const pts = (m.points || []).filter((p) => inDomain(p.d, t0, t1));
    const lo = 0, hi = Math.max(lv.length - 1, 1);
    return { code, m, lo, hi, span: Math.max(hi - lo, 1), pts, qual: true, levels: lv };
  }
  const all = nums.map((p) => p.v);
  const lo = Math.min(...all), hi = Math.max(...all);
  const span = hi - lo || Math.max(Math.abs(hi) * 0.08, 1);
  const pts = nums.filter((p) => inDomain(p.d, t0, t1));
  return { code, m, lo, hi, span, pts, qual: false };
}

function chartSVG(t0, t1) {
  const bands = state.toggles.treatment ? bandsFor(t0, t1) : [];
  const all = state.sel.filter((c) => M()[c]).map((c) => seriesFor(c, t0, t1)).filter((s) => s && s.pts.length);
  if (!all.length) return `<div class="empty"><h3>这个时间窗里没有所选指标</h3><p>扩大时间范围，或在左侧加选一个指标。</p></div>`;
  const series = all.filter((s) => !s.qual);
  const quals = all.filter((s) => s.qual);
  const yOf = (s, v) => CY1 - (v - s.lo) / s.span * (CY1 - CY0);
  const grid = [0, 1, 2, 3, 4].map((i) => { const y = CY0 + i * (CY1 - CY0) / 4; return `<line class="grid" x1="${CX0}" x2="${CX1}" y1="${y}" y2="${y}"/>`; }).join('');

  /* 周期标签两行错位：条宽有限，而「二线舒尼替尼第 2 周期」这类标签很长，
     单行排下来相邻标签会糊成一串。按 labelEnd 记两行末尾，放不下就换行往下 9px。 */
  const labelEnd = [-1e9, -1e9];
  const strip = bands.map((b) => {
    if (b.kind === 'mark') {
      const x = b.x1.toFixed(1), row = 64;
      return `<g><path d="M ${x} ${row - 4} l4 4 -4 4 -4 -4 Z" fill="${b.color}"/>
        <text x="${(+x + 8).toFixed(1)}" y="${row + 3.5}" font-size="9.5" fill="${b.color}" font-weight="600">${esc(b.label)}</text></g>`;
    }
    const w = Math.max(b.x2 - b.x1, 7).toFixed(1);
    const estW = String(b.label).length * 5.4 + 3;
    let row = labelEnd[0] + 4 <= b.x1 ? 0 : 1;
    if (row === 1 && labelEnd[1] + 4 > b.x1) { row = 0; }   // 两行都挤：宁可压一点，也不换第三行
    labelEnd[row] = Math.max(labelEnd[row], b.x1 + estW);
    const ty = 30 - row * 9;
    return `<g><rect x="${b.x1.toFixed(1)}" y="36" width="${w}" height="8" rx="4" fill="${b.color}" opacity=".3"/>
      <text x="${(b.x1 + 1).toFixed(1)}" y="${ty}" font-size="9" fill="${b.color}" font-weight="500">${esc(b.label)}</text></g>`;
  }).join('');

  const markLines = bands.filter((b) => b.kind === 'mark').map((b) =>
    `<line x1="${b.x1.toFixed(1)}" x2="${b.x1.toFixed(1)}" y1="${CY0}" y2="${CY1}" stroke="${b.color}" stroke-width="1.2" stroke-dasharray="3 6" opacity=".45"/>`).join('');

  /* 末点标签：按 y 排序强制最小间距 13px，右端左锚定，防叠字（家族统一规范） */
  const lastPos = series.map((s) => {
    const c = s.pts.map((p) => ({ x: xOf(Date.parse(p.d), t0, t1), y: yOf(s, p.v) }));
    const last = c[c.length - 1];
    return { s, x: last.x, y: last.y, v: s.pts[s.pts.length - 1].v };
  }).sort((a, b) => a.y - b.y);
  let cursor = -Infinity;
  for (const it of lastPos) { it.ly = Math.max(it.y, cursor + 13); cursor = it.ly; }
  const overflow = lastPos.length ? Math.max(0, lastPos[lastPos.length - 1].ly - (CY1 + 2)) : 0;
  if (overflow) for (const it of lastPos) it.ly -= overflow;

  const lines = series.map((s) => {
    const coords = s.pts.map((p) => ({ x: xOf(Date.parse(p.d), t0, t1), y: yOf(s, p.v) }));
    const path = s.pts.length > 1 ? `<path class="line" d="${smoothPath(coords)}" stroke="${s.m.color}" pathLength="1"/>` : '';
    const points = coords.map((c, i) => {
      const p = s.pts[i];
      const isLast = i === s.pts.length - 1;
      const r = isLast ? 5.2 : (i === 0 ? 4.6 : 4);
      const active = state.pin && state.pin.code === s.code && state.pin.date === p.d;
      return `<circle class="pt${active ? ' active' : ''}" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${r}" fill="${s.m.color}" data-action="pin" data-code="${s.code}" data-date="${p.d}"/>`;
    }).join('');
    const lp = lastPos.find((x) => x.s === s);
    const nearRight = lp.x > CX1 - 44;
    const lx = nearRight ? lp.x - 8 : lp.x + 8;
    const label = state.toggles.keypoints
      ? `<text class="delta-tag" x="${lx.toFixed(1)}" y="${(lp.ly + 4).toFixed(1)}" text-anchor="${nearRight ? 'end' : 'start'}" fill="${s.m.color}">${fmtNum(lp.v, s.m.dec)}</text>` : '';
    return `<g>${path}${points}${label}</g>`;
  }).join('');

  /* 分类序列：节点画在数据区的一条"档位带"上，纵向按档位序排；
     每个节点带小方块 + 档位文字，节点之间不连线。多条分类序列时横向错开 8px，避免完全重叠。 */
  const qualLayer = quals.map((s, qi) => {
    const lv = s.levels || [];
    const n = Math.max(lv.length - 1, 1);
    return s.pts.map((p) => {
      const x = xOf(Date.parse(p.d), t0, t1) + qi * 8 - 4;
      const idx = Math.max(0, lv.indexOf(p.v));
      const y = CY1 - idx / n * (CY1 - CY0);
      const active = state.pin && state.pin.code === s.code && state.pin.date === p.d;
      return `<g class="qual-pt${active ? ' active' : ''}">
        <rect x="${(x - 4).toFixed(1)}" y="${(y - 4).toFixed(1)}" width="8" height="8" rx="2" fill="${s.m.color}" opacity=".85" data-action="pin" data-code="${s.code}" data-date="${p.d}"/>
        <text x="${(x + 6).toFixed(1)}" y="${(y + 3.2).toFixed(1)}" font-size="8.5" fill="${s.m.color}" font-weight="600">${esc(p.v)}</text></g>`;
    }).join('');
  }).join('');

  const ticks = monthTicks(t0, t1).map((t) => `<line class="axis" x1="${t.x.toFixed(1)}" x2="${t.x.toFixed(1)}" y1="${CY1}" y2="${CY1 + 5}"/><text class="tick" x="${t.x.toFixed(1)}" y="${CY1 + 18}" text-anchor="middle">${t.label}</text>`).join('');
  const rowLabels = state.toggles.treatment
    ? `<text x="6" y="34" font-size="9" fill="#8fa1b5">疗程</text><text x="6" y="68" font-size="9" fill="#8fa1b5">节点</text>`
    : '';

  return `<svg class="chart" viewBox="0 0 ${CW} ${CH}" role="img" aria-label="所选指标的时序图，共 ${all.length} 条序列（其中 ${quals.length} 条为分级节点）">
    ${grid}${ticks}${markLines}${strip}${rowLabels}${lines}${qualLayer}
    <text class="tick" x="${CX0}" y="${CY1 + 36}">数值线按各自全部记录的最小值–最大值归一化，不代表数值可比；分级序列只画节点、不连线</text>
  </svg>`;
}

const pageHead = (sub) => `<div class="page-head"><div><h1>${esc(PAGES.find(p => p[0] === state.view)[1])}</h1><p>${esc(SUBTITLES[state.view])}</p></div></div>${sub ? `<div class="subnav" role="tablist">${SUBPAGES[state.view].map((s, i) => `<button role="tab" aria-selected="${(state.sub[state.view] || 0) === i}" data-sub="${i}">${esc(s)}</button>`).join('')}</div>` : ''}`;
const row = (b, p, right = '') => `<div class="row"><div class="row-main"><div><b>${b}</b>${p ? `<p>${p}</p>` : ''}</div></div>${right}</div>`;
const pill = (t, c = '') => `<span class="pill ${c}">${esc(t)}</span>`;

/* ---------------- views ---------------- */

function vDashboard() {
  const p = P(), m = M();
  const next = p.rhythm[0];
  const alertNext = `<div class="alert-strip"><div><b>下一次节点：${esc(next[0])}</b><p>${esc(next[1])} · ${esc(next[2])} · ${esc(next[3])}</p></div><button class="soft" data-action="go-review">看复查节奏</button></div>`;
  const tasks = [
    ['meds', '记一次今天的服药与副作用', '剂量 / 漏服 / 分级，逐条留痕', 'go-meds'],
    ['records', '报告看不懂？先理资料', '上传 → 解析 → 核对 → 入库，原件始终保留', 'go-records'],
    ['chat', '和 AI 理一理这一页', '生成可预览的提示词草稿；发送前你确认', 'agent-open'],
    ['review', '准备下次复诊清单', '想问的事 + 我的看法，两区分开导出', 'go-review'],
    ['labs', '本周期的检查结果', '血红蛋白、肝肾功能与影像已录入', 'go-labs'],
  ].map(t => `<button class="task-entry" data-action="${t[3]}"><span class="entry-icon">${icon(t[0])}</span><b>${t[1]}</b><span>${t[2]}</span><span class="arrow">›</span></button>`).join('');
  const rhythm = `<div class="card"><div class="card-head"><h2>复查节奏（按 ${esc(p.stage)} 取值）</h2><span class="source-link">以医生安排为准</span></div>
    ${p.rhythm.map(r => row(`<b>${esc(r[0])}</b>`, `${esc(r[1])} — ${esc(r[2])}`, `<small>${esc(r[3])}</small>`)).join('')}
    <p class="small-note">以上为医生安排与常见节奏的摘录，仅供准备讨论；实际安排以你的医生为准。</p></div>`;
  const cards = (DASH_KEYS[state.profile] || []).filter(k => m[k]).map(k => mcard(k, m[k])).join('');
  return `<div class="page-enter">${pageHead()}
  <div class="hero"><div><span class="eyebrow">当前情况</span><h1>${esc(p.headline)}</h1><p>${esc(p.mindset)}</p>
    <div class="actions"><button class="primary" data-action="go-timeline">看病情一图秀</button><button class="soft" data-action="go-meds">靶向用药</button><button class="soft hero-ai" data-action="agent-open">${icon('chat')}AI 对话</button></div></div>
    <div class="hero-mascot" aria-hidden="true"><span style="font-size:56px">🐤</span></div></div>
  ${alertNext}
  <div class="intent"><i>✓</i><span>工作台只做<b>记录与整理</b>；诊断、危险度判定与用药调整由医生决定。页面里全部资料为<b>演示数据</b>。</span></div>
  <div class="section-title"><h2>接下来可以做的事</h2></div>
  <div class="task-grid">${tasks}</div>
  <div class="dash-cols"><div class="stack">${riskCard(p)}${medCard(m, p)}${rhythm}</div>
  <div class="stack">
    ${imagingCard(p)}
    <div class="card"><div class="card-head"><h2>最近指标</h2><span class="source-link">轻点卡片翻面</span></div>
    <div class="metric-grid">${cards}</div></div></div></div></div>`;
}

/* 危险度卡（看板首卡）：多套评分体系并列，不合并、不推荐用哪一套。 */
function riskCard(p) {
  const rows = (p.risk && p.risk.rows) || [];
  const top = rows[0];
  return `<div class="card accent"><div class="card-head"><h2>危险度分级</h2><span class="source-link">多套体系并存，不合并</span></div>
    ${top ? `<div class="plan-card" style="margin-bottom:10px"><div><span class="eyebrow">${esc(top[0])}</span><div class="big">${esc(top[1])}<small>${esc(top[2])}</small></div></div></div>` : ''}
    ${rows.map(r => row(`<b>${esc(r[0])}</b>`, esc(r[2]), pill(r[1], /极高|高危/.test(r[1]) ? 'yellow' : 'green'))).join('')}
    <div class="actions"><button class="soft" data-action="go-pathology">看病理与危险度</button></div>
    <p class="small-note">危险度由病理四项（部位、大小、核分裂、破裂）按某一套标准判定；工作台只照抄医生给的结论，不自行套表计算。</p></div>`;
}

/* 当前用药卡：正用 / 已停分列，剂量与起止照医嘱原文。 */
function medCard(m, p) {
  const rows = (p.meds && p.meds.rows) || [];
  const active = rows.filter(r => r[5] === '在用');
  return `<div class="card"><div class="card-head"><h2>当前靶向用药</h2><span class="source-link">照医嘱原文 · 不评价该不该吃</span></div>
    ${active.length ? active.map(r => row(`<b>${esc(r[0])} · ${esc(r[1])}</b>`, `${esc(r[2])}　起：${esc(r[3])}`, pill('在用', 'green'))).join('')
      : row('<b>当前没有在用靶向药记录</b>', '停药、换药、观察期都会保留在「靶向用药」页。')}
    <div class="metric-grid" style="margin-top:6px">${m.tdm ? mcard('tdm', m.tdm) : ''}${m.fatigue ? mcard('fatigue', m.fatigue) : ''}</div>
    <div class="actions"><button class="soft" data-action="go-meds">看剂量与副作用</button></div></div>`;
}

function imagingCard(p) {
  const rows = (p.imaging && p.imaging.rows) || [];
  const last = rows[rows.length - 1];
  return `<div class="card"><div class="card-head"><h2>最近一次影像</h2><span class="source-link">结论以报告原文为准</span></div>
    ${last ? `${row(`<b>${esc(last[0])} · ${esc(last[1])}</b>`, esc(last[2]))}${row('<b>医生 / 报告给的下一步</b>', esc(last[3]))}` : row('<b>还没有影像记录</b>', '术前基线与术后复查会逐次归档。')}
    <div class="actions"><button class="soft" data-action="go-labs">去检查与指标</button></div></div>`;
}

/* ---------------- 病情整理（资料库 / 整理草稿 / 病情档案 / 指标检测 / 病情汇总） ----------------
   链路固定：上传 → 解析 → 确认指标 → 入库；原件永远保留，接受之前都只是候选。
   四条不许越过的线：
     ① 「已接受」只表示转录逐字核对过，不等于医学审核——文案不写「确认无误」；
     ② 解析失败不产生候选，原件留着重试（不留半份草稿）；
     ③ 候选只改状态，不改原文、不覆盖旧版本；
     ④ 病理 / 危险度 / 分子是分开的事实，未检测不等于阴性。 */
const fmtSize = (n) => (!n ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const todayISO = () => new Date().toISOString().slice(0, 10);
const DOC_TYPES = ['病理报告', '基因检测', '影像报告', '化验单', '手术记录', '门诊记录', '其他'];
const DOC_PILL = { 已解析: 'green', 已入库: 'green', 待核对: 'yellow', 待解析: 'violet', 解析失败: 'red' };
const CAND_LABEL = { candidate: '待确认', accepted: '已接受' };

function docsTable() {
  const q = (state.query || '').trim().toLowerCase();
  const rows = DOCS[state.profile].filter((d) => !q || `${d.id} ${d.name} ${d.type}`.toLowerCase().includes(q));
  if (!rows.length) return `<p class="small-note" style="margin:0">${q ? '没有匹配的材料；换个词再试。' : '还没有导入任何材料。'}</p>`;
  return `<div class="table-wrap"><table><thead><tr><th>材料</th><th>日期</th><th>类型</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${rows.map((d) => `<tr>
      <td><b>${esc(d.name)}</b><div class="small-note" style="margin:0">${esc(d.id)}${d.size ? ` · ${fmtSize(d.size)}` : ''}${d.note ? ` · ${esc(d.note)}` : ''}</div></td>
      <td>${esc(d.date)}</td>
      <td>${esc(d.type)}</td>
      <td>${pill(d.status, DOC_PILL[d.status] || 'grey')}</td>
      <td>${d.status === '待解析' || d.status === '解析失败'
        ? `<button class="soft" data-action="parse" data-doc="${esc(d.id)}">${d.status === '解析失败' ? '重试解析' : '解析这份材料'}</button>
           <button class="source-link" data-action="source" data-doc="${esc(d.id)}">看原件</button>`
        : `<button class="source-link" data-action="source" data-doc="${esc(d.id)}">看原件</button>`}</td>
    </tr>`).join('')}
  </tbody></table></div>`;
}

/* 选文件：把原件**复制**进资料目录 imports/，库里记一行「待解析」。
   相同的文件（内容 sha256 前 12 位一样）不重复导入、不重置解析状态。
   原件本身不改、不移动；解析结果是「候选」，不直接改事实表。
   导入**不自动上传**——出本机这一步必须由用户点「解析」。 */
function ingestFiles(list) {
  const files = Array.from(list || []);
  if (!files.length) return;
  const kind = ($('#doc-kind') && $('#doc-kind').value) || '其他';
  const tasks = files.map((f) => {
    if (f.size > 40 * 1024 * 1024) {
      toast(`「${f.name}」超过 40 MB 上限，未导入`);
      return Promise.resolve(null);
    }
    const qs = new URLSearchParams({ profile: state.profile, name: f.name, type: kind });
    return fetch(`${apiBase()}/api/import?${qs}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: f
    }).then(async (r) => {
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error((j && j.message) || `HTTP ${r.status}`);
      return j;
    });
  });

  return Promise.all(tasks)
    .then((outs) => {
      const ok = outs.filter(Boolean);
      const dup = ok.filter((o) => o.status === 'unchanged').length;
      if (!ok.length) return null;
      return loadBootstrap()
        .then((data) => {
          buildData(data);
          render();
          toast(dup
            ? `导入 ${ok.length} 份，其中 ${dup} 份此前已存在（内容相同）；原件已复制到资料目录 imports/`
            : `已导入 ${ok.length} 份材料；原件已复制到资料目录 imports/，点「解析」才会出本机`);
        })
        .catch(() => toast('已导入，但页面刷新失败；刷新一次即可看到'));
    })
    .catch((e) => toast(`没能导入：${e.message}`));
}

function vRecords() {
  const p = P(), m = M();
  const i = state.sub.records || 0;
  const docs = DOCS[state.profile];
  const cands = CANDS[state.profile];
  const pending = cands.filter((c) => c.status !== 'accepted');
  const groups = CAT_ORDER.map((cat) => ({ cat, codes: Object.keys(m).filter((k) => m[k].cat === cat && m[k].points.length) })).filter((g) => g.codes.length);

  /* 1) 资料库 —— 文件目录列表 + 上传 + 解析状态 */
  const library = `<div class="toolbar">
      <input data-action="records-search" aria-label="搜索材料名称" placeholder="搜索材料名称 / 编号" value="${esc(state.query)}">
      <div class="chips" style="margin:0">${pill(`共 ${docs.length} 份`, 'violet')}${pill(`${pending.length} 项待核对`, pending.length ? 'yellow' : 'grey')}</div>
    </div>
    <div class="card" style="margin-bottom:14px">
      <div class="card-head"><h2>导入一份材料</h2><span class="source-link">原件保留 · 去重按文件内容</span></div>
      <input id="file-picker" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.csv,.docx" hidden>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:1 1 220px"><span class="form-label">文件（PDF / 图片 / TXT / MD / Office）</span>
          <button class="soft" data-action="pick-file" style="width:100%">选择本机文件…</button></div>
        <div style="flex:0 1 170px"><span class="form-label">资料类型</span>
          <select id="doc-kind" style="width:100%">${DOC_TYPES.map((t) => `<option>${t}</option>`).join('')}</select></div>
        <button class="primary" data-action="load-report">载入一份示例报告</button>
      </div>
      <p class="small-note">单份上限 40 MB。扫描件 / 图片 / PDF / Office 才需要走云端解析；TXT / MD / CSV 在本机抽取。解析失败时原件仍保留，可重试或手工补录（不会产生半份草稿）。</p>
      ${state.parsing ? '<p class="small-note" style="color:var(--violet-deep)">正在解析…（演示耗时约 1 秒）</p>' : ''}
      ${state.parseError ? '<div class="notice danger">上一份解析失败：<b>没有产生任何候选</b>，原件还在，重试不会重复入库。</div>' : ''}
    </div>
    <div class="card" id="docs-table">${docsTable()}</div>
    <div class="help-box">文件本身存在你选的资料目录 <code>documents/</code> 下，库里只记相对路径与哈希；删掉目录就是删掉资料，工作台不另外藏副本。</div>`;

  /* 2) 整理草稿 / 核对 —— 候选逐条核，接受只写记录不写审核人 */
  const draft = `<div class="flow-steps"><span>原始材料</span><span class="fs-arrow">→</span><span class="on">整理草稿</span><span class="fs-arrow">→</span><span>按需核对</span><span class="fs-arrow">→</span><span>指标 / 病程</span></div>
    <div class="notice violet">草稿里的每一项都要你看过才进档案。<b>核对 ≠ 医学审核</b>；日期不拿导入时间顶替，缺日期时会明确要你填。</div>
    ${pending.length ? '' : `<div class="empty"><h3>没有待核对的草稿</h3><p>导入并解析一份材料后，抽出来的字段先放在这里等你逐项确认。</p></div>`}
    ${cands.length ? `<div class="card"><div class="card-head"><h2>本档案的候选字段</h2><span class="source-link">共 ${cands.length} 项 · 待确认 ${pending.length} 项</span></div>
      <div class="table-wrap"><table><thead><tr><th>项目</th><th>材料中的内容</th><th>来源</th><th>状态</th><th>操作</th></tr></thead><tbody>
        ${cands.map((c) => `<tr>
          <td><b>${esc(c.name)}</b></td>
          <td>${esc(c.value)}</td>
          <td>${esc(c.source)}</td>
          <td>${pill(CAND_LABEL[c.status] || c.status, c.status === 'accepted' ? 'green' : 'yellow')}</td>
          <td>${c.status === 'accepted'
            ? '<span class="small-note" style="margin:0">已接受 · 版本保留</span>'
            : `<button class="ok" data-action="candidate" data-id="${esc(c.id)}">核对这一项</button>`}</td>
        </tr>`).join('')}
      </tbody></table></div>
      <p class="small-note">接受一条只写「记录 + 事实表」，审核人一栏保持空；同名同值重复出现会合并成一条，不会长出两份。</p></div>`
      : ''}`;

  /* 3) 病情档案 —— 病理 / 危险度 / 分子分列，未检测单独一栏 */
  const path = p.pathology;
  const riskRows = (p.risk && p.risk.rows) || [];
  const mol = (p.molecular || []).map((x) => row(`<b>${esc(x.k)}</b>`, esc(x.v), pill(x.state === 'ok' ? '已出' : '未检测', x.state === 'ok' ? 'green' : 'grey'))).join('');
  const gaps = ((path && path.gaps) || []).map((g) => row(`<b>${esc(g[0])}</b>`, esc(g[1]), pill('缺', 'grey'))).join('');
  const profileTab = `<div class="grid two">
      <div class="card"><div class="card-head"><h2>${esc((path && path.title) || '病理')}</h2>${pill((path && path.status) || '未录入', 'violet')}</div>
        ${((path && path.rows) || []).map((r) => row(`<b>${esc(r[0])}</b>`, esc(r[1]))).join('') || row('<b>还没有病理转录</b>', '从病理报告逐项抄写；这里只存原文，不替你判危险度。')}
        <p class="small-note">部位、大小、核分裂象、肿瘤破裂、切缘是五个独立事实，各自按报告原文记录，不互相推导。</p></div>
      <div class="card"><div class="card-head"><h2>危险度与分子</h2><span class="source-link">未检测 ≠ 阴性</span></div>
        ${riskRows.map((r) => row(`<b>${esc(r[0])}</b>`, esc(r[2]), pill(r[1], /极高|高危/.test(r[1]) ? 'yellow' : 'green'))).join('')}
        ${mol}
        <p class="small-note">「未检测」保留原样，不填默认值、不当成阴性；补做与否由医生决定。</p></div>
    </div>
    <div class="card" style="margin-top:14px"><div class="card-head"><h2>这份档案还缺什么</h2><span class="source-link">缺 = 没录入，不代表要补做检查</span></div>
      ${row('<b>病理转录</b>', path ? '已有记录' : '未录入：可从病理报告逐项抄写', pill(path ? '已有' : '缺', path ? 'green' : 'grey'))}
      ${row('<b>危险度依据</b>', riskRows.length ? `${riskRows.length} 套体系已记录` : '未录入：需要医生给出的结论与依据', pill(riskRows.length ? '已有' : '缺', riskRows.length ? 'green' : 'grey'))}
      ${row('<b>资料原件</b>', docs.length ? `已导入 ${docs.length} 份` : '还没有导入材料', pill(docs.length ? '已有' : '缺', docs.length ? 'green' : 'grey'))}
      ${row('<b>待核对候选</b>', pending.length ? `${pending.length} 项等你看过` : '没有待核对内容', pill(pending.length ? '待办' : '已有', pending.length ? 'yellow' : 'green'))}
      ${gaps}
    </div>`;

  /* 4) 指标检测 —— 与一图秀同一套卡片，翻面看参考区间 */
  const metricsTab = `<div class="notice">趋势只呈现记录，不代表疗效、复发或诊断判断。分级指标（水肿、乏力、腹泻、手足反应）只记级数，不做数值比较。</div>
    <div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap">
      <button class="primary" data-action="add-metric">＋ 手工补录一个值</button>
      <button class="soft" data-action="go-timeline">去一图秀看趋势</button></div>
    ${groups.map((g) => `<div class="metric-group"><div class="metric-group-head"><h3>${esc(g.cat)}</h3><span>${g.codes.length} 项</span></div>
      <div class="metric-grid">${g.codes.map((k) => mcard(k, m[k])).join('')}</div></div>`).join('') || '<div class="empty"><h3>这个档案还没有指标记录</h3><p>导入一份化验单并核对，或手工补录一个值。</p></div>'}
    <div class="help-box">点一张卡原地翻面看最近几次与参考区间；卡片位置和尺寸不变。没有记录的指标不在这里列出，避免「没显示 = 正常」的误读。</div>`;

  /* 5) 病情汇总 —— 只统计数量，不下结论 */
  const accepted = cands.filter((c) => c.status === 'accepted').length;
  const summary = `<div class="notice plain">汇总只回答「记了多少」；不评价控制得好不好，也不预测走向。</div>
    <div class="grid two">
      <div class="card"><div class="card-head"><h2>资料与核对</h2><span class="source-link">本档案</span></div>
        ${row('<b>材料份数</b>', `${docs.length} 份`)}
        ${row('<b>候选字段</b>', `${cands.length} 项 · 已接受 ${accepted} 项`)}
        ${row('<b>待核对</b>', `${pending.length} 项`)}
        ${row('<b>指标项数</b>', `${Object.keys(m).length} 项 · 记录 ${Object.values(m).reduce((n, x) => n + x.points.length, 0)} 个点`)}
      </div>
      <div class="card"><div class="card-head"><h2>下一步能做什么</h2><span class="source-link">自己决定</span></div>
        ${row('<b>继续整理</b>', '把没核对的候选逐条看过', '<button class="source-link" data-action="go-rec-sub" data-sub-i="1">去核对</button>')}
        ${row('<b>看趋势</b>', '血红蛋白、体重与乏力放在同一段时间里', '<button class="source-link" data-action="go-timeline">去一图秀</button>')}
        ${row('<b>准备复诊</b>', '把想问的两三条写在最前面', '<button class="source-link" data-action="go-review">去复诊准备</button>')}
        <p class="small-note">导出只带已接受的事实；未核对的候选不进上下文，也不进导出文件。</p>
      </div>
    </div>`;

  const bodies = [library, draft, profileTab, metricsTab, summary];
  return `<div class="page-enter">${pageHead(true)}${bodies[i] || bodies[0]}</div>`;
}

/* 病理与危险度 3 页签：病理与免疫组化 / 危险度分级 / 分子与基因。
   GIST 没有 T/N/M 分期，这里的"档案头"是部位 + 危险度，不是一个 TNM 字符串。 */
function vPathology() {
  const p = P();
  const i = state.sub.pathology || 0;
  const path = p.pathology;
  const ihcKeys = /CD117|DOG1|SDHB|免疫/;
  const ihc = (p.molecular || []).filter(x => ihcKeys.test(x.k));
  const genes = (p.molecular || []).filter(x => !ihcKeys.test(x.k));
  const matrix = (list) => list.map(x => {
    const [cls, label] = x.state === 'ok' ? ['green', '已出'] : ['grey', '未检测'];
    return `<div class="row"><div class="row-main"><div><b>${esc(x.k)}</b><p>${esc(x.note)}</p></div></div>
      <div style="text-align:right">${pill(label, cls)}<small style="display:block;margin-top:4px">${esc(x.v)}</small><small style="display:block">${esc(x.src)}</small></div></div>`;
  }).join('');

  const hero = `<div class="subtype-hero"><div><span class="code">病理与危险度档案</span><h2>${esc(p.stage)}</h2><span class="en">${esc(p.path[0])} · 依据：病理报告原件（已归档）</span>
    <div class="subtype-meta">${p.path.map(s => pill(s, 'violet')).join('')}</div></div>
    <div class="path-tree">${p.path.map((s, j) => `<div class="${j === 0 ? 'on' : ''} ${j > 0 ? 'lv' + Math.min(j, 3) : ''}">${esc(s)}</div>`).join('')}</div></div>
    <p class="small-note">部位（胃 / 小肠 / 结直肠 / 其他）、大小、核分裂象、是否破裂是四个独立事实，分栏保存；危险度是按某套标准对它们做的判定，工作台不替你套表。</p>`;

  const pathTab = `${hero}
    <div class="section-title"><h2>${esc((path && path.title) || '病理')}</h2><span class="source-link">${esc((path && path.status) || '未录入')}</span></div>
    <div class="card">${((path && path.rows) || []).map(r => row(`<b>${esc(r[0])}</b>`, esc(r[1]))).join('') || row('<b>还没有病理转录</b>', '从病理报告逐项抄写；这里只存原文，不替你解释。')}
    <p class="small-note">不同标本、不同时间的病理结论分别保留，不用新报告覆盖旧记录。</p></div>
    <div class="section-title"><h2>免疫组化</h2><span class="source-link">诊断标志物 · 未检测 ≠ 阴性</span></div>
    <div class="card">${matrix(ihc) || row('<b>还没有免疫组化记录</b>', 'CD117、DOG1 是 GIST 常用诊断标志物；报告未归档前保持空态。')}
    <p class="small-note">CD117 与 DOG1 各自独立成立；阴性或弱阳性时的补充判断由病理科与医生给出，工作台不解读染色结果。</p></div>`;

  const rows = (p.risk && p.risk.rows) || [];
  const riskTab = `<div class="section-title"><h2>${esc((p.risk && p.risk.title) || '危险度分级依据')}</h2><span class="source-link">多套体系并存 · 不合并</span></div>
    <div class="notice violet">同一份病理可以按不同标准得到不同表述。这里把每套体系的结论、依据和来源分行保存，<b>不挑选"最权威"的一套，也不重新计算</b>。</div>
    <div class="table-wrap"><table><thead><tr><th>评分体系</th><th>结论</th><th>依据</th><th>来源</th><th>备注</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><b>${esc(r[0])}</b></td><td>${pill(r[1], /极高|高危/.test(r[1]) ? 'yellow' : 'green')}</td><td>${esc(r[2])}</td><td><small>${esc(r[3])}</small></td><td><small>${esc(r[4])}</small></td></tr>`).join('')}
    </tbody></table></div>
    ${rows.length ? '' : '<div class="empty"><h3>还没有危险度记录</h3><p>危险度结论来自医生的病理评估；没有记录时保持空态，不按大小与核分裂自行推算。</p></div>'}
    <div class="card" style="margin-top:14px"><div class="card-head"><h2>为什么会有好几套</h2></div>
      ${row('<b>Fletcher / NIH 2008 修改版</b>', '按肿瘤大小与核分裂计数分四档，是最常用的一套。')}
      ${row('<b>AFIP / Miettinen</b>', '按胃 / 小肠 / 结直肠分层，各部位阈值不同，同一份病理可能得到不同档位。')}
      ${row('<b>中国 GIST 共识修改版</b>', '在国内病理与临床沟通中用得多，部分中心会同时写两套。')}
      <p class="small-note">危险度影响的是"要不要辅助治疗、辅助多久"的讨论，不改变"已经切除、需要复查"这个事实。辅助治疗时长与是否延长由医生决定。</p></div>`;

  const geneTab = `<div class="section-title"><h2>分子与基因</h2><span class="source-link">未检测 ≠ 阴性 · 待出 ≠ 阴性</span></div>
    <div class="card">${matrix(genes) || row('<b>还没有基因检测记录</b>', '医生开了才做；没做就写未检测。')}
    <p class="small-note">KIT 与 PDGFRA 的外显子位置（如 KIT 外显子 9 / 11 / 13 / 17、PDGFRA 外显子 18 D842V）决定后续用药讨论的方向；SDHB 表达缺失提示 SDH 缺陷型。工作台只记录报告原文与检测状态，<b>不据此给出选药方向</b>。</p></div>
    <div class="card" style="margin-top:14px"><div class="card-head"><h2>这份基因报告怎么读</h2><span class="source-link">只解释字段，不解释病情</span></div>
      ${row('<b>检测方法</b>', 'Sanger / NGS / IHC 的检出范围不同，报告上会写明；不同方法的结果不直接合并。')}
      ${row('<b>外显子位置</b>', '按报告原文抄录（如"外显子 11 c.1676T>A"），工作台不改写、不换算。')}
      ${row('<b>野生型</b>', '"未检出突变"与"未检测"是两件事：前者是做过且没查到，后者是没做。')}
      <p class="small-note">基因结果与用药的对应关系由医生判断；同一份报告在不同线序下的意义也不同，不在本页推导。</p></div>`;

  const bodies = [pathTab, riskTab, geneTab];
  return `<div class="page-enter">${pageHead(true)}${bodies[i] || bodies[0]}</div>`;
}

/* 治疗历程 3 页签：治疗路径与线序 / 手术记录 / 疗程与周期。
   路径切换只新增不覆盖（既往 + 当前并列）；线序按"一线 / 二线"原样保留。 */
function vTreatment() {
  const p = P();
  const i = state.sub.treatment || 0;
  const pathRows = (p.pathway && p.pathway.rows) || [];
  const current = pathRows.find(r => r[0] === '当前') || pathRows[0];
  const past = pathRows.filter(r => r !== current);
  const lineList = (p.lines || []).map((l, j) => row(`<b>${esc(l.name)}</b>`, esc(l.detail), pill(l.done ? '已开始' : '待安排', l.done ? 'green' : 'violet'))).join('');
  const pathCard = `<div class="section-title"><h2>${esc((p.pathway && p.pathway.title) || '治疗路径')}</h2><span class="source-link">切换只新增，不覆盖</span></div>
    <div class="plan-card"><div><span class="eyebrow">当前路径</span><div class="big">${esc(current ? current[1] : '—')}<small>${esc(current ? current[2] : '')}</small></div>
      <div class="progress"><i style="width:${Math.round(p.cycles.filter(c => c[4]).length / Math.max(p.cycles.length, 1) * 100)}%"></i></div></div>
      <button class="primary" data-action="go-timeline">与指标对照</button></div>
    ${current ? `<div class="card">${row(`<b>${esc(current[1])}</b>`, `${esc(current[3])}`, pill('当前', 'green'))}
      ${row('<b>医生原话</b>', esc(current[4]))}</div>` : ''}
    <div class="section-title"><h2>线序</h2><span class="source-link">一线 → 二线 → 后线，按事实排列</span></div>
    <div class="card">${lineList || row('<b>还没有线序记录</b>', '辅助治疗与晚期线序会按开始时间逐条出现。')}
    <p class="small-note">线序不是"越往后越好"的排名，也不代表下一线一定存在；换线的时机与选择由医生根据影像与耐受情况决定。</p></div>
    ${past.length ? `<div class="section-title"><h2>既往路径（保留原样）</h2><span class="source-link">改路径不是删除历史</span></div>
      <div class="card">${past.map(r => row(`<b>${esc(r[1])}</b>`, `${esc(r[2])}　${esc(r[3])}`, pill(r[0], 'grey')) + row('<b>切换原因 / 医生原话</b>', esc(r[4]))).join('')}
      <p class="small-note">换线、停药、加量的原因原样留着，方便下次讨论时有据可查。</p></div>` : ''}`;

  const surgeries = (p.surgery && p.surgery.rows) || [];
  const surgery = surgeries.length ? `<div class="section-title"><h2>${esc(p.surgery.title)}</h2><span class="source-link">术式、切缘与破裂照手术记录原文</span></div>
    <div class="card">${surgeries.map(r => row(`<b>${esc(r[0])} · ${esc(r[1])}</b>`, `${esc(r[2])}　机构：${esc(r[5])}`, `<small style="max-width:220px;text-align:right">切缘 ${esc(r[3])} · ${esc(r[4])}</small>`)).join('')}
    <p class="small-note">切缘（R0 / R1）与肿瘤是否破裂是危险度与后续讨论的两个关键事实，按手术记录与病理报告原文记录；工作台不评价术式选择，也不回答"能不能手术"。</p></div>`
    : `<div class="empty"><h3>本档案没有手术记录</h3><p>未手术的档案保持空态，不填默认值；是否手术由医生评估。</p></div>`;

  const cycles = `<div class="section-title"><h2>疗程与周期</h2><span class="source-link">来自出院小结与门诊记录</span></div>
    <div class="table-wrap"><table class="cycle-table"><thead><tr><th>阶段</th><th>开始日期</th><th>内容</th><th>状态</th></tr></thead><tbody>
    ${p.cycles.map(c => `<tr class="${c[4] ? 'done' : 'next'}"><td><b>${esc(c[0])}</b></td><td class="num">${esc(c[1])}</td><td>${esc(c[2])}</td><td>${pill(c[3], c[4] ? 'green' : 'violet')}</td></tr>`).join('')}</tbody></table></div>
    <p class="small-note">更正只新增版本，不覆盖旧记录；周期起止按医嘱与门诊记录抄录，本页不推算下次日期。</p>`;

  const bodies = [pathCard, surgery, cycles];
  return `<div class="page-enter">${pageHead(true)}${bodies[i] || bodies[0]}</div>`;
}

/* 靶向用药 4 页签：当前用药 / 剂量变更 / 服药与漏服 / 副作用记录。
   GIST 的长期口服 TKI 是这条病程的主线，剂量、漏服、分级副作用分开记，互不覆盖。 */
function vMeds() {
  const p = P(), m = M();
  const i = state.sub.meds || 0;
  const meds = (p.meds && p.meds.rows) || [];
  const active = meds.filter(r => r[5] === '在用');
  const stopped = meds.filter(r => r[5] !== '在用');

  const medRow = (r, on) => `<div class="card" style="margin-bottom:10px"><div class="card-head"><h2>${esc(r[0])} · ${esc(r[1])}</h2>${pill(on ? '在用' : '已停', on ? 'green' : 'grey')}</div>
    ${row('<b>用法</b>', esc(r[2]))}
    ${row('<b>起止</b>', `${esc(r[3])} → ${esc(r[4] || '至今')}`)}
    ${row('<b>备注</b>', esc(r[6]))}</div>`;
  const currentTab = `${active.length ? active.map(r => medRow(r, true)).join('') : `<div class="empty"><h3>当前没有在用靶向药</h3><p>停药、观察期、换线间隙都会保留在「已停」里，不再显示为在用。</p></div>`}
    <div class="card"><div class="card-head"><h2>已停用药</h2><span class="source-link">停药不等于删除历史</span></div>
      ${stopped.length ? stopped.map(r => row(`<b>${esc(r[0])} · ${esc(r[1])}</b>`, `${esc(r[2])}　${esc(r[3])} → ${esc(r[4])}　${esc(r[6])}`, pill('已停', 'grey'))).join('') : row('<b>没有已停记录</b>', '换药或停药后会出现在这里。')}
    <p class="small-note">不比较原研与仿制药，也不写"哪种更好"；剂量与品种以处方与医嘱原文为准。</p></div>
    <div class="section-title"><h2>服药相关指标</h2><span class="source-link">数值线翻面 · 分级不连线</span></div>
    <div class="card"><div class="metric-grid">${m.tdm ? mcard('tdm', m.tdm) : ''}${m.fatigue ? mcard('fatigue', m.fatigue) : ''}${m.edema ? mcard('edema', m.edema) : ''}</div>
    <p class="small-note">谷浓度只在开展该检测的中心才有；没有记录不代表"浓度不够"，也不代表"该加量"。</p></div>`;

  const dose = (p.dose && p.dose.rows) || [];
  const doseTab = `<div class="section-title"><h2>${esc((p.dose && p.dose.title) || '剂量变更')}</h2><span class="source-link">每次变更留一行，不覆盖</span></div>
    ${dose.length ? `<div class="table-wrap"><table><thead><tr><th>日期</th><th>药物</th><th>原剂量</th><th>新剂量</th><th>原因（医生原话）</th></tr></thead><tbody>
      ${dose.map(r => `<tr><td><b>${esc(r[0])}</b></td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${pill(esc(r[3]), 'violet')}</td><td><small>${esc(r[4])}</small></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty"><h3>还没有剂量变更记录</h3><p>从起始剂量开始吃、没有调整过时，这一页就是空的——空态也是事实。</p></div>`}
    <div class="notice violet">减量、暂停、加量都由医生决定。<b>工作台不给剂量建议，也不把"减量"读成"病情好转"</b>；原因一栏照医生原话抄，缺原因时留空。</div>`;

  const adh = (p.adherence && p.adherence.rows) || [];
  const missed = adh.filter(r => /漏服|未服|忘/.test(r[3]) || /漏服|未服|忘/.test(r[4])).length;
  const adhTab = `<div class="card"><div class="card-head"><h2>${esc((p.adherence && p.adherence.title) || '服药记录')}</h2><span class="source-link">自己记 · 不催不补</span></div>
    ${adh.length ? `<div class="table-wrap"><table><thead><tr><th>日期</th><th>药物</th><th>计划剂量</th><th>实际</th><th>备注</th></tr></thead><tbody>
      ${adh.map(r => `<tr><td><b>${esc(r[0])}</b></td><td>${esc(r[1])}</td><td>${esc(r[2])}</td><td>${/漏服|未服|忘/.test(r[3]) ? pill(esc(r[3]), 'yellow') : esc(r[3])}</td><td><small>${esc(r[4])}</small></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty"><h3>还没有服药记录</h3><p>愿意的时候再记；漏记不催不补，也不需要"补打卡"。</p></div>`}
    ${row('<b>本档案已记的漏服</b>', `${missed} 次（只统计备注里写明漏服的条目）`, pill(missed ? `${missed} 次` : '0 次', missed ? 'yellow' : 'green'))}
    <div class="actions"><button class="primary" data-action="add-adherence">记一次服药</button></div>
    <p class="small-note">漏服后怎么处理（补服还是跳过）按医生或药师的交代执行，工作台不写统一规则；把漏服次数带去门诊，比"我好像都吃了"更准确。</p></div>`;

  const se = (p.sideEffects && p.sideEffects.rows) || [];
  const gradeMetrics = Object.keys(m).filter(k => m[k].cat === '用药与症状' && m[k].points.length);
  const seTab = `<div class="section-title"><h2>${esc((p.sideEffects && p.sideEffects.title) || '副作用记录')}</h2><span class="source-link">分级照医生 / 随访记录</span></div>
    ${se.length ? `<div class="table-wrap"><table><thead><tr><th>日期</th><th>表现</th><th>分级</th><th>处理</th><th>备注</th></tr></thead><tbody>
      ${se.map(r => `<tr><td><b>${esc(r[0])}</b></td><td>${esc(r[1])}</td><td>${pill(esc(r[2]), /3|4/.test(r[2]) ? 'red' : /2/.test(r[2]) ? 'yellow' : 'grey')}</td><td>${esc(r[3])}</td><td><small>${esc(r[4])}</small></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty"><h3>还没有副作用记录</h3><p>没有记录不代表没有发生；愿意的时候按日期补一条即可。</p></div>`}
    <div class="actions"><button class="primary" data-action="add-side-effect">记一次反应</button></div>
    <div class="section-title"><h2>分级趋势</h2><span class="source-link">只画节点，不连线</span></div>
    <div class="card"><div class="metric-grid">${gradeMetrics.map(k => mcard(k, m[k])).join('') || '<p>本档案暂无分级指标。</p>'}</div>
    <p class="small-note">分级（1 级 / 2 级 / 3 级）是分类值，没有数值轴；连成折线会造出"副作用在好转"的假趋势，所以只画节点。处理方式与是否减量由医生决定。</p></div>
    <div class="notice danger">出现<b>呕血、黑便、突发剧烈腹痛、持续高热</b>时不要等下次门诊，按医院急诊流程处理；这类事件记在「复诊准备 · 出血与急症」。</div>`;

  const bodies = [currentTab, doseTab, adhTab, seTab];
  return `<div class="page-enter">${pageHead(true)}${bodies[i] || bodies[0]}</div>`;
}

/* 检查与指标 3 页签：血象与生化 / 药物浓度 / 影像与复查。 */
function metricSections(cats) {
  const m = M();
  const list = CAT_ORDER.filter((c) => !cats || cats.includes(c))
    .map((cat) => ({ cat, codes: Object.keys(m).filter((k) => m[k].cat === cat && m[k].points.length) }))
    .filter((g) => g.codes.length);
  if (!list.length) return '<div class="empty"><h3>这一组还没有记录</h3><p>没有记录不是阴性；导入化验单并逐项核对后才会出现在这里。</p></div>';
  return list.map((g) => `<div class="metric-group"><div class="metric-group-head"><h3>${esc(g.cat)}</h3><span>${g.codes.length} 项</span></div>
    <div class="metric-grid">${g.codes.map((k) => mcard(k, m[k])).join('')}</div></div>`).join('');
}

function vLabs() {
  const i = state.sub.labs || 0;
  const p = P();
  if (i === 0) return `<div class="page-enter">${pageHead(true)}${metricSections(['血象', '生化', '营养'])}
    <p class="small-note">GIST 长期吃 TKI，最常看的是血红蛋白、白细胞 / 中性粒细胞、血小板与肝肾功能（ALT / AST / 胆红素）。同一实验室、同一方法才可比；卡片背面写参考区间与口径，缺失不等于正常。LDH 只是普通化验项，不是 GIST 的"肿瘤标志物"。</p></div>`;
  if (i === 1) return `<div class="page-enter">${pageHead(true)}${metricSections(['药物浓度', '用药与症状'])}
    <p class="small-note">伊马替尼谷浓度（C trough）只在开展该检测的中心做，采样时间与上一次服药时间会影响结果；不同中心的检测方法与目标区间不合并。没有这条记录不代表"浓度不够"，也不代表需要加量——是否调整由医生判断。</p></div>`;
  const rows = (p.imaging && p.imaging.rows) || [];
  const mon = (p.monitor && p.monitor.rows) || [];
  return `<div class="page-enter">${pageHead(true)}
    <div class="section-title"><h2>影像随访</h2><span class="source-link">逐次记录，结论以报告原文为准</span></div>
    <div class="card">${rows.length
      ? rows.map(r => row(`<b>${esc(r[0])} · ${esc(r[1])}</b>`, `${esc(r[2])}${r[3] && r[3] !== '—' ? `　下一步：${esc(r[3])}` : ''}`, `<small style="max-width:180px;text-align:right">${esc(r[4] || '')}</small>`)).join('')
      : '<p>本档案暂无影像记录。</p>'}
      <p class="small-note">腹部增强 CT / MRI、超声按发生日期逐条归档；GIST 的转移以肝与腹膜 / 腹腔多见，报告原文里怎么写的就怎么记。工作台<b>不解读影像、不判断疗效</b>，也不把"未见新病灶"改写成"治疗有效"。</p></div>
    <div class="section-title"><h2>复查安排</h2><span class="source-link">医生给出的节点</span></div>
    <div class="card">${mon.map(r => row(`<b>${esc(r[0])}</b>`, `${esc(r[1])}　上次：${esc(r[2])}　下次：${esc(r[3])}`, `<small style="max-width:200px;text-align:right">${esc(r[4])}</small>`)).join('') || '<p>本档案暂无复查安排。</p>'}
      <p class="small-note">复查间隔随分期、治疗阶段与是否服药变化；这里只记录医生给的安排，不推算该多久查一次。</p></div>
    <div class="section-title"><h2>检查前准备</h2><span class="source-link">以医院要求为准</span></div>
    <div class="card">${row('<b>腹部增强 CT / MRI</b>', '是否空腹、肾功能与过敏史告知、体内是否有金属植入物，按影像科要求执行。')}
      ${row('<b>血药浓度</b>', '采样时间点由开展检测的中心规定，通常与上次服药间隔有关；按检验单要求执行。')}
      <p class="small-note">各家医院要求不同，这里不写统一流程；以预约单与医院告知为准。</p></div></div>`;
}

/* 病情一图秀 3 页签：数值曲线 / 分类与事件 / 数据口径。
   默认序列是血红蛋白 + 体重（双数值线）+ 乏力分级（分类节点，不连线）。 */
function vTimeline() {
  const m = M();
  const i = state.sub.timeline || 0;
  const [t0, t1] = domain();
  const series = state.sel.filter((c) => m[c]).map((c) => seriesFor(c, t0, t1)).filter((s) => s.pts.length);
  const groups = CAT_ORDER.map((cat) => ({ cat, codes: Object.keys(m).filter((k) => m[k].cat === cat) })).filter((g) => g.codes.length);
  const pinData = state.pin && m[state.pin.code] ? m[state.pin.code].points.find((p) => p.d === state.pin.date) : null;
  const [bs, be] = dataBounds();
  const rng = `${shortDate(new Date(bs).toISOString().slice(0, 10))} – ${shortDate(new Date(be).toISOString().slice(0, 10))}`;
  const rangeChips = `<div class="chips" style="margin:0 0 14px" aria-label="时间范围">${[['3m', '近 3 月'], ['6m', '近 6 月'], ['12m', '近 12 月'], ['all', '全期']].map(([k, l]) => `<button class="chip" aria-pressed="${state.range === k}" data-action="range" data-range="${k}">${l}</button>`).join('')}</div>`;
  const rail = `<aside class="rail" aria-label="筛选与指标选择">
      <details class="pick" ${state.sel.length && (typeof window !== 'undefined' && window.innerWidth > 900 ? 'open' : '')}>
        <summary>选择指标 <small>最多 4 个 · 已选 ${state.sel.length}</small></summary>
        <div class="metric-list">
          ${groups.map((g) => `<div class="cat-label">${esc(g.cat)}</div>${g.codes.filter((c) => m[c].points.length).map((c) => `<label class="metric-pick"><input type="checkbox" ${state.sel.includes(c) ? 'checked' : ''} data-pick="${c}"><i style="background:${m[c].color}"></i><span>${esc(m[c].name)}</span><small>${m[c].points.length} 次</small></label>`).join('')}`).join('')}
        </div>
      </details>
      <section><h3>显示</h3>
        <div class="chips">
          <button class="chip" aria-pressed="${state.toggles.treatment}" data-action="toggle" data-key="treatment">治疗节点</button>
          <button class="chip" aria-pressed="${state.toggles.keypoints}" data-action="toggle" data-key="keypoints">末点数值</button>
        </div>
      </section>
      <section><h3>时间窗缩放</h3>
        <div class="zoom"><input type="range" min="40" max="100" value="${state.zoom}" data-action="zoom" aria-label="时间窗缩放"><span>${state.zoom}%</span></div>
        <p class="small-note">右端锚定最新记录；40% 表示只看最近四成时间。</p>
      </section>
      <section><h3>口径</h3><p class="small-note">数值线按该指标全部记录的最小值–最大值归一化，只用于同屏回顾，不能比较不同指标的绝对值；分级序列（水肿 / 乏力 / 腹泻 / 手足反应）只画节点，不连线。</p></section>
    </aside>`;
  const chartPanel = `<div class="chart-panel">
        <div class="chart-top">
          <div><h2 style="font-size:15px">${series.length} 条序列 · ${state.range === 'all' ? '全期' : '近 ' + state.range.replace('m', ' 月')}</h2><p class="small-note">点击数据点固定详情；治疗条与数据区分离，不压曲线。</p></div>
          <span class="pill grey">${rng}</span>
        </div>
        <div class="legend">${series.map((s) => `<span><i style="background:${s.m.color}"></i><b>${esc(s.m.name)}</b><span class="range">${s.qual ? '分级节点 · 不连线' : `${fmtNum(s.lo, s.m.dec)}–${fmtNum(s.hi, s.m.dec)} ${esc(s.m.unit)}`}</span></span>`).join('')}</div>
        <p class="scroll-hint small-note">图表可左右滑动</p>
        <div class="chart-wrap">${chartSVG(t0, t1)}</div>
        ${pinData ? `<div class="pin"><div><b>${esc(m[state.pin.code].name)} · ${fmtNum(pinData.v, m[state.pin.code].dec)} ${esc(m[state.pin.code].unit || '')}</b><p>${esc(longDate(pinData.d))} · 来源：${esc(pinData.src)}</p></div><button class="icon-button" data-action="unpin" aria-label="关闭详情">×</button></div>` : ''}
      </div>`;
  const cardGroups = `<div class="section-title"><h2>指标卡片</h2><span class="source-link">点一张卡翻到背面；每张卡互不影响</span></div>
      ${groups.map((g) => `<div class="metric-group"><div class="metric-group-head"><h3>${esc(g.cat)}</h3><span>${g.codes.length} 项</span></div><div class="metric-grid">${g.codes.map((k) => mcard(k, m[k])).join('')}</div></div>`).join('')}`;
  const events = EVENTS[state.profile] || [];
  const bodies = [
    `${rangeChips}<div class="overview">${rail}<div class="timeline-main">${chartPanel}${cardGroups}</div></div>`,
    `<div class="overview">${rail}<div class="timeline-main">
      <div class="section-title"><h2>分级记录</h2><span class="source-link">只按原文记录，不连线</span></div>
      ${groups.filter((g) => g.codes.some((k) => !numPts(m[k]).length)).map((g) => `<div class="metric-group"><div class="metric-group-head"><h3>${esc(g.cat)}</h3><span>${g.codes.filter((k) => !numPts(m[k]).length).length} 项</span></div><div class="metric-grid">${g.codes.filter((k) => !numPts(m[k]).length).map((k) => mcard(k, m[k])).join('')}</div></div>`).join('')
        || '<div class="empty" style="margin-top:0"><p>本档案没有分级记录。</p></div>'}
      <div class="section-title"><h2>治疗与随访事件</h2><span class="source-link">按时间正序</span></div>
      <div class="card">${events.map((e) => row(`<b>${esc(e.d)}</b>`, esc(e.label))).join('')}
        <p class="small-note">事件按日期留痕，不排序重要性，也不从中推导结论。</p></div>
    </div></div>`,
    `<div class="card"><div class="card-head"><h2>这张图怎么读</h2></div>
      ${row('<b>两条数值线</b>', '血红蛋白与体重各自按自身全部记录的最小值–最大值拉伸到同一高度，只用于同屏看"什么时候降、什么时候回升"，不能比较两者绝对值。')}
      ${row('<b>副作用为什么不连线</b>', '分级（1 级 / 2 级 / 3 级）是分类值，没有数值轴。连成折线会造出"副作用在好转"的假趋势；所以只画节点、只标级数。')}
      ${row('<b>治疗节点在下方泳道</b>', '疗程条与手术 / 换药 / 减量标记与数据区分离，不压曲线；节点只标日期与名称，不评价疗效。')}
      ${row('<b>换医院 / 换方法</b>', '不同来源的结果以来源标注区分，不合并成一条连续曲线。')}
      ${row('<b>缺失不是结果</b>', '某段时间没有点，就是没查；不插值、不补齐、不把空档读成"稳定"。')}
      <p class="small-note">取值范围 ${rng}；右端锚定最新记录。缩放只改变看的时间窗，不改变数值。</p></div>`
  ];
  return `<div class="page-enter">${pageHead(true)}${bodies[i] || bodies[0]}</div>`;
}

/* 生活与营养 2 页签：进食记录 / 体重与营养。
   术后胃容量变小、需要分餐是事实；这里只记"吃了多少"，不给食谱、不给剂量。 */
function vNutrition() {
  const m = M(), p = P();
  const i = state.sub.nutrition || 0;
  const rows = (p.nutrition && p.nutrition.rows) || [];
  const mealCard = rows.length ? `<div class="table-wrap"><table class="cycle-table"><thead><tr><th>日期 · 餐次</th><th>份量</th><th>吃了什么</th><th>症状</th><th>备注</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td><b>${esc(r[0])}</b> ${esc(r[1])}</td><td>${esc(r[2])}</td><td>${esc(r[3])}</td><td>${r[4] === '无' ? pill('无', 'grey') : pill(esc(r[4]), 'yellow')}</td><td><small>${esc(r[5])}</small></td></tr>`).join('')}</tbody></table></div>
      <p class="small-note">只记餐次、份量与你的原话；不做热量换算、不做食材替换建议、不给食谱——表结构里就没有这些字段，页面也不补。</p>`
    : `<div class="empty"><h3>还没有进食记录</h3><p>愿意的时候再记；漏记不催不补。默认只记"不寻常的一餐"就够了。</p></div>`;
  const bodies = [
    `<div class="notice violet">胃部分切除后食量变小、需要分 5–6 餐是常见情况；这一页记事实，不评价"吃得够不够"。</div>
     <div class="section-title"><h2>进食记录</h2><span class="source-link">漏记不催不补 · 只记事实</span></div>
     <div class="card">${mealCard}
     <div class="actions"><button class="primary" data-action="add-meal">记一笔进食</button></div></div>`,
    `<div class="section-title"><h2>体重与营养指标</h2><span class="source-link">数值线 · 翻面看参考区间</span></div>
     <div class="card"><div class="metric-grid">${m.wt ? mcard('wt', m.wt) : ''}${m.alb ? mcard('alb', m.alb) : ''}${m.hgb ? mcard('hgb', m.hgb) : ''}</div>
     <p class="small-note">体重用同一台秤、同一时间称更可比；白蛋白与血红蛋白受治疗与出血影响，单次数值不等于营养状况结论。</p></div>
     <div class="section-title"><h2>体重下降时先做什么</h2></div>
     <div class="card">${row('<b>把最近三条进食记录带上</b>', '份量、食物、吃的时候有没有腹胀、恶心或早饱——这比"最近瘦了"更有用。')}
       ${row('<b>把体重趋势带上</b>', '一图秀里可以直接截图；同一台秤的数值更可比。')}
       ${row('<b>问清楚要不要转营养门诊</b>', '是否需要口服营养补充、是否调整餐次由医生或营养师决定；工作台不做这项判断。')}
       <p class="small-note">这一页不提供食谱与剂量，也不推荐任何营养品品牌。</p></div>`
  ];
  return `<div class="page-enter">${pageHead(true)}${bodies[i] || bodies[0]}</div>`;
}

/* 心理支持 3 页签：当下感受 / 用药与身体 / 家庭沟通。 */
function vMind() {
  const p = P();
  const i = state.sub.mind || 0;
  const all = p.viewpoints || [];
  const bodyRelated = all.filter(v => /药|肿|泻|手脚|脱皮|累|疲|身体/.test(v[2]));
  const notice = `<div class="notice violet">这里的内容<b>默认私密</b>：不进导出、不进看板摘要；只有你显式开放时才会出现在就诊材料里。</div>`;
  const bodies = [
    `<div class="card"><div class="card-head"><h2>当下感受</h2>${pill('私密', 'violet')}</div>
      ${all.map(v => row(`<b>${esc(v[0])} · ${esc(v[1])}</b>`, esc(v[2]), pill('不是医生结论', 'grey'))).join('')}
      <div class="actions"><button class="soft" data-action="add-viewpoint">记一条感受</button></div></div>`,
    `<div class="card"><div class="card-head"><h2>用药与身体</h2>${pill('私密', 'violet')}</div>
      ${bodyRelated.length ? bodyRelated.map(v => row(`<b>${esc(v[0])} · ${esc(v[1])}</b>`, esc(v[2]))).join('') : row('<b>暂无记录</b>', '长期吃药带来的疲惫、水肿、手脚反应，愿意的时候再写；这条只属于你。')}
      <p class="small-note">"每天吃药像提醒自己得过病"这类感受在长期辅助治疗里很常见；记录只属于你，是否与家人、医生分享由你决定。</p></div>`,
    `<div class="card"><div class="card-head"><h2>想对家人说 / 家庭沟通</h2></div>
      ${row('<b>待沟通</b>', esc(p.familyTalk))}
      <p class="small-note">怎么跟家人说病情、说到什么程度，没有标准答案；这里只留你想说的话。</p></div>`
  ];
  return `<div class="page-enter">${pageHead(true)}${notice}
  <div class="dash-cols"><div class="stack">${bodies[i] || bodies[0]}</div>
  <div class="stack"><div class="card"><div class="card-head"><h2>本周活动</h2></div>
    ${row('<b>活动量</b>', esc(p.activity))}
    <p class="small-note">运动以你能承受的强度为准；是否调整由医生或康复师决定。</p></div></div></div></div>`;
}

/* 复诊准备 3 页签：复查节奏 / 出血与急症 / 就诊准备。 */
function vReview() {
  const p = P();
  const i = state.sub.review || 0;
  const rhythm = p.rhythm.map(r => row(`<b>${esc(r[0])}</b>`, `${esc(r[1])} — ${esc(r[2])}`, `<small>${esc(r[3])}</small>`)).join('');
  const mon = (p.monitor && p.monitor.rows) || [];
  const monitorCard = mon.length ? `<div class="card">${mon.map(r => row(`<b>${esc(r[0])}</b>`, `${esc(r[1])}　上次：${esc(r[2])}　下次：${esc(r[3])}`, `<small style="max-width:220px;text-align:right">${esc(r[4])}</small>`)).join('')}
    <p class="small-note">这一栏只抄录医生的安排与原话，<b>不推算该多久查一次</b>。没有这一项安排的档案不会出现该行。</p></div>`
    : `<div class="empty"><h3>本档案没有复查安排记录</h3><p>复查间隔由部位、危险度、治疗阶段决定；工作台只记录医生给出的节点。</p></div>`;
  const bleeds = (p.bleeds && p.bleeds.rows) || [];
  const bleedCard = bleeds.length ? `<div class="card">${bleeds.map(r => row(`<b>${esc(r[0])} · ${esc(r[1])}</b>`, esc(r[2]), pill('已记录', 'grey'))).join('')}
    <p class="small-note">按发生日期记录：什么表现、当时血红蛋白多少、做了什么处理（医生做的）。<b>工作台不判断严重度，也不给处理建议</b>。</p></div>`
    : `<div class="empty"><h3>没有出血或急症记录</h3><p>发生时才记；没有记录通常是好事，但不代表可以跳过复查。</p></div>`;
  const prep = `<div class="card"><div class="card-head"><h2>这次想问的</h2><span class="source-link">按重要性自己排</span></div>
    ${row('<b>病理与危险度</b>', '这次报告里的部位、大小、核分裂、破裂；危险度按哪套标准给的。')}
    ${row('<b>用药</b>', '现在剂量；这周期有没有漏服、有没有减量，原因是什么。')}
    ${row('<b>副作用</b>', '水肿、腹泻、乏力、手足反应到了几级；影响不影响日常生活。')}
    ${row('<b>检查</b>', '上次影像的结论原文；下次安排在什么时候、查什么。')}
    <p class="small-note">清单只是提示，不用每条都问；把最想问的两三条写在最前面即可。</p></div>
    <div class="card"><div class="card-head"><h2>我的看法（不是医生结论）</h2></div>
    ${(p.viewpoints || []).slice(0, 2).map(v => row(`<b>${esc(v[0])} · ${esc(v[1])}</b>`, esc(v[2]), pill('不是医生结论', 'grey'))).join('') || row('<b>还没有记录</b>', '在「心理支持」里写下的感受会出现在这里。')}
    <p class="small-note">"我的看法"与医生的结论分开保存，导出时也分开；这样讨论时不会把感受当成诊断。</p>
    <div class="actions"><button class="primary" data-action="export-review">导出这份复诊清单</button></div></div>`;
  const bodies = [
    `<div class="section-title"><h2>复查节奏</h2><span class="source-link">以医生安排为准</span></div><div class="card">${rhythm}
      <p class="small-note">以上为医生安排与常见节奏摘录，仅供准备讨论；实际安排以你的医生为准。</p></div>
      <div class="section-title"><h2>随访与检查安排</h2><span class="source-link">只记医生安排</span></div>${monitorCard}`,
    `<div class="notice danger">出现<b>呕血、黑便、突发剧烈腹痛、持续高热</b>时不要等下次门诊，按医院急诊流程处理。下面只是把发生过的事记下来，不是处理指南。</div>
      <div class="section-title"><h2>出血与急症事件</h2><span class="source-link">只记发生与处理经过</span></div>${bleedCard}`,
    prep
  ];
  return `<div class="page-enter">${pageHead(true)}${bodies[i] || bodies[0]}</div>`;
}

function vTrials() {
  const i = state.sub.trials || 0;
  const list = TRIALS.map(t => `<div class="card" style="margin-bottom:10px"><div class="card-head"><h2>${esc(t.id)}</h2>${pill(t.status, /招募|进行/.test(t.status) ? 'green' : 'grey')}</div>
    ${row(`<b>${esc(t.title)}</b>`, `${esc(t.phase)} · ${esc(t.sponsor)}`, `<a class="source-link" href="${esc(t.url)}" target="_blank" rel="noopener">登记页</a>`)}
    <div class="actions"><button class="soft" data-action="save-trial" data-id="${esc(t.id)}">${state.saved.includes(t.id) ? '已收藏' : '收藏'}</button><button class="soft" data-action="ask-trial" data-id="${esc(t.id)}">加进入组问题</button></div></div>`).join('');
  const saved = state.saved.length ? state.saved.map(id => { const t = TRIALS.find(x => x.id === id); return t ? `<div class="card" style="margin-bottom:10px">${row(`<b>${esc(t.id)}</b>`, esc(t.title), `<a class="source-link" href="${esc(t.url)}" target="_blank" rel="noopener">登记页</a>`)}</div>` : ''; }).join('') : `<div class="empty"><h3>还没有收藏</h3><p>在看线索时点"收藏"，会留在这里，方便复诊前一起看。</p></div>`;
  const qs = ['我的部位（胃 / 小肠）、危险度与基因型，是否符合这条试验的入组条件？', '这条试验要求既往用过哪些 TKI、用到什么程度？我现在符合吗？', '如果参加，随访地点和频率对我的生活影响有多大？', '不参加的话，标准治疗是什么？两者我该怎么权衡？'];
  const bodies = [
    `<div class="notice">线索不是推荐：下面 ${TRIALS.length} 条来自 2026 年首次公示的真实登记摘录，<b>状态为登记状态，未核实、也不等于入组资格</b>。</div>${list}`,
    saved,
    `<div class="card"><div class="card-head"><h2>入组前该问的问题</h2><span class="source-link">按顺序问，不跳步</span></div>
      ${qs.map(q => row(`<b>${esc(q)}</b>`, ''))}
      <p class="small-note">工作台不排序、不预测、不替你判断哪条更好；是否入组由研究团队评估与你自己决定。</p></div>`
  ];
  return `<div class="page-enter">${pageHead(true)}${bodies[i] || bodies[0]}</div>`;
}

const VIEWS = { dashboard: vDashboard, records: vRecords, pathology: vPathology, treatment: vTreatment, meds: vMeds, labs: vLabs, timeline: vTimeline, nutrition: vNutrition, mind: vMind, review: vReview, trials: vTrials };

/* ---------------- agent dock（dsh 原生会话挂载位） ---------------- */
const FORBIDDEN = ['建议治疗', '可能复发', '预后良好', '治愈率', '可以停药', '无需就医', '推荐方案', '生存率'];
const PAGE_CONTEXT = {
  dashboard: () => ({ facts: [`${P().name}：${P().headline}`,
    `危险度：${((P().risk && P().risk.rows) || []).map(r => `${r[0]} ${r[1]}`).join('；') || '未记录'}`,
    `当前用药：${((P().meds && P().meds.rows) || []).filter(r => r[5] === '在用').map(r => `${r[0]} ${r[1]}`).join('、') || '未记录'}`],
    missing: ['下次复查的具体日期', '最近的服药记录'] }),
  records: () => ({ facts: [`资料库 ${DOCS[state.profile].length} 份；待核对候选 ${CANDS[state.profile].filter(c => c.status !== 'accepted').length} 条`], missing: [] }),
  pathology: () => ({ facts: [`部位：${P().path[0]}；危险度：${P().path[1]}；阶段：${P().stage}`,
    ...((P().risk && P().risk.rows) || []).map(r => `${r[0]}：${r[1]}（${r[2]}）`),
    ...P().molecular.map(x => `${x.k}：${x.v}（${x.src}）`)],
    missing: P().molecular.filter(x => x.state === 'na').map(x => `${x.k} 检测状态`) }),
  treatment: () => ({ facts: ((P().pathway && P().pathway.rows) || []).map(r => `${r[0]}路径：${r[1]}（${r[2]}）`), missing: ['下次评估的具体结论'] }),
  meds: () => ({ facts: ((P().meds && P().meds.rows) || []).map(r => `${r[0]} ${r[1]}（${r[3]} → ${r[4] || '至今'}，${r[5]}）`),
    missing: ['最近一次漏服的处理方式'] }),
  labs: () => ({ facts: Object.values(M()).filter(m => m.points && m.points.length).map(m => `${m.name} 最近：${String(m.points.slice(-1)[0].v)}（${m.points.slice(-1)[0].d}）`),
    missing: ['下次影像的具体安排'] }),
  timeline: () => ({ facts: ['一图秀当前勾选：' + state.sel.map(k => M()[k] ? M()[k].name : k).join('、')], missing: [] }),
  nutrition: () => ({ facts: ((P().nutrition && P().nutrition.rows) || []).slice(0, 3).map(r => `${r[0]} ${r[1]}：${r[2]}，${r[3]}，症状：${r[4]}`),
    missing: ['营养门诊的下一次安排'] }),
  mind: () => ({ facts: ['本页内容默认私密，提示词不携带具体感受原文'], missing: [] }),
  review: () => ({ facts: P().rhythm.map(r => `${r[0]}：${r[1]}（${r[2]}）`), missing: ['想问清单中 1 条待确认'] }),
  trials: () => ({ facts: ['2026 线索共 ' + TRIALS.length + ' 条（真实登记摘录，状态未核实）'], missing: [] })
};

function buildPrompt() {
  const ctx = PAGE_CONTEXT[state.view]();
  const title = PAGES.find(p => p[0] === state.view)[1];
  return [`【来自小吉宝工作台 · ${title}页】`, `档案：${P().name}（${P().meta}）——演示数据`, '',
    '本页已核对的事实：', ...ctx.facts.map(f => '- ' + f), '',
    '尚未核对 / 待确认：', ...(ctx.missing.length ? ctx.missing.map(f => '- ' + f) : ['- （无）']), '',
    '边界：以上是记录整理，不是医疗建议；请基于原文与医生沟通，不要求工作台外推结论。'].join('\n');
}
function mockReply() {
  return '根据你整理的本页事实：这些记录显示治疗在按计划推进，复查节奏也有依据。你提到的未确认事项（未检测的基因项、下次影像日期），适合在下次门诊清单里逐条向医生确认。本回复不构成医疗建议。';
}
const agentOpen = () => state.agentPhase === 'open';

/* ---------------- 面板宽度：拖动分隔条 / 键盘 / 窄标准宽 / 记忆 ----------------
   比例存在 state.agentRatio（占工作区宽度），渲染时换算成像素写进 CSS 变量 --agent-w。
   宽度数字只有 AGENT_PANE 一份（接口下发，兜底值同源 lib/layout.js），客户端不再写死 376/499。 */
function clampRatio(r) {
  const n = Number(r);
  if (!Number.isFinite(n)) return AGENT_PANE.def;
  return Math.min(AGENT_PANE.max, Math.max(AGENT_PANE.min, n));
}
function readStoredRatio() {
  try {
    const v = Number(localStorage.getItem(AGENT_STORE_KEY));
    return Number.isFinite(v) && v > 0 ? clampRatio(v) : null;
  } catch { return null; }
}
function storeRatio(r) {
  try { localStorage.setItem(AGENT_STORE_KEY, String(r)); } catch { /* 隐私模式/禁存：不影响本次会话 */ }
}
function gridWidth() {
  const g = $('#work-grid');
  const rect = g && typeof g.getBoundingClientRect === 'function' ? g.getBoundingClientRect() : null;
  return rect && rect.width ? rect.width : 0;
}
function applyAgentWidth() {
  const grid = $('#work-grid'), sp = $('#agent-splitter');
  if (!grid) return;
  const ratio = clampRatio(state.agentRatio);
  const total = gridWidth();
  /* 宽度未知（首帧/无布局的测试环境）时按 1000px 基准换算，保证变量仍是合法像素值 */
  grid.style.setProperty('--agent-w', `${Math.round((total || 1000) * ratio)}px`);
  if (sp) {
    sp.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    sp.setAttribute('aria-valuetext', `会话面板占 ${Math.round(ratio * 100)}%`);
  }
  $$('.agent-sizes button').forEach((b) => {
    const want = AGENT_PANE.presets ? AGENT_PANE.presets[b.dataset.size] : null;
    b.setAttribute('aria-pressed', String(want !== null && want !== undefined && Math.abs(want - ratio) < 0.02));
  });
}
function setAgentRatio(r, persist = true) {
  state.agentRatio = clampRatio(r);
  if (persist) storeRatio(state.agentRatio);
  applyAgentWidth();
}
function initSplitter() {
  const sp = $('#agent-splitter'), grid = $('#work-grid');
  if (!sp || !grid || typeof sp.addEventListener !== 'function') return;
  const onMove = (e) => {
    const rect = typeof grid.getBoundingClientRect === 'function' ? grid.getBoundingClientRect() : null;
    if (!rect || !rect.width) return;
    setAgentRatio((rect.right - e.clientX) / rect.width, false);   // 拖动中不写 localStorage，松手再存
  };
  const stop = () => {
    if (typeof document.removeEventListener === 'function') {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', stop);
    }
    if (grid.classList) grid.classList.remove('agent-dragging');
    if (document.body && document.body.classList) document.body.classList.remove('agent-dragging');
    storeRatio(state.agentRatio);
  };
  sp.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (grid.classList) grid.classList.add('agent-dragging');
    if (document.body && document.body.classList) document.body.classList.add('agent-dragging');
    if (typeof document.addEventListener === 'function') {
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', stop);
    }
  });
  sp.addEventListener('keydown', (e) => {
    const step = (AGENT_PANE.step || 24) / (gridWidth() || 1000);
    if (e.key === 'ArrowLeft') { e.preventDefault(); setAgentRatio(state.agentRatio + step); }        // 面板变宽
    else if (e.key === 'ArrowRight') { e.preventDefault(); setAgentRatio(state.agentRatio - step); }   // 面板变窄
    else if (e.key === 'Home') { e.preventDefault(); setAgentRatio(AGENT_PANE.min); }
    else if (e.key === 'End') { e.preventDefault(); setAgentRatio(AGENT_PANE.max); }
  });
  /* 窗口变宽变窄后按同一比例重算像素，避免面板吃掉整个业务区 */
  if (typeof window.addEventListener === 'function') window.addEventListener('resize', () => { if (agentOpen()) applyAgentWidth(); });
}

function renderAgent() {
  const dock = $('#agent-dock'), grid = $('#work-grid'), btn = $('#agent-toggle');
  const ph = state.agentPhase, open = ph === 'open';
  dock.hidden = !open;
  grid.classList.toggle('agent-open', open);
  const sp = $('#agent-splitter');
  if (sp) sp.hidden = !open;          // 分隔条只在面板展开时可拖
  if (open) applyAgentWidth();
  const label = AGENT_LABEL[ph] || AGENT_LABEL.idle;
  if (btn) {
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', `AI 对话：${label}`);
    btn.disabled = (ph === 'connecting' || ph === 'unavailable');
    const span = $('#agent-label'); if (span) span.textContent = label;
    const dot = btn.querySelector('i');
    if (dot) { dot.classList.toggle('grey', !open); dot.classList.toggle('on', open); }
  }
  const hide = $('#agent-hide'); if (hide) hide.hidden = !open;         // × 只在展开时出现
  const hint = $('#top-hint'); if (hint) hint.textContent = AGENT_HINT[ph] || AGENT_HINT.idle;
  const dot2 = $('#agent-dot'); if (dot2) dot2.classList.toggle('on', open);
  const body = $('#agent-body');
  if (!body.dataset.built) {
    body.innerHTML = `<div class="agent-note"><b>dsh 原生会话挂载位</b><br>原生会话仅在 DSH Desktop 内可用；当前为浏览器预览，这里保留宿主会话的挂载点（#dsh-conversation-slot），不模拟聊天窗口。</div>
      <div id="dsh-conversation-slot" aria-live="polite"></div>`;
    body.dataset.built = '1';
  }
}
/* 顶栏主按钮与「×」共用这一个动作：它只切换面板显隐，不创建/销毁会话。
   无会话时先 idle → connecting（按钮禁用，防重复创建）→ open。 */
function toggleAgent() {
  const ph = state.agentPhase;
  if (ph === 'connecting' || ph === 'unavailable') return;
  if (ph === 'open') { state.agentPhase = 'closed'; renderAgent(); return; }  // 收起：会话仍在
  if (ph === 'closed') { state.agentPhase = 'open'; renderAgent(); return; }  // 回到同一会话
  state.agentPhase = 'connecting'; renderAgent();
  setTimeout(() => { if (state.agentPhase === 'connecting') { state.agentPhase = 'open'; renderAgent(); } }, 600);
}
/* 看板等入口只负责「打开」：已展开就不动，其余走 toggleAgent，避免把按钮点成收起 */
function openAgent() {
  if (state.agentPhase === 'unavailable') { toast(AGENT_HINT.unavailable); return; }
  if (state.agentPhase === 'open') { toast('会话面板已经打开；× 只是收起，不会结束会话'); return; }
  toggleAgent();
  toast('AI 对话面板已打开；× 只是收起，不会结束会话');
}
function agentBuild() {
  const slot = $('#dsh-conversation-slot');
  slot.innerHTML = `<div class="agent-card"><h4>提示词预览（发送前可读 · 由你在宿主会话发送）</h4><pre>${esc(buildPrompt())}</pre></div>`;
}
function agentDemo() {
  const slot = $('#dsh-conversation-slot');
  const text = mockReply();
  const hits = FORBIDDEN.filter(w => text.includes(w));
  slot.innerHTML = `<div class="agent-card"><h4>模拟回复 · 红线自检</h4><pre>${esc(text)}</pre>
    <div class="agent-check">${hits.length ? hits.map(h => `<span class="hit">命中禁用词：${esc(h)}</span>`).join('') : '<span class="pass">✓ 未命中禁用词表（' + FORBIDDEN.length + ' 项）</span><span class="pass">✓ 免责语句在否定语境中出现</span>'}</div></div>`;
}

/* ---------------- dialogs / toast ---------------- */
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('visible'), 2200); }
function openDialog(eyebrow, title, body, foot = '') {
  $('#dialog-eyebrow').textContent = eyebrow; $('#dialog-title').textContent = title;
  $('#dialog-body').innerHTML = body; $('#dialog-foot').innerHTML = foot;
  $('#dialog').showModal();
}
const closeDialog = () => $('#dialog').close();

function dlgProfiles() {
  openDialog('小吉宝', '切换演示档案', Object.entries(PROFILES).map(([k, p]) => `
    <button class="profile-row ${state.profile === k ? 'on' : ''}" data-pick-profile="${k}">
      <div><b>${esc(p.name)}的资料</b><p>${esc(p.meta)} · ${esc(p.headline)}</p></div><span class="profile-caret">${state.profile === k ? '当前' : '切换'}</span></button>`).join(''),
    '<button data-action="close">取消</button>');
}
/* 设置页那行 Token 状态：只显示来源与掩码，绝不回显整串。没拉到就明说没拉到。 */
function mineruLine() {
  const m = state.mineru;
  if (!m) return '正在读取解析配置…';
  if (!m.configured) return 'MINERU_TOKEN 未配置：解析功能不可用（导入与手工补录不受影响）';
  return `MINERU_TOKEN 已配置（来源：${m.source}｜掩码：${m.masked}）`;
}
function loadMineruStatus() {
  let p;
  try { p = fetch(`${apiBase()}/api/mineru`); } catch (e) { return Promise.resolve(null); }
  return Promise.resolve(p)
    .then((r) => (r && r.ok !== false ? r.json() : null))
    .then((j) => { state.mineru = j; return j; })
    .catch(() => null);
}
function dlgSettings() {
  openDialog('小吉宝', '设置', `<div class="cfg-tabs" role="tablist">
  <button role="tab" aria-selected="true" data-action="cfg-tab" data-tab="ws">资料目录</button><button role="tab" aria-selected="false" data-action="cfg-tab" data-tab="parse">文档解析</button><button role="tab" aria-selected="false" data-action="cfg-tab" data-tab="kb">临床数据库</button></div>
  <div class="cfg-block" style="margin-top:16px" data-tab="ws"><h3>工作区资料目录</h3><div class="path-row"><code>~/Documents/GistPalWorkspace（演示值）</code><button class="soft">选择…</button></div>
  <p class="small-note">患者数据只存入你明确选择的目录；工作台不把资料上传云端。</p></div>
  <div class="cfg-block" style="margin-top:12px" data-tab="parse" hidden><h3>文档解析（MinerU）</h3><div class="token-row"><code class="masked">${mineruLine()}</code></div>
  <p class="small-note">Token 只从环境变量 <code>MINERU_TOKEN</code> 或本机 <code>.secrets/mineru.json</code>（mode 600）读，不进仓库、不进日志、不进发布包。</p>
  <p class="small-note">解析会把<b>原件上传到 mineru.net</b>，必须由你在资料库里点「解析」才会发生；解析结果永远是候选，逐条核对后才入档。</p></div>
  <div class="cfg-block" style="margin-top:12px" data-tab="kb" hidden><h3>2026 临床数据库</h3><div class="path-row"><code>gist_cancer_trials_2026.sqlite · 16 条（演示）</code></div>
  <p class="small-note">离线快照；中国注册库未采集，覆盖未知。</p></div>`, '<button class="primary" data-action="close">完成</button>');
}
function dlgAbout() {
  openDialog('小吉宝', '关于', `<div class="about"><div class="brand no-mark" style="zoom:2.2"></div><div class="about-meta">
    <div class="about-ver"><b>v${APP_INFO.version}</b>${pill(APP_INFO.channelLabel, 'violet')}</div>
    <dl><div><dt>构建</dt><dd>${APP_INFO.build}</dd></div><div><dt>形态</dt><dd>交互原型（单机多文件）· 全部患者数据为模拟</dd></div>
    <div><dt>数据</dt><dd>2026 临床试验：真实登记摘录（ClinicalTrials.gov），状态未核实</dd></div>
    <div><dt>家族</dt><dd>小 X 宝家族 · GistPal 小吉宝</dd></div></dl></div></div>`, '<button class="primary" data-action="close">关闭</button>');
}
function dlgHelp() {
  openDialog('小吉宝', '原型操作说明', `<div class="cfg-block">顶栏「AI 对话」按钮打开右侧<b>原生会话挂载位</b>（可 × 隐藏、窄/标准/宽三档）。「整理本页要点」生成发送前可读的提示词；「模拟回复自检」演示文本层红线扫描。</div>
  <div class="cfg-block" style="margin-top:12px">「检查与指标」「看板」里的数值卡<b>轻点翻面</b>看参考区间；分级记录（水肿、乏力、腹泻、手足反应）不翻面、不连线。「病情一图秀」左侧可勾选指标、拖动缩放。</div>
  <div class="cfg-block" style="margin-top:12px">左上角头像可切换<b>三套演示档案</b>：顾文琴（胃体 GIST 6.8 cm 高危 R0 术后 · 伊马替尼辅助）、罗建平（小肠 GIST 术后肝转移 · 伊马替尼加量后进展，舒尼替尼二线）、邱惠兰（胃底 8.2 cm · 未手术 · 伊马替尼术前治疗，危险度待定）。</div>`, '<button class="primary" data-action="close">知道了</button>');
}
/* ---------------- 写命令（开发版真实落库；原型只有 toast） ----------------
 * 三条边界：
 * 1) 表单只收「事实」：日期、原文、数值。分级与处理方式照抄，不做下拉预判；
 * 2) 保存失败要把后端 message 原样显示（"日期不能晚于今天"这种话不能让用户猜）；
 * 3) 保存成功后重新拉 bootstrap 再渲染——不自己拼状态，避免前端和库里两份事实。 */
function postCommand(path, body) {
  return fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  }).then(async (r) => {
    let j = null;
    try { j = await r.json(); } catch { j = null; }
    if (!r.ok) {
      const why = (j && j.message) || `HTTP ${r.status}`;
      const err = new Error(why);
      err.code = j && j.error;
      throw err;
    }
    return j;
  });
}

/** 写成功后的统一收尾：提示 → 重拉 → 重渲染（停在当前页）。 */
function afterWrite(kind, res) {
  const note = res && res.status === 'superseded' ? '已更新为最新一条，旧版本保留' : '已记入资料库';
  toast(`${kind}${note}`);
  return loadBootstrap()
    .then((data) => { buildData(data); render(); })
    .catch(() => toast(`${kind}已保存，但页面刷新失败；刷新一次即可看到`));
}

function dlgAdherence() {
  const p = P();
  const first = (p.meds && p.meds.rows && p.meds.rows[0]) || null;
  const drug = first ? first[0] : '';
  const dose = first ? first[1] : '';
  openDialog('记一次服药', '今天的药吃了吗', `
  <div class="cfg-block">
    <label style="display:block;margin-bottom:10px">日期
      <input id="log-date" type="date" value="${todayISO()}" max="${todayISO()}" style="display:block;width:100%;margin-top:6px"></label>
    <label style="display:block;margin-bottom:10px">药物
      <input id="log-drug" value="${esc(drug)}" placeholder="照医嘱原文写" style="display:block;width:100%;margin-top:6px"></label>
    <label style="display:block;margin-bottom:10px">计划剂量
      <input id="log-planned" value="${esc(dose)}" style="display:block;width:100%;margin-top:6px"></label>
    <label style="display:block;margin-bottom:10px">实际
      <input id="log-taken" value="${esc(dose)}" placeholder="按计划 / 漏服 / 减到 300 mg" style="display:block;width:100%;margin-top:6px"></label>
    <label style="display:block">备注（可选）
      <input id="log-note" placeholder="为什么漏服、当天有没有吐" style="display:block;width:100%;margin-top:6px"></label>
  </div>
  <p class="small-note" style="margin-top:12px">工作台只记录事实，不算依从率、不评价该不该减量。</p>`,
  '<button class="soft" data-action="close">取消</button><button class="primary" data-action="save-adherence">保存</button>');
}

function dlgViewpoint() {
  openDialog('记一条感受', '我怎么想的', `
  <div class="cfg-block">
    <label style="display:block;margin-bottom:10px">日期
      <input id="vp-date" type="date" value="${todayISO()}" max="${todayISO()}" style="display:block;width:100%;margin-top:6px"></label>
    <label style="display:block;margin-bottom:10px">心情（可选，一两个词）
      <input id="vp-mood" placeholder="发怵 / 踏实一点 / 说不清" style="display:block;width:100%;margin-top:6px"></label>
    <label style="display:block">想记的话
      <textarea id="vp-text" rows="5" placeholder="照自己的话说，不用写得像病历" style="display:block;width:100%;margin-top:6px;padding:10px;border:1px solid #d8e0ea;border-radius:10px;font:inherit"></textarea></label>
  </div>
  <p class="small-note" style="margin-top:12px">这条只作为「一条信息」记录，<b>不是医生结论</b>；不进趋势，也不进摘要事实区。</p>`,
  '<button class="soft" data-action="close">取消</button><button class="primary" data-action="save-viewpoint">保存</button>');
}

function saveAdherence() {
  return postCommand('/api/adherence', {
    profile: state.profile,
    date: $('#log-date').value,
    drug: $('#log-drug').value,
    planned: $('#log-planned').value,
    taken: $('#log-taken').value,
    note: $('#log-note').value
  }).then((res) => { closeDialog(); return afterWrite('服药记录', res); })
    .catch((e) => toast(`没能保存：${e.message}`));
}

function saveViewpoint() {
  return postCommand('/api/viewpoints', {
    profile: state.profile,
    date: $('#vp-date').value,
    mood: $('#vp-mood').value,
    text: $('#vp-text').value
  }).then((res) => { closeDialog(); return afterWrite('这条感受', res); })
    .catch((e) => toast(`没能保存：${e.message}`));
}

function dlgSideEffect() {
  openDialog('记一次反应', '这几天有什么反应', `
  <div class="cfg-block">
    <label style="display:block;margin-bottom:10px">日期
      <input id="se-date" type="date" value="${todayISO()}" max="${todayISO()}" style="display:block;width:100%;margin-top:6px"></label>
    <label style="display:block;margin-bottom:10px">表现（照自己的说法写，如眼睑水肿、乏力、腹泻）
      <input id="se-term" placeholder="哪里不舒服、什么样" style="display:block;width:100%;margin-top:6px"></label>
    <label style="display:block;margin-bottom:10px">分级（照医生或随访记录原文，没有就留空）
      <input id="se-grade" placeholder="1 级 / 2 级 / 记录里怎么写就怎么抄" style="display:block;width:100%;margin-top:6px"></label>
    <label style="display:block;margin-bottom:10px">当时的处理（继续 / 减量 / 暂停 / 对症，照实际写）
      <input id="se-action" placeholder="继续原剂量、加用止泻药…" style="display:block;width:100%;margin-top:6px"></label>
    <label style="display:block">备注（可选）
      <input id="se-note" placeholder="持续几天、有没有影响吃饭睡觉" style="display:block;width:100%;margin-top:6px"></label>
  </div>
  <p class="small-note" style="margin-top:12px">分级按医生写的抄，工作台<b>不替你判断严重程度、不建议该不该停药</b>；出现呕血、黑便、突发剧烈腹痛、持续高热请直接走急诊流程。</p>`,
  '<button class="soft" data-action="close">取消</button><button class="primary" data-action="save-side-effect">保存</button>');
}

function saveSideEffect() {
  return postCommand('/api/side-effects', {
    profile: state.profile,
    date: $('#se-date').value,
    term: $('#se-term').value,
    grade: $('#se-grade').value,
    action: $('#se-action').value,
    note: $('#se-note').value
  }).then((res) => { closeDialog(); return afterWrite('这条反应', res); })
    .catch((e) => toast(`没能保存：${e.message}`));
}

function dlgMetric() {
  const m = M();
  /* 只列这个档案已经有记录的指标：没有记录时不在这里新建一条线，
     避免一图秀多出没人认识的曲线（未定义指标服务端也会拒）。 */
  const keys = Object.keys(m).filter((k) => m[k].points.length);
  const opts = keys.map((k) => `<option value="${esc(k)}">${esc(m[k].name)}${m[k].unit ? `（${esc(m[k].unit)}）` : ''}${m[k].kind && m[k].kind !== 'numeric' ? ' · 分级' : ''}</option>`).join('');
  openDialog('补录一个值', '这次检查的结果', `
  <div class="cfg-block">
    <label style="display:block;margin-bottom:10px">指标
      <select id="mp-metric" style="display:block;width:100%;margin-top:6px">${opts || '<option value="">这个档案还没有指标</option>'}</select></label>
    <label style="display:block;margin-bottom:10px">日期
      <input id="mp-date" type="date" value="${todayISO()}" max="${todayISO()}" style="display:block;width:100%;margin-top:6px"></label>
    <label style="display:block;margin-bottom:10px">数值 / 分级原文
      <input id="mp-value" placeholder="数值指标填数字；分级指标照记录写，如 2 级" style="display:block;width:100%;margin-top:6px"></label>
    <label style="display:block">来源（可选）
      <input id="mp-src" placeholder="哪家医院 / 哪次化验" style="display:block;width:100%;margin-top:6px"></label>
  </div>
  <p class="small-note" style="margin-top:12px">补录只加一个点，不改历史点；同一天同一指标改了值会保留前一版。工作台<b>不判断这个值好不好、不据此给用药方向</b>。</p>`,
  '<button class="soft" data-action="close">取消</button><button class="primary" data-action="save-metric">保存</button>');
}

function saveMetric() {
  return postCommand('/api/metric-points', {
    profile: state.profile,
    metric: $('#mp-metric').value,
    date: $('#mp-date').value,
    value: $('#mp-value').value,
    src: $('#mp-src').value
  }).then((res) => { closeDialog(); return afterWrite('这个数值', res); })
    .catch((e) => toast(`没能保存：${e.message}`));
}

function dlgNutrition() {
  const slots = ['早餐', '上午加餐', '午餐', '下午加餐', '晚餐', '夜间加餐'];
  openDialog('记一笔进食', '这一顿吃了什么', `
  <div class="cfg-block">
    <label style="display:block;margin-bottom:10px">日期
      <input id="nu-date" type="date" value="${todayISO()}" max="${todayISO()}" style="display:block;width:100%;margin-top:6px"></label>
    <label style="display:block;margin-bottom:10px">餐次
      <select id="nu-slot" style="display:block;width:100%;margin-top:6px">${slots.map((s) => `<option>${s}</option>`).join('')}</select></label>
    <label style="display:block;margin-bottom:10px">份量（按自己的说法，如半碗、一小块）
      <input id="nu-amount" placeholder="半碗 / 一小块" style="display:block;width:100%;margin-top:6px"></label>
    <label style="display:block;margin-bottom:10px">吃了什么
      <input id="nu-foods" placeholder="小米粥、鸡蛋、青菜" style="display:block;width:100%;margin-top:6px"></label>
    <label style="display:block;margin-bottom:10px">吃完有什么（腹胀 / 早饱 / 恶心，没有就写无）
      <input id="nu-symptoms" value="无" style="display:block;width:100%;margin-top:6px"></label>
    <label style="display:block">备注（可选）
      <input id="nu-note" placeholder="吃得比平时少 / 饭后躺了一会儿" style="display:block;width:100%;margin-top:6px"></label>
  </div>
  <p class="small-note" style="margin-top:12px">只记份量、食物和你自己的感受；工作台<b>不做热量换算、不给食谱、不评价吃得够不够</b>。</p>`,
  '<button class="soft" data-action="close">取消</button><button class="primary" data-action="save-nutrition">保存</button>');
}

function saveNutrition() {
  return postCommand('/api/nutrition', {
    profile: state.profile,
    date: $('#nu-date').value,
    slot: $('#nu-slot').value,
    amount: $('#nu-amount').value,
    foods: $('#nu-foods').value,
    symptoms: $('#nu-symptoms').value,
    note: $('#nu-note').value
  }).then((res) => { closeDialog(); return afterWrite('这顿饭', res); })
    .catch((e) => toast(`没能保存：${e.message}`));
}

function dlgExport() {
  const p = P();
  const md = ['# 复诊准备（演示导出）', '', `档案：${p.name}（${p.meta}）`, '', '## 事实区（已核对）', ...p.rhythm.map(r => `- ${r[0]}：${r[1]}（${r[2]}）`), '', '## 想问的事 / 我的看法（不是医生结论）', '- （按页面勾选结果导出；私密条目默认不含）', '', '> 本文件由工作台整理，不构成医疗建议。'].join('\n');
  openDialog('小吉宝', '导出编辑（Markdown）', `
    <textarea id="export-edit" aria-label="导出内容，可直接编辑" style="width:100%;min-height:320px;font:12px/1.7 ui-monospace,SFMono-Regular,monospace;padding:12px;border:1px solid #d8e0ea;border-radius:10px;background:#fff;color:#213139;resize:vertical">${esc(md)}</textarea>
    <p class="small-note">直接在上方编辑；「我的看法」区永远带"不是医生结论"标注。保存到资料目录的是编辑后的全文。</p>`,
    '<button class="soft" data-action="close">取消</button><button class="primary" data-action="export-save">保存到资料目录</button>');
}

/* ---------------- render root ---------------- */
/* 数字刷动：渲染后从 0 滚动到目标值（easeOutCubic，650ms；reduced-motion 直接显示终值） */
function animateCountups(root) {
  if (!root || typeof root.querySelectorAll !== 'function' || typeof requestAnimationFrame !== 'function') return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const DUR = 650;
  root.querySelectorAll('[data-countup]').forEach((el) => {
    const target = parseFloat(el.dataset.countup);
    if (!isFinite(target)) return;
    const dec = el.dataset.dec === undefined ? 1 : +el.dataset.dec;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / DUR);
      const ease = 1 - Math.pow(1 - k, 3);
      el.textContent = (target * ease).toFixed(dec);
      if (k < 1) requestAnimationFrame(step); else el.textContent = target.toFixed(dec);
    };
    el.textContent = (0).toFixed(dec);
    requestAnimationFrame(step);
  });
}

function render() {
  const p = P();
  $('#nav').innerHTML = PAGES.map(([id, label, ic]) => {
    const count = id === 'trials' ? TRIALS.length : null;
    return `<button class="nav-button" data-nav="${id}" ${state.view === id ? 'aria-current="page"' : ''}>${icon(ic)}<span>${esc(label)}</span>${count ? `<span class="nav-count">${count}</span>` : ''}</button>`;
  }).join('');
  $('#breadcrumb').textContent = PAGES.find(x => x[0] === state.view)[1];
  $('#profile-name').textContent = `${p.name}的资料`;
  $('#profile-meta').textContent = p.meta;
  $('#profile-avatar').textContent = p.name[0];
  $('#main').innerHTML = (VIEWS[state.view] || vDashboard)();
  $('#main').classList.remove('page-enter');
  animateCountups($('#main'));
  renderAgent();
  if (state.agentOpen) $('#agent-body').dataset.built = ''; // 换页后重建挂载位提示
}

/* ---------------- events ---------------- */
document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { state.view = nav.dataset.nav; location.hash = state.view; render(); $('#main').focus({ preventScroll: true }); window.scrollTo(0, 0); return; }
  const sub = e.target.closest('[data-sub]');
  if (sub) { state.sub[state.view] = +sub.dataset.sub; render(); return; }
  const pick = e.target.closest('[data-pick]');
  if (pick) {
    const k = pick.dataset.pick;
    if (pick.checked) {
      if (state.sel.length >= 4) { pick.checked = false; toast('最多同时看 4 个指标；取消一个再加。'); return; }
      if (!state.sel.includes(k)) state.sel.push(k);
    } else {
      if (state.sel.length === 1) { pick.checked = true; toast('至少留一个指标。'); return; }
      state.sel = state.sel.filter(x => x !== k);
    }
    render(); return;
  }
  const pp = e.target.closest('[data-pick-profile]');
  if (pp) { state.profile = pp.dataset.pickProfile; state.sel = defaultSel(pp.dataset.pickProfile); state.pin = null; closeDialog(); render(); toast(`已切换到 ${P().name}的资料（演示）`); return; }
  const card = e.target.closest('.mcard[data-mcard]');
  if (card && !card.dataset.static) { flipCard(card.dataset.mcard); return; }
  const act = e.target.closest('[data-action]')?.dataset.action;
  if (!act) return;
  const map = {
    profiles: dlgProfiles, settings: dlgSettings, about: dlgAbout, help: dlgHelp,
    close: closeDialog, 'open-store': () => toast('资料目录已激活（演示）'),
    'go-review': () => { state.view = 'review'; location.hash = 'review'; render(); },
    'go-labs': () => { state.view = 'labs'; location.hash = 'labs'; render(); },
    'go-timeline': () => { state.view = 'timeline'; location.hash = 'timeline'; render(); },
    'go-pathology': () => { state.view = 'pathology'; location.hash = 'pathology'; render(); },
    'go-trials': () => { state.view = 'trials'; location.hash = 'trials'; render(); },
    'go-records': () => { state.view = 'records'; location.hash = 'records'; render(); },
    'go-meds': () => { state.view = 'meds'; location.hash = 'meds'; render(); },
    'go-rec-sub': (el) => { state.view = 'records'; state.sub.records = +el.dataset.subI; location.hash = 'records'; render(); },
    'go-nutrition': () => { state.view = 'nutrition'; location.hash = 'nutrition'; render(); },
    source: (el) => {
      const d = el.dataset.doc ? DOCS[state.profile].find((x) => x.id === el.dataset.doc) : null;
      const line = d ? `${d.fileName || d.name}${d.size ? ` · ${fmtSize(d.size)}` : ''}（${d.date}）` : el.dataset.source || '';
      openDialog('小吉宝', '原文出处', `<p style="font-size:12.5px">${esc(line)}</p><p class="small-note">原件存放在你选的资料目录 imports/ 下；工作区不改动原文，也不替你解释它。</p>`, '<button class="primary" data-action="close">关闭</button>');
    },
    'pick-file': () => { const inp = $('#file-picker'); if (inp && typeof inp.click === 'function') inp.click(); else toast('当前浏览器不支持选择本机文件'); },
    'export-save': () => {
      const ta = $('#export-edit');
      const txt = ta ? ta.value.trim() : '';
      if (!txt) { toast('导出内容是空的；先填一点内容再保存。'); return; }
      return postCommand('/api/export', { kind: '复诊准备', text: txt })
        .then((res) => {
          closeDialog();
          toast(`已写入资料目录 exports/${res.path.split('/').pop()}`);
        })
        .catch((e) => toast(`没能保存：${e.message}`));
    },
    'load-report': () => {
      if (state.parsing) return;
      if (state.loaded[state.profile]) { toast('模拟报告已载入，没有重复新增'); return; }
      state.parsing = true; state.parseError = false; render();
      setTimeout(() => {
        DOCS[state.profile].push({ id: 'dx' + state.profile, name: '复查记录 · 新模拟报告', date: '2026-10-18', type: '其他', status: '待核对' });
        CANDS[state.profile].push({ id: 'cx' + state.profile, name: '下次复查安排', value: '2027-01 前后（示例，以医生安排为准）', source: '复查记录 · 新模拟报告 · 第 1 页', status: 'candidate' });
        state.loaded[state.profile] = true; state.parsing = false;
        if (state.view === 'records') render();
        toast('解析完成：候选已放入「整理草稿 / 核对」');
      }, 900);
    },
    'parse-fail': () => {
      const d = DOCS[state.profile].find((x) => x.id === state.lastUpload);
      if (d) d.status = '解析失败';
      state.parseError = true; render();
      toast(d ? `「${d.name}」解析失败：未产生候选，原件保留，可重试` : '模拟解析失败：未产生候选，原件保留');
    },
    retry: () => { state.parseError = false; toast('原件已保留；请点「解析这份材料」重试'); render(); },
    /* 解析一份原件：出本机，必须用户显式确认。失败不产候选，原件保留，可重试。 */
    parse: (el) => {
      const d = DOCS[state.profile].find((x) => x.id === el.dataset.doc);
      if (!d) return;
      const ask = `解析「${d.name}」需要把这份原件上传到 mineru.net（第三方云服务），换回可抄写的文本。\n\n原件仍留在你的资料目录里，解析结果只会进「候选」，逐条核对后才入档。\n\n继续吗？`;
      if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(ask)) return;
      toast(`正在解析「${d.name}」…首次通常 10–60 秒，期间别关页面`);
      return postCommand('/api/parse', { profile: state.profile, id: d.id })
        .then((res) => loadBootstrap().then((data) => {
          buildData(data); render();
          toast(`解析完成：新增 ${res.candidates} 条候选，去「整理草稿 / 核对」逐条看`);
        }))
        .catch((e) => loadBootstrap()
          .then((data) => { buildData(data); render(); })
          .catch(() => null)
          .then(() => toast(`解析失败：${e.message}。原件还在，可以重试或手工补录`)));
    },
    candidate: (el) => {
      const c = CANDS[state.profile].find((x) => x.id === el.dataset.id);
      if (!c) return;
      openDialog('小吉宝', '核对这一项内容',
        `<div class="notice">核对表示"转录已逐字检查过"，不等于医学审核。</div>
        <label style="display:block;margin-top:10px"><span class="form-label">${esc(c.name)}</span><input id="cand-input" style="width:100%" value="${esc(c.value)}" maxlength="160"></label>
        <p class="small-note">来源：${esc(c.source)}。暂时不确定就保留待核对状态，不会丢。</p>`,
        `<button class="soft" data-action="close">现在先不核对</button><button class="primary" data-action="cand-save" data-id="${esc(c.id)}">接受这条记录</button>`);
    },
    'cand-save': (el) => {
      const c = CANDS[state.profile].find((x) => x.id === el.dataset.id);
      const v = $('#cand-input') ? $('#cand-input').value.trim() : '';
      if (!c || !v) { toast('这条内容不能是空的'); return; }
      return postCommand('/api/candidates', { profile: state.profile, id: c.id, value: v, status: 'accepted' })
        .then((res) => {
          closeDialog();
          return loadBootstrap().then((data) => {
            buildData(data); render();
            toast(res.status === 'unchanged' ? '这条此前已接受过，没有改动' : '已接受：候选标为已核对，原件与出处保留');
          });
        })
        .catch((e) => toast(`没能保存：${e.message}`));
    },
    'add-review-question': () => {
      const ASK = {
        A: '请帮我核实：病理报告的核分裂象与肿瘤破裂情况，以及 NGS 扩展检测有没有必要补做。',
        B: '请帮我核实：2026-07 MRI 肝转移灶范围与结论原文，以及舒尼替尼这轮评估的安排。',
        C: '请帮我核实：穿刺标本能否评估核分裂象、危险度什么时候能定，以及 12 月手术评估要带哪些资料。',
      };
      const q = ASK[state.profile] || ASK.A;
      state.questions = state.questions || [];
      if (!state.questions.includes(q)) state.questions.push(q);
      render(); toast('已加入复诊准备的问题清单');
    },
    'add-adherence': dlgAdherence,
    'add-viewpoint': dlgViewpoint,
    'add-side-effect': dlgSideEffect,
    'add-metric': dlgMetric,
    'add-meal': dlgNutrition,
    'save-adherence': saveAdherence, 'save-viewpoint': saveViewpoint, 'save-side-effect': saveSideEffect,
    'save-metric': saveMetric, 'save-nutrition': saveNutrition,
    'add-line': () => toast('新增治疗线需核对方案原件后建立'),
    'export-nutrition': () => toast('就诊展示：最近 10 条进食记录 + 体重趋势（演示）'),
    'export-review': dlgExport,
    'toggle-ask': (el) => { el.textContent = el.textContent.includes('✓') ? '标记已问' : '已问过 ✓'; },
    'save-trial': (el) => { const id = el.closest('[data-action]').dataset.id ?? el.dataset.id; if (state.saved.includes(id)) { state.saved = state.saved.filter(x => x !== id); } else state.saved.push(id); render(); },
    'ask-trial': (el) => { const id = el.closest('[data-action]').dataset.id ?? el.dataset.id; const t = TRIALS.find(x => x.id === id); state.questions = state.questions || []; const q = `${t.id}：入组条件是否包含我的部位、危险度与既往 TKI 用药？`; if (!state.questions.includes(q)) state.questions.push(q); render(); toast('已加入入组问题清单'); },
    range: (el) => { state.range = el.dataset.range; render(); },
    toggle: (el) => { state.toggles[el.dataset.key] = !state.toggles[el.dataset.key]; render(); },
    pin: (el) => { state.pin = { code: el.dataset.code, date: el.dataset.date }; render(); },
    unpin: () => { state.pin = null; render(); },
    zoom: () => {},
    agent: toggleAgent,
    'agent-open': openAgent,
    'agent-build': agentBuild,
    'agent-demo': agentDemo
  };
  if (act === 'agent-size') {
    const size = e.target.closest('[data-action]').dataset.size;
    const want = AGENT_PANE.presets ? AGENT_PANE.presets[size] : null;
    if (want) { state.agentSize = size; setAgentRatio(want); }
    return;
  }
  if (act === 'cfg-tab') {
    const el = e.target.closest('[data-action]');
    document.querySelectorAll('.cfg-tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b === el)));
    document.querySelectorAll('.cfg-block[data-tab]').forEach((b) => { b.hidden = b.dataset.tab !== el.dataset.tab; });
    return;
  }
  if (map[act]) map[act](e.target.closest('[data-action]'));
});
document.addEventListener('input', (e) => {
  if (e.target.matches('[data-action="zoom"]')) { const sib = e.target.nextElementSibling; if (sib) sib.textContent = e.target.value + '%'; }
  if (e.target.matches('[data-action="records-search"]')) {
    state.query = e.target.value;
    const wrap = $('#docs-table'); if (wrap) wrap.innerHTML = docsTable();
  }
});
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'file-picker') { ingestFiles(e.target.files); e.target.value = ''; return; }
  const el = e.target.closest('[data-action]');
  if (el && el.dataset.action === 'zoom') { state.zoom = Number(el.value); render(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#dialog').open) { closeDialog(); return; }
  const card = e.target.closest && e.target.closest('.mcard[data-mcard]:not([data-static])');
  if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); flipCard(card.dataset.mcard); }
});
$('#font-toggle').addEventListener('click', () => { const on = document.body.classList.toggle('large'); $('#font-toggle').setAttribute('aria-pressed', String(on)); });
window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (v && v !== state.view && VIEWS[v]) { state.view = v; render(); } });

/* ---------------- 启动（原型：顶层同步 render()；开发版：数据到位后再 render） ---------------- */
/* 版本号写回顶栏 chip 与页脚；bootstrap 没给就用 APP_INFO 里的默认值。 */
function applyVersion() {
  const chip = $('#ver-chip'), av = $('#app-version'), ab = $('#app-build');
  if (chip) chip.textContent = APP_INFO.displayVersion;
  if (av) av.textContent = APP_INFO.displayVersion;
  if (ab) ab.textContent = APP_INFO.build;
}
function init() {
const initialHash = location.hash.slice(1);
if (VIEWS[initialHash]) state.view = initialHash;
applyVersion();
/* 面板宽度：上次拖到/选到的比例优先，默认 35%（layout.js 的 def） */
const remembered = readStoredRatio();
if (remembered) state.agentRatio = remembered;
initSplitter();
render();
}
/* 数据彻底拿不到时，#main 给出明确说明，不留白屏 */
function bootFail(err) {
  const main = $('#main');
  const why = (err && err.message) ? err.message : String(err);
  if (main) main.innerHTML = `<div class="card" style="max-width:640px;margin:26px auto">
    <div class="card-head"><h2>没能载入工作台数据</h2></div>
    <p style="font-size:12.5px">后端接口 <code>/api/bootstrap</code> 未返回可用数据，页面上也没有可回退的演示数据。</p>
    <p class="small-note">原因：${esc(why)}。请确认服务已启动（<code>/api/bootstrap</code> 可访问）后刷新页面；资料本身不会丢失。</p></div>`;
  if (typeof console !== 'undefined' && console.error) console.error('[gistpal] bootstrap 失败：', err);
}
const bootReady = loadBootstrap().then((data) => { buildData(data); init(); loadMineruStatus(); }).catch(bootFail);
