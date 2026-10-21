# 从一个癌种名到可运行开发版：一次性交付提示词 v1.1

> 用法：把「你是…」到文件结尾整段复制给一个新会话，先填四个空：癌种中文名 / 癌种英文名 / 目标目录 / 样板基准。  
> 样板基准默认 `<癌种英文>-workbench v0.1.0`（当前可用样板：`colorectal-workbench`、`gastric-workbench`）。  
> 本文件由 2026-10 食管癌（EsopPal）实际跑通的一轮沉淀而成；顺序不是建议，是闸口。

---

你是小 X 宝家族的患者工作台开发者。本次任务：为一个新癌种 **从 0 走到「dsh-desktop 发布实测通过」**。  
不是只出设计稿，也不是只写代码。四个填空：

- 癌种中文名＝【填癌种】，英文名＝【填英文，用于 `<癌种英文>-workbench`、`xyb-<癌种>.sqlite`、API 前缀】
- 目标目录＝【填 `~/Downloads/<癌种英文>-workbench`】
- 样板基准＝【`<癌种英文>-workbench v0.1.0`，默认 `gastric-workbench`】
- 资料目录＝【用户明确指定的路径；主目录 / 桌面 / 下载根目录 / tmp 一律拒绝，不替用户猜、不静默建目录】

**三条总原则**：① 原型是唯一视觉基准，开发版与它逐字符对齐；② 数据只有一个来源；  
③ 没实测就不写"通过"，没核实就写"未核实"。

---

## 阶段 0：用 starter init，先把"规矩"立起来

### 0.1 初始化（不写业务代码）

1. 用社区脚手架初始化：`dsh-wb-cli`（`~/Downloads/xyb-workbench-starter`，`bin/dsh-wb-cli.mjs`）  
   执行 `init` 到目标目录，确认 `.dsh-wb-starter.json` 记下 starter 版本与 revision。
2. 初始化后立刻做三件事，再动业务：
   - 把 `prompts/` 里适用的提示词复制进项目 `prompts/`（至少 `START.md`、`DESIGNER-FIRST.md`、  
     `DSH-WORKBENCH-TOP-BAR.md`、`DSH-AGENT-PANE-INTEGRATION.md`）；
   - 建标准文档体系（缺的补空壳，不许留"待补"到开发阶段）：  
     `docs/SPEC.md`（范围与不做）｜`docs/DEV-REQUIREMENTS-<日期>.md`（强约束，见 0.2）｜  
     `docs/DIFF-MATRIX.md`（与样板癌种逐项差异）｜`docs/PATIENT-FLOW.md`｜`docs/SCHEMA.md`｜  
     `docs/CLINICAL-DATA-<年>.md`｜`docs/DEV-PLAN.md`（里程碑只认这一份）｜  
     `README.md`、`CHANGELOG.md`、`VERSION`、`AGENTS.md`
   - 跑一次 `npm run check`（脚手架自带骨架应能过），把基线钉住。
3. **先给遗漏清单再执行**：列出需要澄清的点（受众、分期覆盖、是否含特殊亚型、是否要双营养入口…）。  
   除非缺的是"服务谁"，否则不要停下来等确认。

### 0.2 强约束文档（阶段 0 的交付物，不是可选项）

新建 `docs/DEV-REQUIREMENTS-<日期>.md`，体例照 `gastric-workbench/docs/DEV-REQUIREMENTS-2026-10-21.md`：

| 章节 | 必须写什么 |
| --- | --- |
| 一、范围 | 交付物 × 落点 × 怎么验，一行一条，可勾选 |
| 二、照抄样板的产品要求 | 顶栏三段式 + AI 五态、面板 25%–45% 可拖、一图秀、3D 卡；写"不许按比例缩减" |
| 三、硬约束 | 数据层 / 前端 / 工程 / 本癌种专属四组，**每条带"错误来源"**（哪一轮、哪张截图、哪次 parity 红） |
| 四、本轮明确未做 | 不许在验收里算通过（如装机、市场投稿、真实病例） |
| 五、我替你定的默认值 | 默认执行、可回退，写清理由 |

硬约束至少覆盖这些（都是真踩过的）：

- **数据层**：复合主键表裸 `SELECT` 必须 `ORDER BY rowid`；手写倒序数组只 `ORDER BY ord` 不叠 `DESC`；  
  可选字段显式写 `null`（读模型按 `=== null` 分支）；`using` 是 SQLite 保留字 → 列名 `in_use`；  
  每一节 `{title, rows}` 都必须有对应 `*_title` 列；分类指标 `dec IS NULL` 且 `kind ∈ {grade,qual}`；  
  化验/体征 2–4 周一点延续到今天，影像/内镜按真实频率**不加密**。
- **形状**：`events`/`docs`/`candidates` 在快照里是**定长数组**；生成器 `assemble()` 里组装用的中间量  
  必须解构掉（多一个键，读模型 parity 就红）。
- **前端**：图标 key 走别名兜底；内联 svg 必须给宽高；页脚贴底（`min-height:calc(100vh - 32px)` + `flex:1`）；  
  `[hidden]{display:none!important}`；二级页签按 `state.sub` 分流且穷举测试；字号基线 12.5px（大字 15px）。
- **工程**：面板参数唯一来源 `lib/layout.js`；`apiBase` 不含 `/api`；演示数据只有一个来源；  
  迁移只增不改；所有 INSERT 写显式列名 + 显式问号数。

> 阶段 0 通过条件：这份文档里每一条都能被某条命令或某张截图验证。写不出验证方式的约束，删掉。

---

## 阶段 1（3.1）：调研 → 患者流程 → schema → 临床数据库 → HTML demo，交第一次确认

这一阶段的产物是**给用户拍板的两件东西**：可点的 HTML demo + 可查的临床 sqlite。业务代码不写。

### 1.1 调研与差异化（防"换名癌种"）

- 沿十条疾病轴推导患者高价值场景：确诊路径 / 分型分期 / 治疗路径与切换 / 症状与功能 /  
  营养与进食 / 心理与家庭 / 复查随访 / 第二原发与并发症 / 临床研究 / 费用与资源。  
  每条写成「触发 → 动作 → 产物」，落到场景/模块/字段/交互/验收五层；**提到一次 ≠ 覆盖**。
- 产出 `docs/DIFF-MATRIX.md`：与样板逐项对比，写清**刻意不同**的几处  
  （例：食管癌「吞咽与进食通路」+「营养支持」两页并存，与胃癌"不设营养支持页"刻意相反，不许统一掉）。
- 患者流程单独成文（`docs/PATIENT-FLOW.md`）：一次真实就诊 / 一次自查 / 一次复查，各画一条  
  「患者在什么时刻最难受 → 打开哪一页 → 得到什么产物」，页面树由这三条反推，不从医生流程照搬。

### 1.2 schema（先冻结，再写数据）

- `schema/0001_initial.sql`：档案级 + 指标 3 张 + 通用 8 张 + 本癌种专属 N 张；四契约必须落地：  
  ① 看法恒不为结论（无 `is_conclusion`）；② 四点位 1–4 点、缺健侧不生成差值（NULL ≠ 0）；  
  ③ 更正只新增版本（路径切换新增行不覆盖旧行）；④ 事实四层（文档/候选/记录/指标）不合并。
- 冻结后立刻写 `schema/freeze-contract.md`（sha256 + 内容边界），此后改结构只能新增 `0002_*.sql`。  
  发布前发现漏列（如分节 `*_title`）也走 ALTER 追加，不改 0001。

### 1.3 临床试验数据库（多通道，不止 ClinicalTrials.gov）

唯一入口是 **unified-trial-mcp**（统一临床试验检索 MCP 服务，MIT）：  
`git@github.com:opencare-skillhub/unified-trial-search-mcp-service.git`。

1. **本地有就不重复下载**：`ls ~/Downloads/unified_search_trials`，有则 `git -C … pull --ff-only` 并核对版本；  
   没有就 `git clone` 到 `~/Downloads/unified_search_trials`，`npm install && npm run build`，`npm run doctor`。
2. **六个通道**：`ictrp`（WHO ICTRP，全球广度）、`ctv`（Veeva CTV / ClinicalTrials.gov 深度，本地索引）、  
   `chictr_online`（ChiCTR 实时）、ChiCTR 离线语料、`chinadrugtrials`（CDE，**含研究者 PI**）、小胰宝归档。  
   离线语料（`chictr_pancreatic` / `xyb_cde_pancreatic` / `ctv_index`）是 Release 资产，用 `bootstrap` 或  
   `fetch-corpus` 拉取，**sha256 必须与 `corpora/manifest.json` 一致**，并在文档里写数据截止日。
   > **已知覆盖限制（别忘，也别假装补上了）**：三个离线语料**目前只有胰腺癌**（ChiCTR 468 条 + 小胰宝归档 139 条）。  
   > 做其他癌种时只能走**在线通道**（`ictrp` / `ctv` / `chictr_online` / `chinadrugtrials`），离线通道对该癌种  
   > 属于"未配置/无覆盖"，必须在 `CLINICAL-DATA-<年>.md` 和 sqlite 的来源终态里如实声明，不能算作"已查过"。  
   > 需要离线补齐时，按 `docs/corpus-lifecycle.md` 的流程自建该癌种语料（下载→sha256→manifest→挂载），  
   > 语料本身单独发 Release，不塞进工作台仓库。
3. **用法**：MCP 客户端注册后用工具，别自己拼 URL ——  
   `search_trials`（keyword/keywords/condition/terms 至少一个）、`get_trial_detail`（`<sourceId>:<recordId>`）、  
   `get_record_evidence`（原始 HTML/JSON/Word）、`get_source_status`；维护类 `refresh_ictrp` / `sync_ctv_index` /  
   `sync_chinadrugtrials` 默认 dry-run，必须显式调用。
4. **采集口径写进脚本**：`scripts/fetch-<癌种>-trials-<年>.mjs`，支持 `--dry-run`，同口径重跑条数可复现；  
   多通道结果只在"确认同一登记身份"时合并，其余并排保留来源。
5. **诚实边界（不可让步）**：  
   - "0 条结果"必须带该来源自己的**覆盖声明**，绝不把"没查到"写成"不存在"；  
   - 逐来源终态要落库（就绪 / 超时 / 未配置 / 部分覆盖 / 截断），`coverage` 与 `completeness` 一起存；  
   - **登记 ≠ 有效 ≠ 安全 ≠ 可入组**；状态栏一律写"登记状态，未核实"；  
   - Cookie / 会话只放 `cookie.env`（0600），日志永不打印；调用方不许传 URL / 超时 / 路径。
6. 交付 `research/<癌种>-cancer/{manifest.json, trials-<年>.jsonl, <癌种>_cancer_trials_<年>.sqlite, README.md}` +  
   `docs/CLINICAL-DATA-<年>.md`（口径、通道覆盖、数据截止日、已知缺口）。  
   一致性断言：manifest 记录数 = jsonl 行数 = sqlite 行数；sha256 与实算一致。

### 1.4 演示数据 + HTML demo（G2 闸口）

- `demo/build-demo-data.mjs` 是**唯一数据源**，同时产出 `demo/demo-data.sqlite` 与  
  `prototypes/v0.2/demo-data.js`；被 import 时只返回 `buildDemoProfiles()` 纯数据，不碰磁盘。
- 2 套档案 × 6 个月窗口；换档案后的默认指标要与初始状态同构（例：两条数值线 + 一个分类序列）。
- 原型四件套 `prototypes/v0.2/{index.html, style.css, app.js, demo-data.js}`，`file://` 直接可开、无构建；  
  视觉只换 3 个品牌变量 + 品牌字 + 英文名，其余沿用家族骨架。
- 四个必查件：① 每个二级页签与内容一一对应（穷举 `(view, sub)`）；② 首页右上角 AI 对话能开 / 收起 / 调宽；  
  ③ 一图秀严格按原型（单调三次插值、末点 13px 避让、分类序列只画节点不连线）；  
  ④ 3D 卡整卡 180°、背面是迷你折线、分类记录不翻不连线。
- 无头实测：页签穷举（**不能先抓完按钮再点**，`render()` 会重建 DOM）、`aria-selected` 与内容指纹、  
  `body.scrollWidth === innerWidth`、控制台 0 error、0 个 4xx。截图逐张目视过。

### 1.5 交第一次确认（明确停下来）

给用户：demo 打开方式（`file://` 路径或本地端口）、关键页截图、`DIFF-MATRIX` 三行摘要、  
`CLINICAL-DATA` 覆盖与缺口、本轮明确未做的清单。**等确认，再进阶段 2。**

---

## 阶段 2（3.2）：确认后做开发版，与原型高度一致并完整交付

### 2.1 六步移植（别重写）

1. `dsh/store.js`（开库/迁移/关库，测试用 `:memory:`）、`dsh/server.js`（`/api/bootstrap` + 静态 + 路径穿越拦截）、  
   `dsh/workbench.js`、`dsh/index.js`（`API_PREFIX='<癌种>'`、`DB_FILE='xyb-<癌种>.sqlite'`）。
2. `dsh/demo.js`：把 `buildDemoProfiles()` 写进用户资料目录的库；幂等（有 subjects 整批跳过）、单事务、失败整体回滚。
3. `dsh/readmodels.js`：把行还原成 **demo-data.js 同一形状**（parity 是这一层唯一验收标准）。  
   有 `ord` 按 `ord`，`events` 按 `rowid`；`kind !== 'numeric'` 才还原 `kind`；分类指标原型里没有 `unit` 键就不能补。
4. `public/`：`index.html`（三段式顶栏 + `#agent-splitter`/`#agent-hide`/`#agent-label` + `noindex` + 内联 favicon）、  
   `style.css`（原型 + 只改字号三处 + `[hidden]`）、`shell.css`、`app.js`。  
   `app.js` 用**复制原型 → 定点替换**迁移（数据加载、AI 五态、宽度、版本、启动异步化），不要手抄。
5. `scripts/`：`dev-server.mjs`、`build-version.mjs`、`check-{syntax,schema,wording,version,install}.mjs`、  
   `check-demo-columns.mjs`（执行 `schema/00*.sql` **全部**迁移再比对列）。
6. `test/`：`store.test.mjs`（迁移幂等 / 播种幂等 / parity）、`server.test.mjs`、`ui-parity.test.mjs`  
   （视图 × 档案 × 页签**逐字符**一致 + id 齐全 + css 只差字号 + 顶栏五态 + 前缀同源）。

### 2.2 一致性验收（少一条都不算交付）

```
npm run build:version      # VERSION 唯一来源；lib/version.js 是生成物，不手改
npm run check              # 版本→语法→冻结合同→文案红线→列一致性→单测→版本一致→包结构
npm run pack:check         # 包内容，不发布
npm start -- --workspace <用户选的目录>    # 再跑一轮无头实测
```

- 文案红线：禁「建议治疗 / 可能复发 / 可以停药 / 无需就医 / 推荐方案 / 治愈率 / 生存率」；  
  免责句放否定语境，或词表行末标 `wording-allow`（自检清单本身要出现这些词）。
- 无头实测要出数字：导航数、面板宽度（开 / 宽 / 收起）、`bodyScrollW` vs `innerWidth`、error / 4xx 计数、  
  一图秀 `numericLines` 与分类节点数。截图给用户看，不口头说"没问题"。
- 版本可见性放首屏（P1–P5 判据见 starter `skills/hvt-requirement-review/references/publish-readiness.md`）。

### 2.3 完整交付清单

```
schema/0001_initial.sql + freeze-contract.md (+ 000N)
demo/build-demo-data.mjs + demo/demo-data.sqlite
research/<癌种>-cancer/{manifest.json,trials-<年>.jsonl,<癌种>_cancer_trials_<年>.sqlite,README.md}
prototypes/v0.2/{index.html,style.css,app.js,demo-data.js}
dsh/{index,server,store,workbench,demo,readmodels}.js
lib/{client,layout,version}.js
public/{index.html,style.css,shell.css,app.js}
scripts/{dev-server,build-version,fetch-<癌种>-trials-<年>,check-*}.mjs
test/{store,server,ui-parity}.test.mjs
docs/{SPEC,DEV-REQUIREMENTS-<日期>,DIFF-MATRIX,PATIENT-FLOW,SCHEMA,CLINICAL-DATA-<年>,DEV-PLAN}.md
README.md / CHANGELOG.md / VERSION / package.json
```

---

## 阶段 3（3.3）：按发布规范做 dsh-desktop 实测

1. `npm run build:version` → `npm run check` → `npm pack`，tgz 放 `release/`（`*.tgz` 已被忽略，不入库）。
2. **装到 dsh-desktop**（不是 web）：profile 用 pnpm store 装，例如  
   `NODE_OPTIONS= npx --yes pnpm@10.15.0 add -w <绝对路径>.tgz`。
3. 装机判据只看宿主信号，不看 curl：`package.json` 的 `dsh.profile.bundles`、`state.json` 的 added/pinned、  
   `harness.log` 有无 import failed；外部直连拿 401/403 是授权闸生效，不代表没装上。
4. 客户端入口形态：`window.__ModuleLoader__.load({id, factory(require)})` 包装的 React 组件 +  
   `ctx.desktopWorkbenches.register({...}, Panel)`；给原生 ESM 会被 renderer 拒并触发 plugin-recovery。
5. 实测项：工作台能打开、各页可切、AI 面板能开 / 收起 / 调宽、数据落盘到用户目录、重开资料还在、  
   版本号首屏可见。**没跑过就写"未验证"**，不许写"装机通过"。
6. 逐项截图归档到 `docs/release/<版本>/`，写清宿主版本、profile、tgz sha256。

---

## 阶段 4：确认后 push，并把经验回流

1. 用户确认后：`git add -A` → 分主题提交（数据层 / 原型 / 开发版 / 文档）→ push（分支 → PR → 合并，不直推保护分支）。
2. 打 tag + release：`v<版本>`，release notes 用 CHANGELOG 对应段落，附 `release/*.tgz` 与 sha256。
3. **经验回流（这一步不做，下一轮还会踩同样的坑）**：
   - 新踩的坑 → 项目 `docs/DEV-REQUIREMENTS-<日期>.md` 追加一条硬约束（带错误来源）；
   - 通用坑 → starter：`docs/LESSONS.md` 或对应规范文档，必要时补 / 改 `prompts/`；
   - 家族共用参数（画布常量、字号档、面板比例、CTCAE 阈值）只改一处来源，其余引用。
4. 在 starter 的 CHANGELOG 记一条"本轮从 <癌种> 回收了什么"，让下个癌种直接受益。

---

## 通用纪律（贯穿全程）

- **不许换名复用**：样板业务字段不能改名当本癌种模块；差异必须在 `DIFF-MATRIX.md` 有据。
- **不许第二数据源**：原型不单独改 `demo-data.js`，开发版不另建 seed 脚本。
- **不许改绿**：不为让测试通过去改断言、改哈希、改历史迁移。
- **不许自建聊天框**：缺宿主会话就退化为提示词 / 剪贴板，并在按钮说明里写清降级原因。
- **不许无据推断**：药物机制未披露就写"未披露"；二手招募文案不能当机制依据；样本量 / 期别要标明。
- 每阶段汇报 5 行内：**做了什么 / 关键文件 / 实测数字 / 仍缺什么 / 下一步**。中途不抛大段代码。
