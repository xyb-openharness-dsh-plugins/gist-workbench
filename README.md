# 小吉宝 GistPal · 胃肠间质瘤工作台 v0.1.0

本机优先（local-first）的胃肠间质瘤档案工作台：把**病理四事实 + 多套危险度体系 + 靶向用药与剂量变更 +
复查影像结论**放在一张表上，让下一次门诊讨论有据可查。不诊断、不判读、不给用药建议。

品牌色：暖琥珀 `#B5762A`（家族成员对照见 `assets/brand/BRAND.md`）。

---

## 现在到哪一步了

| 阶段 | 状态 |
| --- | --- |
| 阶段 0 · starter init + 强约束文档 | ✅ |
| 阶段 1 · 调研 / SPEC / schema / 临床库 / HTML demo | ✅ **等待第一次确认** |
| 阶段 2 · 开发版 `public/` 与原型逐视图一致 | ✅（parity 10/10） |
| 阶段 3 · dsh-desktop 装机实测 | ⬜ 未开始（G3 未签认前不做） |
| 阶段 4 · push / tag / 经验回流 | ⬜ 未开始 |

**本轮交付物**：

1. 可点的原型 —— `prototypes/v0.2/index.html`（11 个一级页 / 32 个二级页签，两套演示档案）
2. 可查的库 —— `schema/0001_initial.sql`（25 表 184 列，已冻结）+ `demo/demo-data.sqlite`
3. 设计文档 —— `docs/SPEC.md`、`docs/DEV-REQUIREMENTS-2026-10-21.md`、`docs/SCHEMA.md`、
   `docs/CLINICAL-DATA-2026.md`、`docs/DIFF-MATRIX.md`、`docs/PATIENT-FLOW.md`、`docs/DEV-PLAN.md`
4. 临床资料包 —— `research/gist-cancer/`（16 条 2026 年首次公示的干预性试验）

---

## 怎么打开

```bash
# 原型（纯静态，直接开文件即可）
open prototypes/v0.2/index.html

# 开发版（走真实 API，起本地服务）
NODE_OPTIONS= node scripts/dev-server.mjs --workspace ~/Documents/GistPalWorkspace --port 4173 --open
```

`--workspace` 必填且必须是你自己新建的目录；主目录、桌面/下载根、`/tmp`、`/var` 会被拒绝，
**不会静默建目录**。

---

## 自检

```bash
NODE_OPTIONS= node --test test/*.test.mjs      # 21 项，含 parity
node scripts/check-schema.mjs                 # 冻结合同哈希
node scripts/check-demo-columns.mjs           # 生成器与 schema 列一致
node scripts/check-wording.mjs                # 文案红线 + 残留癌种词
npm run check                                 # 语法 + 包结构
```

说明：跑 `node:sqlite` 相关测试前先清空 `NODE_OPTIONS`（本机环境变量会注入 require 钩子）。

---

## 目录

```
prototypes/v0.2/   定稿原型（index.html / style.css / app.js / demo-data.js）
public/            开发版前端（与原型逐视图 parity）
dsh/               宿主侧：迁移、读模型、HTTP 路由、工作台装配
lib/               客户端注册、布局常量、版本
schema/            迁移 + 冻结合同
demo/              演示数据生成器与 sqlite
research/          临床试验资料包（不进产物）
docs/              设计文档（SPEC / 需求 / SCHEMA / 临床数据 / 差异矩阵 / 患者流程 / 开发计划）
scripts/           采集、校验、开发服务
test/              数据层、接口、界面 parity
```

---

## 边界

只提供信息，不做诊断与治疗建议。危险度、分子分型、影像结论一律保留**报告原文与来源**，
工作台不重算、不解读、不排序。文案红线见 `scripts/check-wording.mjs`。

本项目使用小胰宝/小 x 宝社区 Workbench 方法与模板初始化；业务实现与第三方资料许可须在发布前确认。
