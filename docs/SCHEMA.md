# 数据主体—关系—表（小吉宝 GistPal v0.1）

对应迁移：`schema/0001_initial.sql`（25 表 / 184 列，已冻结，sha256 见 `schema/freeze-contract.md`）。
演示库：`demo/demo-data.sqlite`，由 `demo/build-demo-data.mjs` 从 `prototypes/v0.2/demo-data.js` 生成。

---

## 1. 实体与关系

```
subjects（档案，profile_key 主键）
 ├─ metrics ──── metric_points        指标定义 + 逐次采样点
 ├─ molecular                         分子/免疫组化（四态）
 ├─ pathology_rows                    病理事实（row）与报告待补位（gap）
 ├─ risk_rows                         危险度：一行一个评分体系
 ├─ pathway_rows                      治疗路径（当前 / 既往）
 ├─ surgery_rows                      手术（含破裂独立列）
 ├─ med_rows ─┬─ dose_rows            用药 → 剂量变更
 │            └─ adherence_rows       用药 → 逐日服药事实
 ├─ side_effect_rows                  不良事件（CTCAE 原文）
 ├─ imaging_rows                      影像/内镜结论原文
 ├─ monitor_rows                      复查安排（医生给的间隔）
 ├─ bleed_rows                        出血与急症
 ├─ nutrition_rows                    进食记录
 ├─ viewpoints                        本人看法（恒不为结论）
 ├─ documents                         资料库（原件引用）
 └─ candidate_fields                  整理草稿候选（未接受前不算事实）
events / rhythm / cycles / treatment_lines   （时间轴与线序，按 profile_key 归属）
trials（全局，nct_id 主键）   demo_meta（演示元数据）
```

**核心关系**：所有业务事实以 `profile_key` 归属档案；`metric_points` 用 `(profile_key, metric_key)` 指回
`metrics`；`dose_rows` / `adherence_rows` 用 `drug` 文本对齐 `med_rows.name`（不做外键——药名是医嘱原文，
同一药在不同医院写法可能不同，硬外键会逼用户改原文）。

---

## 2. 表清单与关键字段

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `subjects` | `profile_key, name, sex, age, meta, headline, stage, mindset, dash_keys, path, activity, family_talk` + 12 个 `*_title` | `stage` 存医生给的「局限 / 复发转移」描述，**不自行套 TNM**；`*_title` 为 NULL 表示该档案没有这一节 |
| `metrics` | `key, name, unit, cat, color, dec, kind, band_low, band_high, note` | `dec IS NULL` → 分类/等级指标；`kind ∈ {numeric, grade, qual}` |
| `metric_points` | `metric_key, d, v_num, v_text, src, ord` | 数值进 `v_num`，分类原值进 `v_text`；`src` 记来源场合 |
| `molecular` | `k, v, src, state, note, ord` | `state ∈ {ok, na, warn, pending}`；**`na` 不得渲染为"阴性"** |
| `pathology_rows` | `kind, a, b, ord` | `kind='row'` 是已确认事实，`'gap'` 是"报告没写、待补" |
| `risk_rows` | `system, grade, basis, source, note, ord` | 一行一套体系，**不合并** |
| `pathway_rows` | `phase, name, window, detail, note, ord` | `phase ∈ {当前, 既往}`，切换只新增 |
| `surgery_rows` | `d, kind, resection, margin, rupture, institution, note, ord` | `rupture` 独立列 |
| `med_rows` | `name, dose, schedule, start, end, status, note, ord` | `status` 如「在用 / 已停 / 暂停」 |
| `dose_rows` | `d, drug, from_dose, to_dose, reason, ord` | 每次调整一行，不覆盖 |
| `adherence_rows` | `d, drug, planned, taken, note, ord` | 文本对齐，不算百分比 |
| `side_effect_rows` | `d, term, grade, action, note, ord` | `grade` 抄 CTCAE 原文 |
| `imaging_rows` | `d, kind, site, finding, next, note, ord` | 结论原文；`next` 抄医生写的下一次安排 |
| `monitor_rows` | `item, freq, last, next, note, ord` | 只记医生安排 |
| `bleed_rows` | `d, kind, detail, ord` | 黑便 / 呕血 / 头晕乏力 / 急诊 |
| `nutrition_rows` | `d, slot, amount, foods, symptoms, note, ord` | 份量与症状，不做热量换算 |
| `cycles` | `name, date, drugs, status, done, ord` | `done` 存 **0/1** |
| `treatment_lines` | `name, ..., done` | `done` 存**布尔**（与 `cycles` 不同，见硬约束 H7） |
| `trials` | `nct_id, title, phase, status, sponsor, url` | 全局表，不挂档案 |
| `documents` | `id, name, date, type, status, ord` | 原件永远保留 |
| `candidate_fields` | `id, name, value, source, status, ord` | 未接受前只是候选 |

---

## 3. 读模型与一致性

- 入口：`dsh/readmodels.js` → `bootstrap()` / `listSubjects()` / `getProfile()`；
  开发版 `/api/gist/bootstrap` 返回的 `profiles` 必须与 `prototypes/v0.2/demo-data.js` **逐字段一致**
  （`test/store.test.mjs` ③ 与 `test/ui-parity.test.mjs` 双重把关）。
- **变长行裁尾**：演示数据里的表行是变长数组（末尾字段没写就是"没有"），sqlite 读出来是 `NULL`。
  读模型统一走 `trimTail()` 还原尾部，**不在库里补空串**，也不在 JSON 里写 `null` 占位。
- 数字与文本分流：数值指标读出来必须是 `number`，分类指标必须是原始字符串（`'1 级'` 而非 `1`）。
- 排序：指标点按 `ord, d` 升序；所有 `*_rows` 按 `ord`；`events` 与无 `ord` 的复合主键表按 `rowid`。

---

## 4. 扩展策略

- **定义类扩展**（新增一个指标、新增一个分子项）：只写数据行，不改结构。
- **结构类扩展**：新增 `schema/0002_*.sql` 并在 `freeze-contract.md` 追加哈希；**禁止改 0001**。
- 不把结构化关系塞进任意 JSON：`subjects` 里只放展示用短数组（`dash_keys` / `path`），业务事实一律落表。
- 备份与回滚：本轮不做自动备份；装机后库文件位置由用户选定，工作台不静默建目录。
