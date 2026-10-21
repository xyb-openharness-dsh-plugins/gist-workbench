# 变更记录

## 2026-10-21 · MinerU 云端解析接通（导入一份病理 PDF 就能出候选）

- **`dsh/mineru.js`**：API v4 四步（申请批 → PUT 上传 → 轮询 → 下载 zip 取 `full.md`），默认 `vlm` 模型；
  只有「模型参数不被接受」才退回 `pipeline`，文件本身的失败不重试（重试只是多花额度）。
- **`lib/zip.js`**：零依赖 ZIP 读取（中央目录 + deflateRaw），ZIP64 与加密明确报错，不猜结构。
- **`dsh/gistparse.js`**：GIST 专用抽取。病理字段（部位 / 大小 / 核分裂 / 切缘 / 破裂 /
  CD117 / DOG1 / KIT / PDGFRA / SDHB / 危险度）+ 12 项化验 + 报告日期。只抄原文，抽不到就不产候选。
- **`dsh/parse.js`**：状态机 `待解析 → 待核对 / 解析失败`，候选写入与状态翻转同一事务；
  失败回滚、候选 0 条、原件保留。「解析中」**不入库**（进程中途退出会留下永远转圈的僵尸状态）。
- **接口**：`GET /api/mineru`（只报来源与掩码）、`POST /api/parse`；`documents` 导入后的初始状态
  由「待核对」改为「待解析」——导入本身不产候选。
- **界面**：资料库每行按状态给「解析这份材料 / 重试解析」；解析前弹确认（明说原件会上传到 mineru.net）；
  设置页那行 Token 状态改成真实来源 + 掩码，不再写死「已配置」。
- **测试**：`test/mineru.test.mjs` 8/8（协议顺序、PUT 不设 Content-Type、401 只出掩码、ZIP 缺条目报错）、
  `test/parse.test.mjs` 8/8（失败不产候选、格式拒绝不发起请求、重解析不堆积）、
  `test/gistparse.test.mjs` 12/12（含真实 MinerU 输出夹具）；全量 **67/67**；`npm run check` 全绿；parity 99 组不变。
- **真机实测**（1 页 PDF → MinerU → 候选）：12.9–18.8 秒，13 条候选值与单位全部正确，
  界面从「待解析」变「待核对」，页面无报错。

### 这一轮踩到的三个坑

1. **MinerU 返回的表格是 `<table>`，不是 markdown 管道表**。直接剥标签会把整张表压成一行
   （`胃体肿瘤最大径6.8 cm核分裂象计数12 个`），部位把后面几项全吞进去。修法：先转竖线表再走同一条对齐路径。
2. **`colspan="2"` 不补空位会让「项目 | 结果 | 单位」错列**。修法：按 colspan 补空单元格（不是复制内容）。
   regExp 里把 `"?'` 写成 `"'?` 会变成「可选双引号 + 字面单引号」，`colspan="2"` 直接匹配不上——隐蔽到只表现为"少一列"。
3. **环境变量里的旧 `MINERU_TOKEN` 会盖住 `.secrets/mineru.json` 的新 key**（优先级 env > file）。
   表现为 401，但设置页写着"已配置"。所以 `/api/mineru` 必须回 `source`，界面要显示来源而不是只显示"已配置"。

## 2026-10-21 · 原件导入 / Markdown 导出 / 候选核对三条链路落盘

- **新增 `dsh/files.js`**：`saveImport()` 与 `saveExport()`。两条硬边界——只写用户选定的资料目录下的
  `imports/` 与 `exports/`，不写系统临时目录；文件名只留基名（`../../../etc/passwd` → `passwd`），
  控制字符与 `<>:"|?*` 剥掉，限长 120。
- **`POST /api/import`**：请求体是**原始字节**（不套 base64），元信息走查询参数（文件名含 `&` 会破坏 body 边界判定）。
  单份 40 MB 上限，超限 `req.destroy()` + 413。落盘名 `f<sha256前12位>-<name>`，同一内容再导入回 `unchanged`，
  **不重复写文件、不重置解析状态**；原件是复制，用户原来那个文件不动。
- **`POST /api/export`**：落 `exports/<本地日期>-<kind>.md`，同名覆盖——导出物可重生成，不是事实，
  所以不受契约② 约束；`kind` 只留中英文数字与 `-`。
- **`POST /api/candidates`**：`reviewCandidate` 只 `UPDATE candidate_fields` 的 `value` / `status`，
  **不动任何事实表**；三态 `待核对 / accepted / rejected`，`value` 省略时沿用原值。
- **前端接线**：`ingestFiles` 用 `fetch(..., { body: file })` 直传 `File`；`export-save` / `cand-save` 走 `postCommand`。
  「复诊准备」的「就诊准备」页签补了「导出这份复诊清单」按钮（此前 `export-review` 只挂在动作表里，页面上没有入口）。
- **测试**：新增 `test/files.test.mjs` 5 项（落盘内容一致 / sha256 去重 / 路径穿越 / 空与超限 / 导出覆盖）；
  `test/server.test.mjs` 加 2 项（`/api/import` 原始字节、`/api/export`）；全量 **39/39**；`npm run check` 全绿。
- **端到端**（`gist-io-e2e.mjs`，Node 22 + 无头 Chrome）：
  ```
  导入 toast：已导入 1 份材料；原件已复制到资料目录 imports/
  imports/ 内容：['f5c7c15feb6b5-gist-sample-*.txt']  落盘内容一致：true
  重复导入：导入 1 份，其中 1 份此前已存在（内容相同）  imports/ 仍有 1 份
  导出 toast：已写入资料目录 exports/2026-10-21-复诊准备.md
  候选 toast：已接受：候选标为已核对，原件与出处保留   已接受候选数：1
  页面错误：无
  ```

## 2026-10-21 · 指标补录与进食记录接进前端（写命令补齐五条）

- **新增 `POST /api/nutrition`**（`recordNutrition`）：日期 + 餐次为幂等键，份量与吃了什么至少一项，
  症状按原话存。表里没有热量、食材替换、食谱字段，页面也不补。
- **指标补录弹层**：指标下拉只列**这个档案已有记录**的 16 项（未定义指标服务端也会拒），
  数值指标填数字、分级指标填原文；日期、来源可选。
- **进食弹层**：餐次下拉（早餐 / 上午加餐 / 午餐 / 下午加餐 / 晚餐 / 夜间加餐）、份量、吃了什么、症状、备注。
- **读模型排序再修两处**：`metric_points` 与 `nutrition_rows` / `bleed_rows` 改为 `ORDER BY d, ord`。
  只按 ord 排会让今天新补的点排到历史点后面但不在末尾（补录后一图秀末点仍是旧值），这是补录入口上线才暴露的。
- **parity 白名单**：指标页按钮由 `add-meal` 拆出 `add-metric`（原型那一个按钮当时只有 toast），
  比对前把 action 名映射回去；写入按钮块仍整体剥离。
- **测试**：commands 9/9（新增进食幂等与两版本断言、命令表五条）；全量 **32/32**；`npm run check` 全绿。
- **端到端**：hgb 补录 105 → 一图秀末点变 `2026-10-21 105`；fatigue 写「2 级」→ 末点同步；
  进食写「早餐 半碗 小米粥、鸡蛋 吃完腹胀」→ 表格末行、按日期排最后。

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
