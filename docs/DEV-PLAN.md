# 开发计划（GIST · 小吉宝）

基准：以 `docs/SPEC.md` 的 11 个一级页为准；里程碑只认本文件，其它口头说法不作数。

---

## M0 · 骨架与契约（已完成）

| 项 | 状态 |
| --- | --- |
| starter init（包名 / 客户端注册 / 版本链路 / 布局常量） | ✅ |
| `AGENTS.md`、`prompts/ZERO-TO-DEV.md` 就位 | ✅ |
| 四契约落进 schema 注释与读模型 | ✅ |

## M1 · 信息结构与设计（已完成，待确认）

| 项 | 状态 | 判据 |
| --- | --- | --- |
| G1 需求调研（NCCN v1.2026 / CSCO 2025 / 本机资料） | ✅ | `docs/CLINICAL-DATA-2026.md` |
| SPEC 与信息架构 | ✅ | 11 页 / 32 页签，`docs/SPEC.md` §4 |
| schema 设计 | ✅ | 25 表 184 列，`docs/SCHEMA.md` |
| 演示数据 3 套 | ✅ | `demo/build-demo-data.mjs` 单一来源 |
| HTML demo 可点 | ✅ | 零控制台错误、零横向溢出 |
| **G2 逐页确认** | ⬜ | **用户确认后进入 M2** |
| **G3 数据模型评审** | ⬜ | 与 G2 可同批确认 |

## M2 · 开发版与一致性（第二段进行中）

| 项 | 状态 | 判据 |
| --- | --- | --- |
| `public/` 与原型逐视图 parity | ✅ | `test/ui-parity.test.mjs` 10/10 |
| DSH 链路（`dsh/index.js`、路由、读模型） | ✅ | `test/server.test.mjs` 8/8 |
| 数据层 parity | ✅ | `test/store.test.mjs` 5/5 |
| 顶栏三段式 / AI 五态 / 面板 25–45% | ✅ | parity ⑨ |
| 一图秀引擎（单调三次插值、末点避让） | ✅ | 无头渲染实测 |
| 3D 指标卡翻面 | ✅ | `perspective:1200px` + 键盘可达 |
| 写接口（五条命令 + 校验 + 幂等 + 更正版本） | ✅ | `dsh/commands.js`、`test/commands.test.mjs` 9/9、`docs/API-CONTRACT.md` |
| 写接口接进前端（服药 / 反应 / 指标 / 感受 / 进食 五个入口） | ✅ | 无头实测：保存后落库并按日期出现在表格末行（`docs/shots/dev-*.png`） |
| 原件导入（原始字节 + sha256 去重 + 落 `imports/`） | ✅ | `dsh/files.js`、`test/files.test.mjs` 5/5；e2e：`imports/` 内容与源文件一致、重复导入 `unchanged` |
| Markdown 导出（`exports/日期-种类.md`，同名覆盖） | ✅ | e2e：`exports/2026-10-21-复诊准备.md` 生成；`test/files.test.mjs` 覆盖重复导出 |
| 候选逐条核对（只改审核状态，不动事实表） | ✅ | e2e：接受后 `bootstrap.candidates` 状态转 `accepted`；`test/server.test.mjs` 10/10 |
| 上传后自动解析成候选 | ⬜ | 依赖 MinerU 通道（`docs/MINERU.md`）；当前导入只落原件 + 一条待核对 `documents` 行 |

## M3 · 装机与实测（未开始）

| 项 | 前置 | 判据 |
| --- | --- | --- |
| 打 tgz 并在 Desktop profile 安装 | M2 第二段完成 | `state.json` added/pinned；`harness.log` 无 import failed |
| 真实数据目录选择 | 用户选定路径 | 拒绝主目录 / 桌面 / 下载根 / `/tmp` / `/var` |
| 装机后 11 页逐页点 | 装机成功 | 无白屏、无 404、AI 面板可拖 |

## M4 · 发布与回流（未开始）

| 项 | 判据 |
| --- | --- |
| 推 `xyb-openharness-dsh-plugins/gist-workbench` | main 分支 + tag `v0.1.0` |
| 经验回流到 starter | 至少 1 条进 `docs/LESSONS.md`（本轮的「变长行裁尾」与「0/1 与布尔不可混写」） |

---

## 本轮未做（明确列出来，避免误解为遗漏）

1. 写命令五个入口都已接前端；仍缺「删除/撤销一条记错的记录」的入口（契约② 决定不做覆盖式删除，
   要撤销只能再记一条更正，页面上还没有这条路）。
2. 上传后的**解析**未接：原件导入、候选核对、导出三条通路已通，但「把 PDF 变成候选字段」这一步仍是空档——
   现在导入只产生一条 `待核对` 的 `documents` 行，候选要靠手工补录或演示数据。
3. 多档案切换：演示只有 A/B/C 三套（C = 术前靶向 · 未手术 · 危险度待定），切换是内存态，不落库。
4. 临床试验自动更新：资料包是 2026-10-21 快照。
5. 账号、同步、导出 PDF。
6. 装机：G3 未签认，按闸口规则不进入。

---

## 风险与对策

| 风险 | 表现 | 对策 |
| --- | --- | --- |
| 危险度被当结论 | 用户以为页面给的级别是诊断 | 每套体系都带 `source`，页脚常驻"由医生给出" |
| 分子页被当用药指南 | 看到 exon 9 就想"要加量" | 只显示报告原文与状态，页面写死"不据此给出选药方向" |
| 一图秀点太密 | 14 个点挤在半年 | 末点 13px 避让 + 单点不连线 + 分类只画节点 |
| 长程数据疲劳 | 辅助期第 3 年不再记录 | 看板只留三张卡；录入路径最多两步 |
| 术语误用 | 把 leiomyosarcoma 当 GIST | 资料包 README 与文档都写明"不合并" |
