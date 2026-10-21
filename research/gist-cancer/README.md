# GIST 2026 临床试验资料包

采集日：2026-10-21。生成脚本：`scripts/fetch-gist-trials-2026.mjs`（重跑可复现）。

## 文件

| 文件 | 内容 |
| --- | --- |
| `trials-2026.jsonl` | 16 行，一行一条登记记录 |
| `gist_cancer_trials_2026.sqlite` | `trial_records` / `source_coverage` / `metadata` 三张表，16 条 |
| `manifest.json` | 计数、状态分布、口径、sha256、限制 |

## 口径

- 来源：ClinicalTrials.gov API v2
- `query.cond` 三组并集：`gastrointestinal stromal tumor` / `gastrointestinal stromal tumour` / `GIST`
- 过滤：`AREA[StudyFirstPostDate]RANGE[2026-01-01,MAX] AND AREA[StudyType]INTERVENTIONAL`
- 本地术语过滤：命中标题或 conditions 里的 GIST 词；缩写 `GIST` 用词边界匹配

结果：去重后 16 条，术语过滤保留 16 条，剔除 0 条。状态分布 RECRUITING 12 / NOT_YET_RECRUITING 3 /
ENROLLING_BY_INVITATION 1。含中国中心 8 条。

## 限制（引用时必须一并说明）

1. 年份口径 = **首次公示在 2026 年**，不是试验启动时间，也不是结果发表年份。
2. 仅干预性研究；观察性研究、回顾性队列未采集。
3. 只覆盖 ClinicalTrials.gov，**不代表全部注册库**。中国药物临床试验登记与信息公示平台、ChiCTR 本轮未采集，
   未命中不能解释为"不存在"。
4. 登记状态 ≠ 入组资格；本包不构成方案推荐，也不预测获益。
5. 篮式研究（`category=basket`，本包命中 0 条）若同时被软组织肉瘤等其它包收录，跨包相加会重复计数。
6. GIST 与 leiomyosarcoma / schwannoma / 神经内分泌肿瘤是**不同病种**，本包不合并。

## 与工作台的关系

工作台的「临床研究」页只读 `trials` 表（`nct_id / title / phase / status / sponsor / url`），
展示"2026 线索 / 已收藏 / 入组问题"三段，**不排序、不匹配、不预测**。
本资料包是数据来源，不是页面内容；页面文案里不出现"适合你"这类判断。
