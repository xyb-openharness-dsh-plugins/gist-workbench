/* public/ 与 prototypes/v0.2/ 的 UI parity 测试（零依赖，node --test）。
   做法：同一份数据（prototypes/v0.2/demo-data.js）分别喂给原型 app.js 与 public/app.js，
   两边都用 new Function(src + 导出语句)() 在最小 DOM shim 里跑起来，
   然后按「11 个一级视图 × 3 个档案 × 每个二级页签」逐个调用 VIEWS[view]() 比对 HTML 字符串。
   差异只允许来自下面 WHITELIST 里明确记录的项（命中会在结尾打印），其它任何不等都算失败。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROTO_DIR = path.join(ROOT, 'prototypes', 'v0.2');
const PUBLIC_DIR = path.join(ROOT, 'public');
const read = (p) => readFileSync(p, 'utf8');

/* ---------------- 数据：JSON.parse 一份 demo-data.js，两边共用 ---------------- */
const demoSrc = read(path.join(PROTO_DIR, 'demo-data.js'));
const DEMO = (() => {
  const w = {};
  (new Function('window', demoSrc))(w);
  return w.DEMO_DATA;
})();
const BOOTSTRAP_OK = { version: '0.1.0', build: '2026-10-21', profiles: DEMO.profiles, trials: DEMO.trials };

/* ---------------- 最小 DOM shim ---------------- */
function mkEl() {
  return {
    innerHTML: '', textContent: '', value: '', hidden: false, open: false, files: [],
    dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } },
    setAttribute() {}, getAttribute() { return 'false'; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {},
    focus() {}, click() {}, showModal() {}, close() {},
    closest() { return null; }, matches() { return false; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    nextElementSibling: null
  };
}
/* 每次执行 app.js 前装一套新的 shim；返回元素表，便于断言 #main 渲染结果 */
function installShim({ hash = '', demoData = null, fetchImpl = null, innerWidth = 1280 } = {}) {
  const els = new Map();
  const document = {
    querySelector(s) { if (!els.has(s)) els.set(s, mkEl()); return els.get(s); },
    querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
    getElementById(id) { return this.querySelector('#' + id); },
    createElement: mkEl,
    body: { classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } } }
  };
  const window = { addEventListener() {}, scrollTo() {}, innerWidth, matchMedia: undefined };
  if (demoData) window.DEMO_DATA = demoData;
  globalThis.window = window;
  globalThis.document = document;
  globalThis.location = { hash };
  globalThis.fetch = fetchImpl;          // 显式给/不给，避免误用 Node 自带 fetch 走真实网络
  globalThis.requestAnimationFrame = undefined;  // 缺失时 animateCountups 必须安全退出
  globalThis.performance = undefined;            // 同上
  return { els, window, document };
}

/* 用 new Function(src)() 执行一份 app.js；src 末尾追加导出语句把内部作用域的东西带出来 */
const EXPORT_LINE =
  '\n;globalThis.__EXPORT = { VIEWS, state, PAGES, SUBPAGES, PROFILES, METRICS, DOCS, CANDS, TRIALS, defaultSel, APP_INFO, render };';
const EXPORT_LINE_DEV = EXPORT_LINE.replace(
  'render };',
  'render, bootReady, loadBootstrap, buildData, init };'
);
function runApp(srcPath, exportLine) {
  delete globalThis.__EXPORT;
  new Function(read(srcPath) + exportLine)();
  const T = globalThis.__EXPORT;
  assert.ok(T && T.VIEWS, `${srcPath}: 没拿到 VIEWS 导出`);
  return T;
}

/* ---------------- 白名单：只有这里列出的差异允许被放行 ----------------
   每条都写明理由；命中次数会在测试结尾打印，方便日后核对是否还在需要。 */
const WHITELIST = [
  {
    name: '资产路径前缀',
    reason: '原型是裸相对路径，开发版可能带 public/ 或 CDN 前缀；两边归一到 assets/ 再比。',
    apply: (s) => s.replace(/(src|href)="(?:[^"]*?\/)?assets\//g, '$1="assets/')
  },
  {
    name: '版本号文本',
    reason: '开发版版本号由 GET /api/bootstrap 下发（并写回 #ver-chip / #app-version），原型是写死的 v0.1.0；归一后再比。',
    apply: (s) => s.replace(/v\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.]+)?/g, 'vX.Y.Z')
  },
  {
    name: '开发版独有的写入入口',
    reason: '「记一次服药 / 记一次反应 / 记一条感受」只有开发版能落库；原型是 G2 已签认的冻结快照，不在快照上加按钮。剥掉这层按钮再比，其余结构必须逐字符相同。',
    apply: (s) => s.replace(/\n[ \t]*<div class="actions"><button class="primary" data-action="add-(?:adherence|side-effect|viewpoint)">[^<]*<\/button><\/div>/g, '')
  },
  {
    name: '指标补录按钮改名',
    reason: '原型里「＋ 手工补录一个值」挂在 add-meal 上（当时只有 toast）；开发版拆成独立的 add-metric 才会打开补录弹层。仅 action 名不同，按钮文案与位置一致。',
    apply: (s) => s.replace(/data-action="add-metric"/g, 'data-action="add-meal"')
  }
];
const whitelistHits = new Map();
function normalize(html) {
  let out = html;
  for (const w of WHITELIST) {
    const next = w.apply(out);
    if (next !== out) whitelistHits.set(w.name, (whitelistHits.get(w.name) || 0) + 1);
    out = next;
  }
  return out;
}
function firstDiff(a, b) {
  if (a === b) return null;
  let i = 0;
  const n = Math.min(a.length, b.length);
  while (i < n && a[i] === b[i]) i++;
  return { at: i, proto: a.slice(Math.max(0, i - 80), i + 160), pub: b.slice(Math.max(0, i - 80), i + 160) };
}

/* 两边在完全相同的 state 下渲染：把 state 复位成原型初始值，再设 profile / view / sub */
const BASE_STATE = () => ({
  view: 'dashboard', profile: 'A', agentPhase: 'idle', agentSize: 'std', agentRatio: 0.35, sel: ['hgb', 'wt', 'fatigue'], // GIST 默认：血红蛋白 + 体重两条数值线 + 乏力分级
  range: 'all', zoom: 100, toggles: { treatment: true, keypoints: true }, pin: null, saved: [], sub: {},
  query: '', parsing: false, parseError: false, loaded: {}, parsingName: '', lastUpload: null, uploads: 0
});
function setState(T, { profile, view, sub }) {
  Object.assign(T.state, BASE_STATE());
  T.state.profile = profile;
  T.state.view = view;
  if (sub != null) T.state.sub[view] = sub;
}

/* ---------------- 加载两边 ---------------- */
const okFetch = async (url) => {
  assert.equal(url, '/api/bootstrap');
  return { ok: true, status: 200, json: async () => BOOTSTRAP_OK };
};

installShim({ demoData: DEMO });
const PROTO = runApp(path.join(PROTO_DIR, 'app.js'), EXPORT_LINE);

installShim({ fetchImpl: okFetch });            // 开发版：bootstrap 成功路径，不挂 window.DEMO_DATA
const PUB = runApp(path.join(PUBLIC_DIR, 'app.js'), EXPORT_LINE_DEV);
await PUB.bootReady;                            // 等 bootstrap → buildData → init 完成

const VIEW_IDS = Object.keys(PROTO.VIEWS);
/* 三套演示档案都要参与穷举：C 是「术前靶向 · 未手术」这一型，没有 surgery 分节、
   危险度是「待定（未切除）」——最容易在两边渲染时分叉的就是它。 */
const PROFILES = ['A', 'B', 'C'];
/* GIST：11 个一级视图（含「资料库」records）；「病理与危险度」与「靶向用药」是两页新增，
   加上「治疗历程」「检查与指标」「生活与营养」都要参与分流断言。
   这里列的是 SUBPAGES 里有二级页签的全部视图（10 个；timeline 也有页签，一并列上）。 */
const SUB_VIEWS = ['records', 'pathology', 'treatment', 'meds', 'nutrition', 'labs', 'timeline', 'mind', 'review', 'trials'];

test('① 视图 HTML 逐字符一致：11 视图 × 3 档案 × 每个二级页签', async (t) => {
  assert.equal(VIEW_IDS.length, 11, `VIEWS 应有 11 个一级视图（SPEC §4 的 10 个 + 资料库，Q8），实际 ${VIEW_IDS.length}`);
  assert.deepEqual(VIEW_IDS, Object.keys(PUB.VIEWS), '两边 VIEWS 的键集合必须一致');
  let cases = 0;
  for (const profile of PROFILES) {
    for (const view of VIEW_IDS) {
      const subs = PROTO.SUBPAGES[view] ? PROTO.SUBPAGES[view].map((_, i) => i) : [0];
      for (const sub of subs) {
        setState(PROTO, { profile, view, sub });
        setState(PUB, { profile, view, sub });
        const label = `${profile}/${view}/tab${sub}`;
        let a, b;
        try {
          a = PROTO.VIEWS[view]();
          b = PUB.VIEWS[view]();
        } catch (e) {
          assert.fail(`${label}: 渲染抛错 ${e.message}`);
        }
        assert.ok(a && a.length > 200, `${label}: 原型渲染过短（${a && a.length}）`);
        cases += 1;
        if (a === b) continue;                       // 完全相同，直接过
        const na = normalize(a), nb = normalize(b);  // 命中白名单的差异放行
        if (na === nb) continue;
        const d = firstDiff(na, nb);
        assert.strictEqual(nb, na, `${label}: HTML 不一致 @${d.at}\n原型: …${d.proto}…\n开发: …${d.pub}…`);
      }
    }
  }
  t.diagnostic(`比对 ${cases} 组（${PROFILES.length} 档案 × ${VIEW_IDS.length} 视图 × 各二级页签）`);
  assert.ok(cases >= 10 * 2, '比对组数不足');
});

test('② 二级页签视图的 5 个分流视图各自独立（顺带确认页签真的分流了）', () => {
  for (const view of SUB_VIEWS) {
    for (const profile of PROFILES) {
      const seen = new Set();
      PROTO.SUBPAGES[view].forEach((_, sub) => {
        setState(PROTO, { profile, view, sub });
        setState(PUB, { profile, view, sub });
        const a = PROTO.VIEWS[view](), b = PUB.VIEWS[view]();
        assert.strictEqual(normalize(b), normalize(a), `${profile}/${view}/tab${sub} 分流内容不一致`);
        seen.add(a);
      });
      assert.ok(seen.size > 1, `${profile}/${view}: 各页签内容应当互不相同`);
    }
  }
});

test('③ public/index.html 含 app.js 用到的全部 DOM id', () => {
  const html = read(path.join(PUBLIC_DIR, 'index.html'));
  const appSrc = read(path.join(PUBLIC_DIR, 'app.js'));
  const ids = new Set([
    // 交付清单点名要求保留的 id
    'nav', 'main', 'breadcrumb', 'profile-name', 'profile-meta', 'profile-avatar', 'work-grid',
    'agent-dock', 'agent-dot', 'agent-body', 'agent-toggle',
    // 顶栏三段式（参照 prompts/DSH-WORKBENCH-TOP-BAR.md）：版本 chip 归左区、说明归中区、
    // 主按钮标签 #agent-label 与「×」#agent-hide 归右区；原型那个 #agent-state（按钮内的状态字）
    // 已由中区说明 #top-hint 取代，故不再列入骨架。
    'agent-label', 'agent-hide', 'top-hint',
    'dialog', 'toast', 'font-toggle', 'ver-chip'
  ]);
  for (const m of appSrc.matchAll(/\$\('#([A-Za-z0-9_-]+)'/g)) ids.add(m[1]);      // $('#id')
  for (const m of appSrc.matchAll(/getElementById\('([A-Za-z0-9_-]+)'/g)) ids.add(m[1]);
  // app.js 自己吐在 HTML 里的 id（#docs-table / #file-picker / #dsh-conversation-slot …）属于运行时节点，
  // 不该出现在骨架里；骨架只负责 §交付清单 点名 + app.js 直接查询的静态节点。
  const runtimeIds = new Set([...appSrc.matchAll(/id="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));
  const skeletonIds = [...ids].filter((id) => !runtimeIds.has(id));
  const missing = skeletonIds.filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, [], `index.html 缺少这些 id: ${missing.join(', ')}`);
  assert.ok(skeletonIds.length >= 16, `静态 id 太少（${skeletonIds.length}），提取逻辑可能失效`);
  assert.ok(html.includes('name="robots"') && html.includes('noindex'), 'index.html 需要 meta robots noindex');
  assert.ok(/<script src="app\.js" defer><\/script>/.test(html), 'app.js 需以普通脚本 + defer 引入');
  assert.ok(!/<script[^>]*demo-data\.js/.test(html), '开发版不应再引 demo-data.js');
  assert.ok(html.includes('data-size="narrow"') && html.includes('data-size="std"') && html.includes('data-size="wide"'), 'AI 面板窄/标准/宽三档按钮需在骨架里');
});

test('④ public/style.css：字号变量 12.5px / 大字 15px / [hidden] 规则 / 原型提示条停用', () => {
  const css = read(path.join(PUBLIC_DIR, 'style.css'));
  const protoCss = read(path.join(PROTO_DIR, 'style.css'));
  assert.match(css, /--font:\s*12\.5px/, '基础字号变量应为 12.5px');
  assert.match(css, /body\.large\{--font:\s*15px/, '大字模式应为 15px');
  assert.match(css, /\[hidden\]\{display:none\s*!important\}/, '必须有 [hidden] 强制隐藏规则');
  assert.match(css, /\.prototype-bar[^{]*\{display:none\s*!important\}/, '原型提示条需停用');
  // 除上面几处外，其余规则应与原型逐行一致（先剥注释，再忽略被允许改动的行）
  const lines = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map((l) => l.trim()).filter((l) => l && !/--font:\s*\d|body\.large|prototype-bar/.test(l));
  assert.deepEqual(lines(css), lines(protoCss), 'style.css 除字号变量与原型提示条外，规则应与原型一致');
});

test('⑤ bootstrap 成功路径：用接口数据渲染（不依赖 window.DEMO_DATA）', () => {
  const mainHtml = globalThis.document.querySelector('#main').innerHTML;
  assert.ok(mainHtml.length > 500, '首屏应渲染出内容');
  assert.ok(mainHtml.includes('记一次今天的服药与副作用'), '看板应含服药与副作用入口卡');
  assert.equal(PUB.APP_INFO.version, '0.1.0');
  assert.ok(!mainHtml.includes('没能载入工作台数据'), '成功路径不应出现错误态');
});

test('⑥ bootstrap 失败 + window.DEMO_DATA 存在：走回退路径仍能渲染', async () => {
  const shim = installShim({
    demoData: DEMO,
    fetchImpl: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1'); }
  });
  const T = runApp(path.join(PUBLIC_DIR, 'app.js'), EXPORT_LINE_DEV);
  await T.bootReady;
  const html = shim.els.get('#main').innerHTML;
  assert.ok(!html.includes('没能载入工作台数据'), '有 DEMO_DATA 回退时不该进入错误态');
  assert.ok(html.includes('记一次今天的服药与副作用'), `回退路径应正常渲染看板，实际：${html.slice(0, 120)}`);
  // 回退数据与原型数据渲染结果一致
  setState(T, { profile: 'B', view: 'pathology', sub: 0 });
  setState(PROTO, { profile: 'B', view: 'pathology', sub: 0 });
  assert.strictEqual(normalize(T.VIEWS.pathology()), normalize(PROTO.VIEWS.pathology()), '回退路径下视图内容应与原型一致');
});

test('⑦ bootstrap 失败且无 DEMO_DATA：#main 给出明确错误说明，不白屏', async () => {
  const shim = installShim({ fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  const realErr = console.error; console.error = () => {};   // 这条路径必然打 error，测试输出里静音
  const T = runApp(path.join(PUBLIC_DIR, 'app.js'), EXPORT_LINE_DEV);
  await T.bootReady;
  console.error = realErr;
  const html = shim.els.get('#main').innerHTML;
  assert.ok(html.includes('没能载入工作台数据'), `应渲染错误说明，实际：${html.slice(0, 160)}`);
  assert.ok(html.includes('/api/bootstrap'), '错误说明里要点明接口');
  assert.ok(html.length > 200, '错误态也不能是空的');
});

test('⑧ 原型四个既有校验脚本依赖的导出仍可用（shim 不抛错、动画安全退出）', () => {
  // shim 里 requestAnimationFrame / performance 缺失，animateCountups 必须静默退出
  assert.equal(typeof globalThis.requestAnimationFrame, 'undefined');
  installShim({ demoData: DEMO });
  const T = runApp(path.join(PROTO_DIR, 'app.js'), EXPORT_LINE);
  setState(T, { profile: 'A', view: 'dashboard', sub: null });
  assert.ok(T.render() === undefined);
  assert.ok(T.VIEWS.dashboard().includes('data-countup'), '数字滚动属性仍在');
});

/* 顶栏三段式 + AI 按钮五态：逐条对照 prompts/DSH-WORKBENCH-TOP-BAR.md 的硬约束。
   目的：把「顶栏结构」从肉眼检查变成断言——左区不许出现按钮、中区必须 flex:1、
   按钮组必须 margin-left:auto、五态文案一个都不能自造。 */
test('⑨ 顶栏三段式、AI 按钮五态与面板宽度（对照 DSH-WORKBENCH-TOP-BAR / 20-AGENT-PANE-DESIGN）', () => {
  const html = read(path.join(PUBLIC_DIR, 'index.html'));
  const css = read(path.join(PUBLIC_DIR, 'shell.css'));
  const app = read(path.join(PUBLIC_DIR, 'app.js'));

  // 1) 三段顺序：品牌区 → 说明 → 操作组
  const iBrand = html.indexOf('tb-brand'), iHint = html.indexOf('tb-hint'), iAct = html.indexOf('tb-actions');
  assert.ok(iBrand > 0 && iHint > iBrand && iAct > iHint, '顶栏三段顺序必须是 品牌 → 说明 → 操作组');

  // 2) 左区只放定位信息：版本 chip 在左区、且左区里没有按钮（版本 chip 本身除外）
  const leftBlock = html.slice(iBrand, iHint);
  assert.ok(leftBlock.includes('id="ver-chip"'), '版本 chip 必须在左区（品牌右侧）');
  assert.ok(!/<button(?![^>]*ver-chip)/.test(leftBlock), '左区不许放操作按钮（会被 macOS 窗口按钮挤到）');

  // 3) 中区：一句说明，flex:1 + min-width；右区：按钮组 margin-left:auto 贴右缘
  assert.match(css, /\.tb-hint\{[^}]*flex:1/, '中区说明必须 flex:1（吃掉中间空白）');
  assert.match(css, /\.tb-hint\{[^}]*min-width:200px/, '中区说明要有 min-width，防被压成竖排');
  assert.match(css, /\.tb-actions\{[^}]*margin-left:auto/, '按钮组必须 margin-left:auto 贴右缘');
  assert.match(css, /\.tb-actions\{[^}]*flex:0 0 auto/, '按钮组不许被说明文字挤碎（flex:0 0 auto）');

  // 4) 主按钮是这一条唯一的强色块：用品牌主色，且禁用态不能还是主色
  assert.match(css, /\.tb-agent\{[^}]*background:var\(--violet\)/, '主按钮用品牌主色（--violet #1B4F8A）');
  assert.match(css, /\.tb-agent:disabled\{[^}]*background:#eef2f7/, '禁用态要退回中性灰，不能仍是强色块');
  assert.ok(!/\.topbar\{[^}]*background:var\(--violet\)/.test(css), '顶栏底不许铺品牌主色（色带不能抢）');

  // 5) 五态文案与按钮表逐字一致，一个都不能自造
  for (const label of ['AI 对话', '正在连接…', '收起 AI 对话', '打开 AI 对话', 'AI 对话暂不可用']) {
    assert.ok(app.includes(`'${label}'`) || app.includes(`"${label}"`), `缺少按钮文案：${label}`);
  }
  for (const ph of ['idle', 'connecting', 'open', 'closed', 'unavailable']) {
    assert.ok(app.includes(`${ph}:`), `状态机缺少状态：${ph}`);
  }

  // 6) 「×」有 aria-label；连接中与不可用两态要禁用按钮（防重复创建 / 说明降级）
  assert.match(html, /id="agent-hide"[^>]*aria-label="[^"]+"/, '「×」必须带 aria-label');
  assert.match(app, /btn\.disabled\s*=\s*\(ph === 'connecting' \|\| ph === 'unavailable'\)/,
    '连接中与不可用两态必须禁用主按钮');

  // 7) 收起 ≠ 结束会话：状态机里 open → closed 只切显隐
  assert.match(app, /if \(ph === 'open'\) \{ state\.agentPhase = 'closed'; renderAgent\(\); return; \}/,
    '展开态点主按钮应转为 closed（只收起，不结束会话）');

  // 8) 面板宽度可调：分隔条存在、有 role=separator 与数值区间，宽度来自 lib/layout.js 单一来源
  assert.match(html, /id="agent-splitter"[^>]*role="separator"[^>]*aria-valuemin="25"[^>]*aria-valuemax="45"/,
    '分隔条必须 role=separator 且 aria-valuemin/max 为 25/45');
  assert.match(html, /id="agent-splitter"[^>]*tabindex="0"/, '分隔条要能被键盘聚焦');
  assert.match(css, /\.work-grid\.agent-open\{grid-template-columns:minmax\(0,1fr\) 10px var\(--agent-w/,
    '展开态必须是三列：业务区 | 分隔条 | 面板（宽度用 --agent-w）');
  assert.match(app, /let AGENT_PANE = \{ min: 0\.25, max: 0\.45, def: 0\.35/, '客户端兜底区间要与 lib/layout.js 一致');
  assert.match(app, /state\.agentRatio/, '宽度要按比例存在 state 里，不能写死像素');
  assert.match(app, /localStorage\.setItem\(AGENT_STORE_KEY/, '宽度要记忆（下次打开同一档）');
  assert.match(app, /addEventListener\('pointerdown'/, '分隔条要能鼠标拖动');
  assert.match(app, /e\.key === 'ArrowLeft'[\s\S]{0,240}e\.key === 'ArrowRight'/, '分隔条要支持 ←/→ 键盘调宽');
  // 布局参数唯一来源：lib/layout.js 里的区间下限/上限与客户端兜底一致
  const layoutSrc = read(path.join(ROOT, 'lib', 'layout.js'));
  assert.match(layoutSrc, /export const AGENT_PANE/, 'lib/layout.js 必须导出 AGENT_PANE（唯一来源）');
  assert.match(layoutSrc, /min: 0\.25,\s*\n\s*max: 0\.45,/, 'lib/layout.js 的区间应为 0.25–0.45');
});

test('⑩ 客户端注册参数与 lib/layout.js 同源、UI 前缀与 dsh/index.js 一致', () => {
  const client = read(path.join(ROOT, 'lib', 'client.js'));
  const layoutSrc = read(path.join(ROOT, 'lib', 'layout.js'));
  const indexSrc = read(path.join(ROOT, 'dsh', 'index.js'));
  const appSrc = read(path.join(PUBLIC_DIR, 'app.js'));

  // 1) 宿主注册的三个参数，客户端字面量必须等于 lib/layout.js 的 PANEL
  const panel = layoutSrc.slice(layoutSrc.indexOf('export const PANEL'), layoutSrc.indexOf('export const HOST_LIMITS'));
  const side = panel.match(/businessSide:\s*'([a-z]+)'/)?.[1];
  const width = panel.match(/businessWidth:\s*([\d.]+)/)?.[1];
  const custom = panel.match(/customFrame:\s*(true|false)/)?.[1];
  assert.ok(side && width && custom, 'lib/layout.js 的 PANEL 必须写全三项');
  assert.match(client, new RegExp(`businessSide:\\s*'${side}'`), `客户端 businessSide 必须等于 ${side}`);
  assert.match(client, new RegExp(`businessWidth:\\s*${width.replace('.', '\\.')}`), `客户端 businessWidth 必须等于 ${width}`);
  assert.match(client, new RegExp(`customFrame:\\s*${custom}`), `客户端 customFrame 必须等于 ${custom}`);

  // 2) 接口前缀只在 dsh/index.js 写一次，前端按同一份约定推基址
  const apiPrefix = indexSrc.match(/export const API_PREFIX = '([^']+)'/)?.[1];
  assert.ok(apiPrefix, 'dsh/index.js 必须导出 API_PREFIX');
  assert.match(indexSrc, /const UI_PREFIX = `\$\{API_PREFIX\}\/ui`/, 'UI 前缀必须由 API 前缀拼出来');
  assert.ok(appSrc.includes(`'${apiPrefix}/ui'`), `public/app.js 的 apiBase() 必须认 ${apiPrefix}/ui`);
  assert.ok(client.includes(`${apiPrefix}/ui/index.html`), '客户端 iframe 必须指向本包自己的 UI 前缀');
});

test.after(() => {
  const hits = [...whitelistHits.entries()];
  const line = hits.length
    ? hits.map(([n, c]) => `${n}×${c}（${WHITELIST.find((w) => w.name === n).reason}）`).join('；')
    : '无（两边输出完全相同，没有任何差异需要放行）';
  console.log(`\n[parity] 白名单命中：${line}`);
});
