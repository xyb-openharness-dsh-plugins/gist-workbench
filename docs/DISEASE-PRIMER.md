# 疾病概要 · 胃肠间质瘤

> 本项目实例文件，由 `xyb-workbench-starter` 的 `templates/DISEASE-PRIMER.md` 复制而来。
> 规范：`docs/36-DISEASE-PRIMER.md`。填完打勾，未填的写「本台尚未整理」——**不许删段**。

- 项目 / 品牌：小吉宝 GistPal
- 病种：胃肠间质瘤（Gastrointestinal Stromal Tumor，GIST）
- 最后更新：2026-10-25
- 数据文件：`prototypes/v0.2/primer-data.js`（`window.DISEASE_PRIMER`）
- README 对应段：`## 疾病概要`

## 1 定义（`definition`）

胃肠间质瘤（GIST）是起源于消化道间叶组织、通常与 Cajal 间质细胞相关的肿瘤，与上皮来源的「癌」不属于同一类。因此本台不用 TNM 作默认结构，而把「病理四事实 + 危险度」放在最前面。

- 最常见部位为胃（50–70%），其次小肠（20–30%）；结直肠、食管、网膜少见。部位必须单列，因为不同危险度体系按部位给不同阈值。
- 分子主轴：KIT 突变约 70–80%（exon 11 最常见，exon 9 约 10–15%）、PDGFRA 约 5–8%、野生型约 10–15%（SDH 缺陷、NF1、BRAF、NTRK 等）。外显子编号照报告原文抄，本台不推断。
- **危险度分级与分期是两套东西**：常用改良 NIH（Fletcher）与 AFIP-Miettinen，按大小 + 核分裂数（AFIP 另加部位）分级；本台不把危险度当 TNM，不换算、不取最高。
- 肿瘤破裂（术前自发或术中）独立于危险度体系记录，不与任何一级混写。
- 转移以肝转移与腹膜播散为主，淋巴结转移少；本台不设「淋巴结分期」结构。
- GIST 没有公认的血清肿瘤标志物；CEA / CA19-9 / SCC 不进默认指标集，LDH 只作普通化验记录。

- 不写「预后差 / 恶性程度高 / 发展快」这类判读，也不写「预后如何」。
- 三套危险度体系的名称与阈值差异照 `docs/CLINICAL-DATA-2026.md` §2 记录，不混用。

**来源**：NCCN · NCCN Guidelines · Gastrointestinal Stromal Tumors（GIST）· v1.2026（2026-01-13 更新）· 未取得原件，据二次来源 · 页码待核 ｜ CSCO · CSCO 胃肠间质瘤诊疗指南 · 2025 版 · 未取得原件，据二次来源 · 页码待核 ｜ 中国 GIST 共识 · 中国胃肠间质瘤诊断治疗共识（2017 修改版）· 2017 · 未取得原件，据二次来源 · 页码待核

## 2 医学资料规范和指南情况（`evidence`）

| 机构 | 文件 | 版本 / 年份 | 原件 | 本台的用途 |
|---|---|---|---|---|
| NCCN | NCCN Guidelines · Gastrointestinal Stromal Tumors（GIST） | v1.2026（2026-01-13 更新） | 未取得原件 | 危险度多体系、线序与复查节奏的并列引用 |
| CSCO | CSCO 胃肠间质瘤诊疗指南 | 2025 版 | 未取得原件 | 国内推荐分级与野生型四分；具体条文未逐条落文档，不作引用依据 |
| 中国 GIST 共识 | 中国胃肠间质瘤诊断治疗共识（2017 修改版） | 2017 | 未取得原件 | 国内常用危险度分级；阈值与 AFIP 接近但不完全一致 |
| WHO | Classification of Tumours: Digestive System Tumours | 版本未核实 | 未取得原件 | 病理类型命名的口径 |

- 一台一表，不合并。
- 未取得原件的均已在表内标出，只写「存在、大致讲什么」，不引用具体条文。
- 三套危险度体系并列，不在本表里做换算或取最高。

**来源**：见上表逐行。

## 3 目前治疗全景概要（`landscape`）

按**病期 / 线序**分组，每组只列「指南列举过的手段类别」，不排序、不比优劣。

### 3.1 局限期（可以完整切除时）

- 手术：完整切除（R0）是被列出的目标，同时避免肿瘤破裂；一般不常规清扫淋巴结。
- 术前靶向治疗：部分局部进展、需要缩小体积的情形先做 TKI，本台按「术前 / 术后」阶段分开记录。
- 内镜切除：EFTR / ESD 等术式出现在在研登记里，适用条件按内镜与病理评估决定。

### 3.2 术后辅助

- 靶向治疗（TKI）：高危常规 3 年；极高危（含破裂、非胃来源高核分裂等情形）可考虑延至 5–6 年。
- 复查：高危切除后前 2–3 年每 3–4 个月腹盆增强 CT，第 4–5 年每 6 个月，之后每年至 10 年。

### 3.3 晚期 / 转移后（线序）

- 一线：伊马替尼。二线：舒尼替尼。三线：瑞戈非尼。四线：瑞普替尼。
- 特殊分子亚型单列：PDGFRA D842V 对应阿伐替尼；SDH 缺陷型对应舒尼替尼 / 瑞戈非尼等。本台只并列记录，不比较优劣。
- 临床研究：指南把「参加登记良好的临床试验」列为一项正式选项，而不是最后手段。

### 3.4 贯穿全程

- 靶向用药记录：剂量变更每次一行，含「从多少到多少 + 医生原话理由」；漏服按天记事实，不计算依从率百分比。
- 副作用与复查：副作用按 CTCAE 原文分级照抄；晚期用药中每 2–3 个月影像评估，影像结论抄原文，不做疗效评价。

**这一段末尾必须有固定出口（原话照抄，不要改写）：**

> 以上是文献与指南里列出的手段，按病期与线序排列，不代表任何一项适合你。选哪一个，这一句需要问你的医生。

**来源**：NCCN · NCCN Guidelines · Gastrointestinal Stromal Tumors（GIST）· v1.2026 · 未取得原件，据二次来源 · 页码待核 ｜ CSCO · CSCO 胃肠间质瘤诊疗指南 · 2025 版 · 未取得原件，据二次来源 · 页码待核

## 4 发展趋势（`trend`）

只写**已发生的事实**，每条都带日期或版本号。五类白名单（`docs/36-DISEASE-PRIMER.md` §2.3）：

1. 指南版本更替 —— 2026-01-13，NCCN GIST 指南更新为 v1.2026。
2. 监管批件 —— 本项目尚未整理到带批准日期的批件记录，**本段不列**。
3. 在研登记规模与阶段分布 —— 截至 2026-10，本项目资料包收录 2026 年首次公示的 GIST 干预性试验 16 条：RECRUITING 12 / NOT_YET_RECRUITING 3 / ENROLLING_BY_INVITATION 1，含中国中心 8 条；ChinaDrugTrials 与 ChiCTR 未采集。
4. 分类体系更新 —— WHO 版本未核实，**本段不列**。
5. 指南结构变化 —— 2025 年 CSCO 版：辅助治疗 6 年推荐级别上调；野生型 GIST 按 SDH / NF1 / BRAF / NTRK 四分。

**禁止**：展望、预测、推荐、优劣比较、上市时间猜测、疗效数字对比。

**来源**：NCCN · NCCN Guidelines · Gastrointestinal Stromal Tumors（GIST）· v1.2026（2026-01-13 更新）· 未取得原件，据二次来源 · 页码待核 ｜ CSCO · CSCO 胃肠间质瘤诊疗指南 · 2025 版 · 未取得原件，据二次来源 · 页码待核 ｜ 中国 GIST 共识 · 中国胃肠间质瘤诊断治疗共识（2017 修改版）· 2017 · 未取得原件，据二次来源 · 页码待核 ｜ ClinicalTrials.gov · 2026 年 GIST 干预性研究登记资料包（research/gist-cancer/）· 检索日 2026-10 · 一手登记数据，本项目自采 · ChinaDrugTrials 与 ChiCTR 未采集

## 5 落地清单

- [x] `prototypes/v0.2/primer.css`（从 `assets/patterns/disease-primer.css` 复制，未改结构）
- [x] `prototypes/v0.2/primer.js`（从 `assets/patterns/disease-primer.js` 复制，未改逻辑）
- [x] `prototypes/v0.2/primer-data.js`（本文件四段转成 `window.DISEASE_PRIMER`）
- [x] `index.html` 三处引用：`<link rel="stylesheet" href="primer.css">` / `<script src="primer-data.js">` / `<script src="primer.js">`
- [x] 顶栏出现「?」（模块自动插进 `.top-actions`，未手写按钮）
- [x] README 的 `## 疾病概要` 四段正文写好，小标题与数据文件一致
- [x] `node scripts/probe-disease-primer.mjs --url <原型地址>` 全绿（9/9）

## 6 验收（P1–P8）

实测命令（端口 8133）：

```bash
NODE_OPTIONS= node scripts/probe-disease-primer.mjs --port 8133 \
  --url http://127.0.0.1:8133/prototypes/v0.2/index.html
```

| 编号 | 判据 | 结果 |
|---|---|---|
| P1 | 顶栏有可点「?」，aria-label 说明四段 | ✅ PASS（text="?"，label 含「定义…发展趋势」） |
| P2 | 整页面板，四段齐全且顺序为 定义 → 指南 → 治疗全景 → 趋势 | ✅ PASS（definition › evidence › landscape › trend） |
| P3 | 面板宽高 ≥ 视口 90% | ✅ PASS（1249×829 / 视口 1280×860） |
| P4 | 打开压一条 history，`history.back()` 收起 | ✅ PASS（history.length=3，返回后 open=false） |
| P5 | 「返回」「关闭」两个独立入口 | ✅ PASS（back=true close=true same=false） |
| P6 | 关闭后焦点回触发按钮、滚动位置不变 | ✅ PASS（scrollY 260→260） |
| P7 | Esc 只退一层 | ✅ PASS（收起后仍在本页） |
| P8 | 四段齐全、每段有来源、趋势段无禁止词 | ✅ PASS |

## 7 本项目教训

1. **危险度和分期不能写成一层。** SPEC §2.10 专门强调「危险度是多套并存的记录，不是一个算出来的数字」。写作时最容易滑的一句是「高危 = 分期偏高」——它把危险度体系换成了 TNM，本文件因此把两者分开表述，并写明不换算、不取最高。
2. **「3 年 / 5–6 年」是记录位，不是建议。** 指南给的是年限区间，工作台只能记医生实际写的起止；写成「应该吃 3 年」就越界。
3. **趋势段写 CSCO 变化时只写「推荐级别上调」这一事实**，不写「所以现在更推荐延长」，后者是第 ③ 层判断。
