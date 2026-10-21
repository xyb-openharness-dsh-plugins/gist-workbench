# 变更记录

## 2026-10-21 · 副作用入口接进前端

- **靶向用药 · 副作用记录**页新增「记一次反应」按钮（仅开发版），弹层字段：日期 / 表现 / 分级 / 当时处理 / 备注。
  分级**照医生或随访记录原文抄**，不做下拉预判、不替用户判严重程度；弹层里常驻急诊提示
  （呕血、黑便、突发剧烈腹痛、持续高热直接走急诊）。
- 保存走 `POST /api/side-effects`，成功后重拉 bootstrap 重渲染；空「表现」返回 400 并在 toast 里显示
  「没能保存：缺少必填内容：症状名称」。
- **parity 白名单新增一条**：原型是 G2 已签认的冻结快照，不在快照上补写入按钮；
  比对前剥掉 `add-adherence / add-side-effect / add-viewpoint` 这三个 `.actions` 块，其余结构仍逐字符比。
- 端到端实测：`2026-10-21 眼睑水肿 1 级 继续原剂量` 保存后出现在表格末行，接口读回同一条；零意外控制台错误。

## 2026-10-21 · 写接口接进前端（服药 / 感受两个入口）

- **`public/app.js`**：`add-adherence` / `add-viewpoint` 从 toast 换成真实弹层，
  走 `POST /api/{adherence,viewpoints}`；成功后再拉一次 `/api/bootstrap` 重建数据并重渲染，
  不自己拼前端状态（避免页面与库出现两份事实）。
- **失败提示用后端 `message` 原文**：「日期不能晚于今天」「这个档案里没有指标 hgb」这类话直接给用户，
  不吞成「保存失败」。
- **读模型排序修正**：`adherence_rows` / `side_effect_rows` / `imaging_rows` / `viewpoints` 改为 `ORDER BY d, ord`。
  只按 `ord` 排会让今天新记的一条挤进几个月前的记录中间（写接口上线后才暴露）。`ord` 仍只在同一天同一条内分版本。
  演示数据本来就是日期升序，99 组 parity 仍全绿。
- **顺手修文案**：设置页「临床数据库 10 条（演示）」→ 16 条；操作说明里「两个演示档案」→ 三套（补邱惠兰）。
- **端到端实测**：随机端口起 dev-server + 无头 Chrome —— 打开弹层 → 填 400 mg 计划 / 300 mg 实际 → 保存
  → toast「服药记录已记入资料库」→ 表格最后一行出现 `2026-10-21`；重复提交返回 `unchanged`；
  未来日期返回 400 `DATE_FUTURE`；感受同样落库并读到。零控制台错误。

## 2026-10-21 · M2 第二段：写接口（四条命令）

- **新增 `dsh/commands.js`**：`recordAdherence` / `recordSideEffect` / `recordMetricPoint` / `recordViewpoint`，
  对应「今天吃了没 / 有什么反应 / 这次化验多少 / 我怎么想的」。
  只做这四件，病理、危险度、手术、线序、剂量变更属于医生给的事实，必须走「上传 → 候选 → 逐条核对」。
- **三条契约落到写侧**：看法只存原话（返回值无结论字段）；更正追加 `ord+1` 不覆盖旧行；缺字段/未定义指标/未来日期一律报错不猜。
- **幂等**：同自然键同内容返回 `unchanged` 且不写库；改了内容返回 `superseded`，旧行保留。
- **`dsh/server.js`**：新增 `POST /api/{adherence,side-effects,metric-points,viewpoints}`，
  路由表只在 `commands.js` 的 `COMMANDS` 里维护一次；请求体限 64KB，GET 访问写命令回 405 + `allow: POST`。
- **`docs/API-CONTRACT.md` 写实**：读/写两张表、status 三态、输入约束、错误码总表、刻意不做的六件事。
- **`docs/G2-G3-SIGNOFF-2026-10-21.md`**：补闸口留痕——确认人、原话（`1. 确认 2. ok的 3. 需要。`）、
  产物 sha256 指纹、已确认与未确认范围。
- **测试**：新增 `test/commands.test.mjs` 8 项（幂等 / 更正版本 / 写进去读得出来 / 校验 / 命令表），
  `server.test.mjs` 补 2 项（POST 后 bootstrap 可见、405/400/404 拒绝路径）。全量 **31/31** 绿，`npm run check` 全绿。
- 顺手修：`server.test.mjs` 里残留的上一个癌种目录名 `StompalWorkspace` → `GistPalWorkspace`。

## 2026-10-21 · 演示档案补第三套（术前靶向 · 未手术）

- **新增档案 C（邱惠兰 / 女 / 49 岁 / 胃底 GIST 8.2 cm / 未手术 / 术前伊马替尼治疗中）**。
  补的是「信息最缺」的那一型：只有穿刺活检、核分裂象数不了、危险度三套体系全部待定、
  分子检测待出、没有手术记录。切换档案后默认指标与初始状态同构（hgb + wt 两条数值线 + fatigue 分级）。
- **读模型两处修正**（档案 C 暴露出来的）：
  - `trimTail()`：演示数据里表行是变长数组，末尾字段没写＝没有；sqlite 读出 `NULL`，读模型统一裁尾还原。
  - 空分节**整键省略**而非返回 `null`：`surgery_title IS NULL` 时读模型删掉 `surgery` 键，
    否则 parity 把 `null != undefined` 判成不一致，前端还会多出一张空卡片。
- **试验行换真**：`TRIAL_ROWS` 由 10 条虚构 NCT 号换成 `research/gist-cancer/` 的 16 条真实登记摘录
  （含 StrateGIST Frontline Ⅲ期、SDH 缺陷型 Pemigatinib、TIL、ctDNA 等）。
- **测试**：ui-parity 纳入 C，`99 组（3 档案 × 11 视图 × 各页签）` 逐字符一致；
  `node --test test/*.test.mjs` 21/21 绿。
- **无头实测**：档案 C 下 11 个一级视图 × 全部页签，零控制台错误、零横向溢出；
  病理页正确显示「待定（需切除标本的核分裂计数）」「切缘 不适用（尚未手术）」。
- 文档同步：DEV-REQUIREMENTS 表 4 / DEV-PLAN M1 / DIFF-MATRIX / README 的「2 套」改为「3 套」。

## 2026-10-21 · v0.1.0 阶段 1 交付（GIST 换癌种完成）

- **原型**：从食管癌（小咽宝）整体改写为胃肠间质瘤（小吉宝），11 个一级页 / 32 个二级页签。
  新增「病理与危险度」（三套危险度体系并列、不合并不重算）、「靶向用药」（当前用药 / 剂量变更 /
  服药与漏服 / 副作用记录）两个一级页；删除「吞咽与进食通路」；「营养支持」瘦身为「生活与营养」两页签；
  「复诊准备」新增「出血与急症」。
- **品牌**：主色 `#7C83BC` → 暖琥珀 `#B5762A`，外壳中性色同步调暖（`#FBF9F5` / `#2A241C` / `#ECE4D8`）。
- **一图秀**：默认序列改为 血红蛋白（数值）+ 体重（数值）+ 乏力（分类节点不连线），不再含肿瘤标志物。
- **数据层**：`schema/0001_initial.sql` 一次建全 25 表 184 列并冻结（sha256 记入 `schema/freeze-contract.md`）；
  `demo/demo-data.sqlite` 与 `prototypes/v0.2/demo-data.js` 由同一生成器产出。
- **修 parity 三处**：`cycles.done` 的 0/1 被 `!!` 转成布尔；`imaging_rows` 变长行尾部 `NULL` 未裁尾；
  `store.test` 的迁移次数与指标 key 仍是上一个癌种的。
  读模型新增 `trimTail()`，变长行统一裁尾还原（库内仍存 NULL，不补空串）。
- **临床资料包**：`research/gist-cancer/` 16 条 2026 年首次公示的 GIST 干预性试验（ClinicalTrials.gov v2），
  采集脚本 `scripts/fetch-gist-trials-2026.mjs` 随项目版本化。
- **文档**：新增 `docs/SPEC.md` / `DEV-REQUIREMENTS-2026-10-21.md` / `SCHEMA.md` / `CLINICAL-DATA-2026.md` /
  `DIFF-MATRIX.md` / `PATIENT-FLOW.md` / `DEV-PLAN.md`。
- **测试**：`node --test test/*.test.mjs` 21/21 绿；`check-schema` / `check-demo-columns` / `npm run check` 全绿。


## 2026-10-21 · 装机目标更正（V2 前的准备）

- **更正**：装机目录不是 `~/.dsh/profiles/desktop`（CLI 侧，Desktop 不读）。DSH Desktop 0.12.0 实际加载的是 app 自己的 Harness `~/Library/Application Support/dsh-desktop/harness/profiles/web`。
- `scripts/check-install.mjs` 换成自动探测版（Desktop Harness → `DSH_HOME` → `~/.dsh`，打印判定依据，区分市场安装/手工安装）；`docs/DEV-REQUIREMENTS-2026-10-21.md` H15 同步更正。
- `scripts/build-version.mjs --check` 不再比较 `build` / `commit`（易变量），修掉每次提交后必失败的假阴性。


## 2026-10-21 · 提示词升级 v1.1（补 init / 强约束 / 三阶段闸口 / 多通道临床库）

- `prompts/ZERO-TO-DEV.md`：新增阶段 0（starter init + 标准文档体系 + `DEV-REQUIREMENTS` 强约束文档，
  体例对齐 `gastric-workbench/docs/DEV-REQUIREMENTS-2026-10-21.md`）。
- 三阶段闸口写实：3.1 调研/患者流程/schema/临床库/HTML demo → 第一次确认；3.2 开发版与原型逐字符一致；
  3.3 按发布规范做 dsh-desktop 实测；之后才是 push、tag、经验回流（项目约束文档 + starter LESSONS/prompts）。
- 临床试验改为多通道口径：unified-trial-mcp（`opencare-skillhub/unified-trial-search-mcp-service`，
  ICTRP / CTV / ChiCTR / CDE 含 PI / 离线语料），强调「0 条结果必须带覆盖声明」「登记≠有效≠可入组」。
- 样板基准统一写成 `<癌种英文>-workbench v0.1.0`。

## 2026-10-21 · 开发版 0.1.0（原型 → 数据层 → 开发版骨架走通）

- 需求与约束固化为 `docs/DEV-REQUIREMENTS-2026-10-21.md`（H1–H25 开发红线 + E-A1–E-A12 食管癌专属 + Q1–Q8）。
- 数据层：`schema/0001_initial.sql` 25 表 / 174 列；新增 `0002_section_titles.sql` 补
  `dilation_title` / `access_events_title` 两列（ALTER 追加，不改历史迁移）。
- 演示数据：2 档案（沈志远 / 顾晓兰）× 6 个月，59 项指标 / 666 个数据点 / 10 条真实登记摘录；
  `docs` / `candidates` / `events` 保持定长数组形状，生成器不再把中间量 `extraMetrics` 漏进产物。
- 开发版：`public/{app.js,index.html,style.css,shell.css}` + `dsh/{index,server,store,workbench,demo,readmodels}.js`；
  数据改走 `GET /api/bootstrap`（失败且有 `window.DEMO_DATA` 时回退），顶栏三段式，AI 面板五态 + 25%–45% 可拖 + 宽度记忆。
- 校验：`npm run check` 全绿；`test/ui-parity.test.mjs` 11 视图 × 2 档案逐字符与原型一致；
  无头实测 1440px 无横向溢出、无控制台错误、无 4xx，一图秀仍为 2 条数值线 + 吞咽分类节点不连线。
- 未做：DSH Desktop 实机装机验证（P2 未验证，不写"装机通过"）；未打 tag。

## 2026-10-20 · 开发快照（包版本 0.1.0）

- 补录D9仓库纳管决定、实际仓库身份及Git同步与市场投稿的边界；当前仍是设计审定阶段。
- 本次仅修改设计会话与说明文档，未运行业务测试；不代表设计或实机验收。
- 详细范围见 [Git同步记录](docs/GIT-SYNC-2026-10-20.md)；本次未创建正式发布tag。
