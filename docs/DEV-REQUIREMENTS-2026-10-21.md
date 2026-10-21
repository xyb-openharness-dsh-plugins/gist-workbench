# 胃肠间质瘤开发版需求与硬约束清单（2026-10-21）

本文件是 GIST 工作台从「starter 骨架」进入「调研 → schema → 临床数据 → demo HTML → 开发版」的**唯一执行依据**。
前半部分是范围与验收（沿用 `gastric-workbench` / `esophageal-workbench` 的体例），
后半部分是**从前几轮癌种开发中逐条回收的错误**，标为硬约束，违反即视为未完成。

样板链路 = `gastric-workbench` v0.1.0（`npm run check` 全绿 + 21 项测试 + 无头浏览器实测）。
本轮目标：**达到样板的开发版效果**，并按 GIST SPEC（`docs/SPEC.md`）换内容。

---

## 一、范围（本轮要交付什么）

| # | 交付物 | 落点 | 怎么验 |
| --- | --- | --- | --- |
| 1 | GIST 2026 临床试验资料包 | `research/gist-cancer/{manifest.json, trials-2026.jsonl, gist_cancer_trials_2026.sqlite, README.md}` | manifest 记录数 = jsonl 行数 = sqlite 行数；sha256 与实算一致；`docs/CLINICAL-DATA-2026.md` 写清口径与限制 |
| 2 | 采集脚本随项目版本化 | `scripts/fetch-gist-trials-2026.mjs` | `--dry-run` 只打印命中数 + 剔除样本；重跑可复现 |
| 3 | GIST 数据模型 | `schema/0001_initial.sql` + `schema/freeze-contract.md` | `node scripts/check-schema.mjs` 验哈希；改结构只能加 `0002_*.sql` |
| 4 | 2 套 6 个月演示档案 | `demo/build-demo-data.mjs` → `prototypes/v0.2/demo-data.js` + `demo/demo-data.sqlite` | 单测：指标点升序、主序列跨度 ≥150 天、两档案都能渲染全部视图 |
| 5 | 原型 demo 四件套 | `prototypes/v0.2/{index.html, style.css, app.js, demo-data.js}` | 浏览器打开无控制台错误；一级页 **11 个**（SPEC §4）；二级页签 **32 个** |
| 6 | 开发版 `public/` + DSH 链路 | `public/{index.html, style.css, shell.css, app.js}`、`dsh/*`、`lib/*` | `test/ui-parity.test.mjs` 逐视图比对原型与开发版 |
| 7 | 顶栏 / AI 面板 / 一图秀 / 3D 卡 | 见第二节 | 见第二节 |

---

## 二、照抄样板的四条产品要求（不许"按比例缩减"）

| # | 要求 | 做什么 | 怎么验 |
| --- | --- | --- | --- |
| R1 | 顶栏三段式 + AI 主按钮五态 | 左＝品牌+版本 chip / 中＝一句说明 `flex:1` / 右＝主操作组 `margin-left:auto`；五态：AI 对话 / 正在连接… / 收起 AI 对话 / 打开 AI 对话 / AI 对话暂不可用 | parity ⑨ |
| R2 | AI 面板可打开 / 隐藏 / 调宽 | 25%–45% 可拖、`role="separator"` + aria 区间、键盘 ←/→、Home/End、localStorage 记忆（`xyb-gist-agent-ratio`） | parity ⑨ + 浏览器实测 |
| R3 | 一图秀严格按设计原型 | 统一画布常量、单调三次插值（Fritsch-Carlson，无过冲）、每指标独立配色、治疗泳道、末点防叠 13px；**默认 Hb + 体重（数值）+ 乏力（分类）** | parity ① 逐视图 |
| R4 | 3D 指标卡按 `docs/24-METRIC-TREND-TAB-DESIGN.md` | 整卡点击 180°、`perspective:1200px`、`480ms cubic-bezier(.2,.7,.2,1)`、双面 `backface-visibility:hidden`、隐藏面 `aria-hidden`、键盘 Enter/Space、分类记录不翻不连线 | 卡片 HTML 有 `role="group" tabindex="0" data-flipped` |

---

## 三、GIST 专属内容要求

| # | 要求 | 说明 |
| --- | --- | --- |
| N1 | **危险度多体系并列** | 每套体系一行：`体系名 / 分级原文 / 依据参数 / 来源`。至少覆盖「中国 GIST 共识 2017 修改版」「NIH 2008 修改版」「AFIP-Miettinen」三者中的两套。**不合并、不取最高、不给推荐体系** |
| N2 | **肿瘤破裂独立字段** | 出现在手术记录与病理页；可选值为报告原文（如「术中破裂」「未见破裂」「未提及」），"未提及"≠"未见" |
| N3 | **分子四态** | `ok 已出结果 / na 未检测 / warn 需关注 / pending 待出`；`na` 渲染为「未检测」，绝不写"阴性" |
| N4 | **药物浓度单独一段** | 伊马替尼谷浓度 `ng/mL`，只记数值与采样日期，**不给目标区间结论**（参考区间按报告原样保留） |
| N5 | **无肿瘤标志物** | 指标集不含 CEA / CA19-9 / SCC；LDH 归「生化」，不带"肿瘤标志物"标签 |
| N6 | **出血与急症独立页签** | 黑便 / 呕血 / 头晕乏力 / 急诊就诊；只记发生与处理经过，不判严重度 |
| N7 | **依从性不算百分比** | 只显示"按计划 / 漏服 / 减量"的逐日记录与条数，**界面不出现依从率** |
| N8 | **线序结构** | 1L 伊马替尼 → 2L 舒尼替尼 → 3L 瑞戈非尼 → 4L 瑞普替尼；换线新增行，旧线保留 |

---

## 四、硬约束（前几轮逐条回收的错误，GIST 不许再犯）

### 4.1 数据层

| # | 约束 | 错误来源 |
| --- | --- | --- |
| H1 | **复合主键表裸 `SELECT *` 必须写 `ORDER BY rowid`**；手写"最新在前"的数组只用 `ORDER BY ord`，绝不叠加 `DESC` | 肠癌 parity ③ |
| H2 | **变长行数组的尾部缺省字段必须由读模型裁尾还原**：库里存 NULL、`demo-data.js` 里是"数组更短"，直接 `deepStrictEqual` 必红（本轮 `imaging_rows` 第 6 列就是这么红的） | **GIST 本轮实测**（readmodels `trimTail`） |
| H3 | **可选字段显式 `null`**，读模型按 `=== null` 判定；分类指标不写 `unit`，读模型不能补 `unit: null` | 肠癌 parity ③ |
| H4 | 演示数据口径：化验/体征每 2–4 周一点并延续到当天；**影像按真实频率，不加密** | 家族约定 |
| H5 | 看法恒不为结论；更正只新增版本；`NULL ≠ 0` | 家族四条契约 |
| H6 | **生成器与 schema 列数/列序逐一核对**，写完必须跑 `node scripts/check-demo-columns.mjs` | 胃癌轮次（连续 6 次列数不匹配） |
| H7 | **布尔与 0/1 不可混写**：`treatment_lines.done` 存布尔、`cycles.done` 存 0/1，读模型必须按各自的存储形态透传（`!!` 会把 0/1 变成布尔，parity 红） | **GIST 本轮实测**（`cycles` 那行） |
| H8 | 迁移只增不改；冻结哈希写进 `schema/freeze-contract.md` | 家族约定 |

### 4.2 前端

| # | 约束 | 错误来源 |
| --- | --- | --- |
| H9 | 图标 key 必须有别名兜底，最终兜底 `icons.badge` | 肠癌截图 |
| H10 | 内联 `<svg>` 必须显式给 `width/height` | 家族踩坑 |
| H11 | 页脚贴底：`.work-area{min-height:100%}` + `.work-grid{flex:1 1 auto;align-content:start}` | 家族踩坑 |
| H12 | `[hidden]` 要防 CSS `display` 覆盖：`[hidden]{display:none!important}` | 家族踩坑 |
| H13 | 二级页签必须按 `state.sub` 分流，测试穷举 sub × 档案 | 用户轮次 A |
| H14 | 字号基线 12.5px；面板参数唯一来源 `lib/layout.js` | 用户轮次 C |
| H15 | **对象字面量不许出现重复键**（`PAGE_CONTEXT` 曾把 `nutrition` 定义两次，后者静默覆盖） | 胃癌轮次 F |
| H16 | 页面不得残留上一个癌种的术语：`esophag`/`吞咽`/`SCC`/`CEA`/`小咽宝`/`EsopPal` 一律不得出现在 GIST 项目的 `public/`、`prototypes/`、`dsh/`、`lib/` 里（`scripts/check-wording.mjs` 会拦） | **GIST 本轮** |

### 4.3 文案

| # | 约束 |
| --- | --- |
| C1 | 禁用词：建议治疗 / 可能复发 / 可以停药 / 无需就医 / 推荐方案 / 治愈率 / 生存率 |
| C2 | 不用「患者应」「必须」「一定要」祈使句；统一"可以带给医生看""医生写的原文是" |
| C3 | 危险度、疗效、预后一律标注来源（报告名 / 医生原话 / 日期），不出现工作台自己的判断 |
| C4 | 数字带单位和口径：`7.0 cm`、`12/50 HPF`、`400 mg qd`、`1211 ng/mL` |

---

## 五、本轮不做

写接口（`POST /api/*`）、上传解析实装、装机包、多档案真实切换、账号与同步、临床试验自动更新。
以上留到阶段 2 之后，本轮只交"可点的原型 + 可查的库 + 可讲清的设计文档"。
