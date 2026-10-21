/* 胃肠间质瘤（GIST）工作台 · 初始数据模型（0001）
 *
 * 家族四条契约（与肠癌、胃癌、食管癌同源，改这里等于改契约）：
 *   1. 看法恒不为结论（viewpoints 只记录，不设 is_conclusion 列，读模型保证）；
 *   2. 四点位 1–4 点、缺健侧不生成差值（本癌种没有健侧对照，契约仍保留在指标层，
 *      metric_points 只存单值，不合成差值）；
 *   3. 更正只新增版本，不覆盖（pathway_rows / treatment_lines / dose_rows 留旧行）；
 *   4. 事实四层不合并（documents / candidate_fields / 记录表 / metrics 分表）。
 *
 * 迁移只增不改：本文件冻结后（sha256 见 freeze-contract.md），
 * 要加结构只能新增 0002_*.sql，改这里会被 scripts/check-schema.mjs 拦下。
 *
 * 与胃癌 / 食管癌模型的差异（勿互相抄回）：
 *   - GIST 的核心决策链是「部位 + 大小 + 核分裂 + 破裂 → 危险度 → 手术 / 辅助 / 线序」，
 *     不是 T/N/M 分期，也不是鳞/腺分型。因此有 risk_rows（危险度依据）与 tki_lines（线序）。
 *   - 病理与分子是两条独立事实：pathology_rows 存大体/镜下原文，molecular 存
 *     CD117 / DOG1 / KIT / PDGFRA / SDHB / NGS；「未检测」不得写成「阴性」。
 *   - 用药是长期每日口服，不是周期输液：med_rows（方案）＋ dose_rows（剂量变更）
 *     ＋ adherence_rows（服药记录）＋ side_effect_rows（不良事件分级）四张表分工，
 *     分别回答「吃什么、吃多少、吃没吃、有什么反应」。
 *   - imaging_rows 兼记 CT/MRI/内镜/超声内镜，finding 抄报告原文；
 *     bleed_rows 单独记消化道出血事件（GIST 最常见的急症表现）。
 *   - 不设「肿瘤标志物」专属表：GIST 没有公认的血清标志物，
 *     LDH 等只作为普通数值指标进 metrics，不包装成疗效指标。
 */

/* ---------- 档案级 ---------- */

CREATE TABLE subjects (
  profile_key      TEXT PRIMARY KEY,
  name             TEXT,
  sex              TEXT,
  age              INTEGER,
  meta             TEXT,
  headline         TEXT,
  stage            TEXT,          -- 以医生给出的「局限 / 复发转移」描述为主，不自行套 TNM
  mindset          TEXT,
  dash_keys        TEXT,          -- JSON 数组：看板指标卡顺序
  path             TEXT,          -- JSON 数组：档案路径条（部位 / 危险度 / 当前治疗）
  activity         TEXT,
  family_talk      TEXT,
  /* 分节标题（对应读模型的 { title, rows }；NULL 表示该档案没有这一节） */
  pathology_title  TEXT,
  pathology_status TEXT,
  molecular_title  TEXT,
  risk_title       TEXT,
  pathway_title    TEXT,
  surgery_title    TEXT,
  meds_title       TEXT,
  side_title       TEXT,
  adherence_title  TEXT,
  imaging_title    TEXT,
  monitor_title    TEXT,
  bleed_title      TEXT,
  nutrition_title  TEXT
);

/* ---------- 指标 ---------- */

CREATE TABLE metrics (
  profile_key TEXT,
  key         TEXT,
  name        TEXT,
  unit        TEXT,
  cat         TEXT,
  color       TEXT,
  dec         INTEGER,          -- 数值指标的小数位；NULL 表示分类/等级指标
  kind        TEXT,             -- 'numeric' | 'grade' | 'qual'
  band_low    REAL,
  band_high   REAL,
  note        TEXT,
  PRIMARY KEY (profile_key, key)
);

CREATE TABLE metric_points (
  profile_key TEXT,
  metric_key  TEXT,
  d           TEXT,             -- 采样日期 YYYY-MM-DD
  v_num       REAL,             -- 数值指标
  v_text      TEXT,             -- 分类/等级指标原值
  src         TEXT,             -- 来源（报告名 / 场合）
  ord         INTEGER,
  PRIMARY KEY (profile_key, metric_key, d, ord)
);

/* 分子与免疫组化：CD117 / DOG1 / KIT 外显子 / PDGFRA 外显子 / SDHB / NGS。
   四态 state：ok 已出结果 / na 未检测 / warn 需关注 / pending 待出。
   未检测不得写成"阴性"；外显子编号照报告原文，不由工作台推断。 */
CREATE TABLE molecular (
  profile_key TEXT,
  k           TEXT,
  v           TEXT,
  src         TEXT,
  state       TEXT,
  note        TEXT,
  ord         INTEGER
);

/* ---------- 病情与时间轴 ---------- */

CREATE TABLE events (
  profile_key TEXT,
  d           TEXT,
  label       TEXT
);

/* 复查节奏：只抄医生给的间隔与下一次日期，不生成统一随访表 */
CREATE TABLE rhythm (
  profile_key TEXT,
  item        TEXT,
  freq        TEXT,
  guideline   TEXT,
  next        TEXT,
  ord         INTEGER
);

/* 治疗阶段（术前治疗 / 手术 / 辅助 / 晚期一线…），用于时间轴泳道 */
CREATE TABLE cycles (
  profile_key TEXT,
  name        TEXT,
  date        TEXT,
  drugs       TEXT,
  status      TEXT,
  done        INTEGER,
  ord         INTEGER
);

CREATE TABLE treatment_lines (
  profile_key TEXT,
  name        TEXT,
  detail      TEXT,
  done        INTEGER,
  ord         INTEGER
);

/* ---------- GIST 专属 ---------- */

/* 病理原文：kind = 'row'（已核对条目） / 'gap'（缺口，待核对） */
CREATE TABLE pathology_rows (
  profile_key TEXT,
  kind        TEXT,
  a           TEXT,
  b           TEXT,
  ord         INTEGER
);

/* 危险度分级依据（SPEC A2）：
   一行一个评分体系（中国 GIST 共识 2017 修改版 / NIH 2008 修改版 / AFIP），
   grade 存原文分级，basis 存该体系用的参数，source 存报告或医生原话。
   工作台只记录医生用哪套体系给出的结论，不自己算分级。 */
CREATE TABLE risk_rows (
  profile_key TEXT,
  system      TEXT,
  grade       TEXT,
  basis       TEXT,
  source      TEXT,
  note        TEXT,
  ord         INTEGER
);

/* 治疗路径（SPEC A3）：术前靶向 / 手术 / 术后辅助 / 晚期系统治疗 / 局部处理。
   切换路径只新增一行，phase 只取「当前 / 既往」，旧路径不删除。 */
CREATE TABLE pathway_rows (
  profile_key TEXT,
  phase       TEXT,
  name        TEXT,
  window      TEXT,
  detail      TEXT,
  note        TEXT,
  ord         INTEGER
);

/* 手术记录（SPEC A4）：术式、切除范围、切缘、肿瘤破裂、机构。
   破裂（rupture）是 GIST 最重要的预后事实之一，必须单列，不埋在备注里。 */
CREATE TABLE surgery_rows (
  profile_key TEXT,
  d           TEXT,
  kind        TEXT,
  resection   TEXT,
  margin      TEXT,
  rupture     TEXT,
  institution TEXT,
  note        TEXT,
  ord         INTEGER
);

/* 用药方案（SPEC A5）：药名、剂量、给药方式、起止、状态。
   只抄医嘱原文，不给剂量建议、不比较药物优劣。 */
CREATE TABLE med_rows (
  profile_key TEXT,
  name        TEXT,
  dose        TEXT,
  schedule    TEXT,
  start       TEXT,
  end         TEXT,
  status      TEXT,
  note        TEXT,
  ord         INTEGER
);

/* 剂量变更（SPEC A5）：每次调整新增一行，reason 抄医生原话；
   不覆盖旧剂量——"什么时候减量、为什么"本身就是要带给医生的信息。 */
CREATE TABLE dose_rows (
  profile_key TEXT,
  d           TEXT,
  drug        TEXT,
  from_dose   TEXT,
  to_dose     TEXT,
  reason      TEXT,
  ord         INTEGER
);

/* 服药记录（SPEC A6）：按天记「按计划 / 漏服 / 减量」，只记事实。
   planned 与 taken 都是文本（如 "400 mg" / "漏服"），不做依从率计算与评价。 */
CREATE TABLE adherence_rows (
  profile_key TEXT,
  d           TEXT,
  drug        TEXT,
  planned     TEXT,
  taken       TEXT,
  note        TEXT,
  ord         INTEGER
);

/* 不良事件（SPEC A7）：term 用报告/医生写的名称，grade 抄 CTCAE 分级原文；
   action 记实际处理（继续 / 减量 / 暂停 / 对症），不判断该不该停药。 */
CREATE TABLE side_effect_rows (
  profile_key TEXT,
  d           TEXT,
  term        TEXT,
  grade       TEXT,
  action      TEXT,
  note        TEXT,
  ord         INTEGER
);

/* 影像与内镜（SPEC A8）：CT / MRI / 超声内镜 / PET-CT，finding 抄结论原文；
   next 抄医生写的下一次安排，没有就留空。工作台不解读影像、不测量病灶。 */
CREATE TABLE imaging_rows (
  profile_key TEXT,
  d           TEXT,
  kind        TEXT,
  site        TEXT,
  finding     TEXT,
  next        TEXT,
  note        TEXT,
  ord         INTEGER
);

/* 复查安排（SPEC A9）：谁安排的、多久一次、上次与下次；只记医生安排 */
CREATE TABLE monitor_rows (
  profile_key TEXT,
  item        TEXT,
  freq        TEXT,
  last        TEXT,
  next        TEXT,
  note        TEXT,
  ord         INTEGER
);

/* 消化道出血与急症事件（SPEC A10）：黑便 / 呕血 / 头晕乏力 / 急诊就诊。
   只记发生与处理经过，不判断严重度、不给居家处理建议。 */
CREATE TABLE bleed_rows (
  profile_key TEXT,
  d           TEXT,
  kind        TEXT,
  detail      TEXT,
  ord         INTEGER
);

/* 进食与体重相关记录（SPEC A11）：份量、食物、症状；不做热量换算、不给食谱 */
CREATE TABLE nutrition_rows (
  profile_key TEXT,
  d           TEXT,
  slot        TEXT,
  amount      TEXT,
  foods       TEXT,
  symptoms    TEXT,
  note        TEXT,
  ord         INTEGER
);

/* ---------- 通用 ---------- */

CREATE TABLE viewpoints (
  profile_key TEXT,
  d           TEXT,
  mood        TEXT,
  text        TEXT,
  ord         INTEGER
);

CREATE TABLE trials (
  nct_id  TEXT PRIMARY KEY,
  title   TEXT,
  phase   TEXT,
  status  TEXT,
  sponsor TEXT,
  url     TEXT
);

CREATE TABLE documents (
  profile_key TEXT,
  id          TEXT,
  name        TEXT,
  date        TEXT,
  type        TEXT,
  status      TEXT,
  ord         INTEGER,
  PRIMARY KEY (profile_key, id)
);

CREATE TABLE candidate_fields (
  profile_key TEXT,
  id          TEXT,
  name        TEXT,
  value       TEXT,
  source      TEXT,
  status      TEXT,
  ord         INTEGER,
  PRIMARY KEY (profile_key, id)
);

CREATE TABLE demo_meta (
  k TEXT PRIMARY KEY,
  v TEXT
);

CREATE INDEX idx_points   ON metric_points (profile_key, metric_key);
CREATE INDEX idx_imaging  ON imaging_rows  (profile_key, d);
CREATE INDEX idx_docs     ON documents     (profile_key);
