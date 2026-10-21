# 迁移冻结合同（小吉宝 GistPal · 胃肠间质瘤）

`schema/` 下的迁移一旦对外发布就不许再改：改历史迁移 = 两台机器的库结构不一样 = 数据不可复现。
本文件记每个迁移文件的 sha256，由 `scripts/check-schema.mjs` 逐条比对。

要改结构：**新增** `NNNN_name.sql`，并把新文件与哈希追加到下表的末尾。改旧文件会被检查拦下。

| 文件 | sha256 |
| --- | --- |
| `0001_initial.sql` | 15bfed0472edd2bb4d67bdd345919ff32122cd9beb922c8d8afc1225b3b139d8 |

## 0001 的内容边界（写在冻结之前，便于日后审）

25 张表，184 列。分五组：

- **档案级 1 张**：`subjects`（档案标量 + 12 个分节标题；标题为 NULL 表示该档案没有这一节，
  B 档案未手术因此 `surgery_title` 为 NULL）。
- **指标 3 张**：`metrics` / `metric_points` / `molecular`。分类指标 `dec IS NULL` 且
  `kind ∈ {grade, qual}`；数值指标 `kind = 'numeric'`。`band` 用 `band_low/band_high` 两列，
  都没有则为 NULL（≠ 0，参考区间缺失不能当 0 用）。
  `molecular` 的 `state` 四态：`ok` 已出结果 / `na` 未检测 / `warn` 需关注 / `pending` 待出——
  **未检测不得写成"阴性"**，外显子编号照报告原文。
- **通用 8 张**：`events` / `rhythm` / `cycles` / `treatment_lines` / `viewpoints` / `trials` /
  `documents` / `candidate_fields`。
- **GIST 专属 12 张**：
  - `pathology_rows`（`kind` 为 row/gap；gap 是"报告没写"的待补位，不是阴性）
  - `risk_rows`（**一行一个评分体系**：中国 GIST 共识 2017 修改版 / NIH 2008 修改版 / AFIP-Miettinen；
    多套并存不合并、不重算、不排序）
  - `pathway_rows`（治疗路径，`phase` 只取「当前 / 既往」，切换只新增不删除）
  - `surgery_rows`（术式 · 切除范围 · 切缘 · **肿瘤破裂单列** · 机构）
  - `med_rows`（靶向药名 · 剂量 · 给药方式 · 起止 · 状态）
  - `dose_rows`（每次剂量变更一行，`reason` 抄医生原话，不覆盖旧剂量）
  - `adherence_rows`（按天记「按计划 / 漏服 / 减量」，`planned`/`taken` 均为文本，不算依从率）
  - `side_effect_rows`（`term` 用报告名称，`grade` 抄 CTCAE 分级原文，`action` 记实际处理）
  - `imaging_rows`（CT / MRI / 超声内镜 / PET-CT，`finding` 抄结论原文，不解读不测量）
  - `monitor_rows`（复查安排，只记医生给的项目 / 间隔 / 上次 / 下次）
  - `bleed_rows`（黑便 · 呕血 · 头晕乏力 · 急诊，只记发生与处理经过）
  - `nutrition_rows`（份量 · 食物 · 症状；不做热量换算、不给食谱）
- **演示元数据 1 张**：`demo_meta`（`k`/`v`，记演示数据版本与生成时间，不参与业务读模型）。

## 不变量（写进 schema 注释，也是验收条目）

1. 复合主键表裸 `SELECT` 必须 `ORDER BY rowid` 或显式 `ord`，否则行序不保证。
2. 变长行（`imaging_rows` / `monitor_rows` / `nutrition_rows` 等）末尾缺省字段读出来是 `NULL`，
   读模型统一裁尾还原，**不在库里补空串**。
3. 分类指标不写 `unit`；读模型不能补 `unit: null`。
4. 缺基线 / 缺测量时不生成差值，`NULL ≠ 0`。
5. 更正只新增行或新版本，不 `UPDATE` 历史事实。

## 已冻结日期

2026-10-21（阶段 1 交付，供 G3 数据模型评审）。冻结后本轮不再新增迁移。
