/* 小吉宝 GistPal · 演示数据生成器（唯一数据源）
   产出：demo/demo-data.sqlite（可 SQL 查询）+ prototypes/v0.2/demo-data.js（原型只读数据层）
   原则：全部患者数据为虚构模拟；试验表为真实登记摘录（状态未核实，以登记页为准）。
   运行：node demo/build-demo-data.mjs  —— 改数据只改这里，两个产物一起重生成。

   两种用法：
   1. 直接跑（CLI）：写上面两个产物；
   2. 被 import：只拿到 `buildDemoProfiles()` 返回的纯数据，一个字节都不碰磁盘
      —— 开发版 `dsh/demo.js` 靠它把演示档案写进本机 sqlite，演示数据仍然只有这一份定义。

   与食管癌生成器的结构差异（改前先看，两边的表不许互相抄）：
   - GIST 不按鳞/腺分型，而按「部位 + 大小 + 核分裂 + 破裂 → 危险度」建档；
     因此没有 segment/swallow/access/dilation，改为 risk_rows / surgery_rows / med_rows /
     dose_rows / adherence_rows / side_effect_rows / imaging_rows / bleed_rows；
   - 用药是长期每日口服：方案、剂量变更、服药记录、不良事件四张表分工；
   - 默认一图秀 = 血红蛋白 + 体重两条数值线 + 乏力分级（分类节点，不连线）。

   列数纪律（H6）：所有 INSERT 一律写显式列名，禁止 `INSERT INTO t VALUES (?,?,…)`。
   写完跑 `node scripts/check-demo-columns.mjs` 复核对齐。 */
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, readFileSync, readdirSync, realpathSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const P2 = join(ROOT, 'prototypes/v0.2');
const SCHEMA_DIR = join(ROOT, 'schema');

/* ---------- 基础数据 ---------- */

const pts = (arr) => arr.map(([d, v, src]) => ({ d, v, src }));

const CAT_COLOR = {
  '血象': '#a03d5c', '生化': '#8a6b1f', '营养': '#6a55b8',
  '用药与症状': '#c2682f', '药物浓度': '#3f6699',
};
const cat = (c) => ({ cat: c, color: CAT_COLOR[c] });

/* 按指标 key 独立配色：同屏最多 4 条，必须靠色相区分，不能只靠类别色 */
const KEY_COLOR = {
  hgb: '#a03d5c', wbc: '#c2687f', anc: '#8f2d4a', plt: '#b3556e',
  alt: '#8a6b1f', ast: '#a8862f', tbil: '#7d5410', cr: '#6d5320', ldh: '#5f441c',
  alb: '#9382d4', wt: '#6a55b8', tsh: '#2f6f66',
  tdm: '#3f6699',
  edema: '#c2682f', diarrhea: '#d4894f', fatigue: '#a85724', nausea: '#e09a5c', hfs: '#b8652c',
};

/* ---------- 公共化验 / 体征 ----------
   A = 胃 GIST 术后高危，辅助伊马替尼（2026-05 起）：术前出血 → 术后恢复 → 长期服药；
   B = 小肠 GIST 复发转移，伊马替尼一线 → 加量 → 舒尼替尼二线：
       2026-06 黑便 → 2026-07 进展 → 2026-08 换药后白细胞/甲状腺变化。
   共用一份数组会让一边的"术前"标签落到另一边的二线期里，所以两边各写一组。 */

const DA = ['2026-04-21', '2026-05-05', '2026-05-19', '2026-06-02', '2026-06-16', '2026-06-30', '2026-07-14',
  '2026-07-28', '2026-08-11', '2026-08-25', '2026-09-08', '2026-09-22', '2026-10-06', '2026-10-15'];
const LA = ['术后复查', '辅助治疗前', '辅助第 2 周', '辅助第 4 周', '辅助第 6 周', '辅助第 8 周', '辅助第 10 周',
  '辅助第 12 周', '血药浓度复查', '辅助第 16 周', '辅助第 18 周', '减量后复查', '辅助第 22 周', '复诊'];
const zipA = (vals) => pts(DA.map((d, i) => [d, vals[i], LA[i]]));

const commonLabsA = () => [
  { key: 'hgb', name: '血红蛋白', unit: 'g/L', dec: 0, band: [115, 150], note: '术前因消化道出血偏低；不同医院参考区间不合并', ...cat('血象'),
    points: zipA([104, 106, 110, 112, 113, 116, 118, 120, 121, 122, 124, 125, 126, 127]) },
  { key: 'wbc', name: '白细胞', unit: '10⁹/L', dec: 1, band: [3.5, 9.5], note: '伊马替尼治疗期可轻度下降', ...cat('血象'),
    points: zipA([6.2, 5.8, 4.6, 4.2, 3.9, 4.0, 3.6, 3.5, 3.7, 3.4, 3.6, 3.8, 3.9, 4.0]) },
  { key: 'anc', name: '中性粒细胞', unit: '10⁹/L', dec: 2, band: [1.8, 6.3], note: '—', ...cat('血象'),
    points: zipA([3.9, 3.5, 2.6, 2.4, 2.2, 2.3, 2.0, 1.9, 2.1, 1.8, 2.0, 2.2, 2.3, 2.4]) },
  { key: 'plt', name: '血小板', unit: '10⁹/L', dec: 0, band: [125, 350], note: '—', ...cat('血象'),
    points: zipA([210, 205, 198, 190, 186, 192, 188, 184, 190, 186, 192, 196, 198, 200]) },
  { key: 'alt', name: 'ALT', unit: 'U/L', dec: 0, band: [9, 50], note: '伊马替尼治疗期定期复查', ...cat('生化'),
    points: zipA([24, 26, 28, 32, 30, 34, 31, 29, 33, 30, 28, 31, 29, 27]) },
  { key: 'ast', name: 'AST', unit: 'U/L', dec: 0, band: [15, 40], note: '—', ...cat('生化'),
    points: zipA([22, 24, 26, 29, 28, 31, 29, 27, 30, 28, 26, 28, 27, 25]) },
  { key: 'tbil', name: '总胆红素', unit: 'μmol/L', dec: 1, band: [3.4, 20.5], note: '—', ...cat('生化'),
    points: zipA([11.2, 11.6, 12.4, 13.0, 12.2, 12.8, 12.0, 11.6, 12.2, 11.8, 11.4, 11.6, 11.2, 11.0]) },
  { key: 'cr', name: '肌酐', unit: 'μmol/L', dec: 0, band: [41, 81], note: '女性参考区间与男性不同，不合并', ...cat('生化'),
    points: zipA([68, 69, 70, 71, 70, 72, 71, 70, 72, 71, 70, 69, 70, 69]) },
  { key: 'ldh', name: 'LDH', unit: 'U/L', dec: 0, band: [120, 250], note: '只作为普通化验记录，不当疗效指标使用', ...cat('生化'),
    points: zipA([236, 228, 214, 206, 198, 192, 186, 180, 178, 182, 176, 174, 172, 170]) },
  { key: 'alb', name: '白蛋白', unit: 'g/L', dec: 1, band: [40, 55], note: '与体重一起看；不同医院参考区间不合并', ...cat('营养'),
    points: zipA([38.6, 39.2, 40.1, 40.6, 41.2, 41.8, 42.2, 42.8, 43.0, 43.4, 43.8, 44.0, 44.2, 44.4]) },
  { key: 'wt', name: '体重', unit: 'kg', dec: 1, band: null, note: '同一台秤、同一时间称更可比；持续下降需在就诊时提出', ...cat('营养'),
    points: zipA([61.8, 61.2, 60.6, 60.2, 60.0, 59.6, 59.4, 59.8, 60.2, 60.4, 60.8, 61.0, 61.2, 61.4]) },
  { key: 'tsh', name: 'TSH', unit: 'mIU/L', dec: 2, band: [0.27, 4.2], note: '长期靶向治疗期按医生安排复查', ...cat('生化'),
    points: zipA([1.8, 1.9, 2.0, 1.9, 2.1, 2.0, 2.2, 2.1, 2.3, 2.2, 2.1, 2.2, 2.3, 2.2]) },
  { key: 'tdm', name: '伊马替尼谷浓度', unit: 'ng/mL', dec: 0, band: null, note: '采样时间、目标区间与是否调量由医生判断；本页只记录数值', ...cat('药物浓度'),
    points: pts([['2026-06-16', 786, '血药浓度报告'], ['2026-08-11', 1104, '血药浓度报告'], ['2026-10-06', 1180, '血药浓度报告']]) },
  { key: 'edema', name: '眼睑 / 下肢水肿', dec: null, kind: 'grade', band: null, note: '按医生记录的分级抄录，不自行评级', ...cat('用药与症状'),
    points: pts([['2026-05-19', '1 级', '用药随访'], ['2026-06-16', '1 级', '用药随访'], ['2026-07-14', '2 级', '门诊记录'],
      ['2026-08-11', '2 级', '门诊记录'], ['2026-09-22', '1 级', '减量后随访'], ['2026-10-15', '1 级', '复诊']]) },
  { key: 'fatigue', name: '乏力', dec: null, kind: 'grade', band: null, note: '按医生记录的分级抄录；自查感受另记在「生活与心理」', ...cat('用药与症状'),
    points: pts([['2026-05-05', '1 级', '用药前'], ['2026-06-02', '1 级', '用药随访'], ['2026-07-14', '2 级', '门诊记录'],
      ['2026-08-25', '2 级', '门诊记录'], ['2026-09-22', '1 级', '减量后随访'], ['2026-10-15', '1 级', '复诊']]) },
  { key: 'diarrhea', name: '腹泻', dec: null, kind: 'grade', band: null, note: '按医生记录的分级抄录', ...cat('用药与症状'),
    points: pts([['2026-05-19', '1 级', '用药随访'], ['2026-06-30', '1 级', '用药随访'], ['2026-08-11', '2 级', '门诊记录'],
      ['2026-09-22', '2 级', '门诊记录'], ['2026-10-15', '1 级', '复诊']]) },
];

const DB = ['2026-04-23', '2026-05-07', '2026-05-21', '2026-06-04', '2026-06-18', '2026-07-02', '2026-07-16',
  '2026-07-30', '2026-08-13', '2026-08-27', '2026-09-10', '2026-09-24', '2026-10-08', '2026-10-16'];
const LB = ['一线第 3 月', '一线第 4 月', '加量前', '加量后 2 周', '黑便后复查', '黑便后 3 周', '进展评估',
  '换药前', '二线第 1 周', '二线第 3 周', '二线第 5 周', '二线第 7 周', '二线第 9 周', '二线第 10 周'];
const zipB = (vals) => pts(DB.map((d, i) => [d, vals[i], LB[i]]));

const commonLabsB = () => [
  { key: 'hgb', name: '血红蛋白', unit: 'g/L', dec: 0, band: [130, 175], note: '2026-06 黑便后明显下降；参考区间按男性', ...cat('血象'),
    points: zipB([128, 126, 124, 118, 108, 104, 109, 112, 110, 106, 104, 108, 110, 112]) },
  { key: 'wbc', name: '白细胞', unit: '10⁹/L', dec: 1, band: [3.5, 9.5], note: '舒尼替尼治疗期下降常见，是否调整由医生判断', ...cat('血象'),
    points: zipB([5.4, 5.2, 5.0, 4.8, 4.6, 4.4, 4.2, 3.6, 3.2, 2.9, 3.0, 3.2, 3.4, 3.5]) },
  { key: 'anc', name: '中性粒细胞', unit: '10⁹/L', dec: 2, band: [1.8, 6.3], note: '—', ...cat('血象'),
    points: zipB([3.4, 3.2, 3.0, 2.8, 2.6, 2.4, 2.2, 1.7, 1.4, 1.2, 1.3, 1.5, 1.6, 1.7]) },
  { key: 'plt', name: '血小板', unit: '10⁹/L', dec: 0, band: [125, 350], note: '—', ...cat('血象'),
    points: zipB([220, 214, 208, 202, 196, 190, 186, 172, 158, 150, 148, 156, 162, 168]) },
  { key: 'alt', name: 'ALT', unit: 'U/L', dec: 0, band: [9, 50], note: '—', ...cat('生化'),
    points: zipB([30, 34, 38, 42, 46, 44, 40, 38, 36, 34, 32, 30, 31, 30]) },
  { key: 'ast', name: 'AST', unit: 'U/L', dec: 0, band: [15, 40], note: '—', ...cat('生化'),
    points: zipB([26, 29, 32, 36, 40, 38, 34, 32, 30, 29, 28, 27, 26, 26]) },
  { key: 'tbil', name: '总胆红素', unit: 'μmol/L', dec: 1, band: [3.4, 20.5], note: '—', ...cat('生化'),
    points: zipB([12.0, 12.6, 13.2, 14.0, 14.8, 14.2, 13.6, 13.0, 12.6, 12.2, 11.8, 11.6, 11.4, 11.2]) },
  { key: 'cr', name: '肌酐', unit: 'μmol/L', dec: 0, band: [57, 111], note: '男性参考区间', ...cat('生化'),
    points: zipB([82, 84, 85, 86, 88, 90, 88, 86, 84, 83, 82, 81, 82, 81]) },
  { key: 'ldh', name: 'LDH', unit: 'U/L', dec: 0, band: [120, 250], note: '只作为普通化验记录，不作为疗效判断指标', ...cat('生化'),
    points: zipB([268, 262, 256, 248, 242, 236, 228, 220, 214, 208, 204, 200, 198, 196]) },
  { key: 'alb', name: '白蛋白', unit: 'g/L', dec: 1, band: [40, 55], note: '与体重一起看', ...cat('营养'),
    points: zipB([37.4, 37.0, 36.6, 36.0, 34.8, 34.2, 34.6, 35.0, 35.4, 35.8, 36.2, 36.6, 36.8, 37.0]) },
  { key: 'wt', name: '体重', unit: 'kg', dec: 1, band: null, note: '二线治疗期体重下降，需在复诊时提出', ...cat('营养'),
    points: zipB([66.2, 65.8, 65.4, 64.8, 63.6, 63.0, 62.6, 62.2, 61.8, 61.4, 61.0, 60.8, 60.6, 60.4]) },
  { key: 'tsh', name: 'TSH', unit: 'mIU/L', dec: 2, band: [0.27, 4.2], note: '舒尼替尼治疗期可升高；是否用药由医生判断', ...cat('生化'),
    points: zipB([1.6, 1.7, 1.8, 2.0, 2.2, 2.4, 2.8, 4.6, 6.2, 7.4, 8.0, 7.2, 6.8, 6.4]) },
  { key: 'tdm', name: '伊马替尼谷浓度', unit: 'ng/mL', dec: 0, band: null, note: '2026-08 已停用伊马替尼；历史数值保留，不与舒尼替尼混算', ...cat('药物浓度'),
    points: pts([['2026-04-23', 620, '血药浓度报告'], ['2026-06-18', 540, '血药浓度报告'], ['2026-07-16', 480, '血药浓度报告']]) },
  { key: 'fatigue', name: '乏力', dec: null, kind: 'grade', band: null, note: '按医生记录的分级抄录', ...cat('用药与症状'),
    points: pts([['2026-05-07', '1 级', '门诊记录'], ['2026-06-18', '2 级', '黑便后'], ['2026-07-16', '2 级', '门诊记录'],
      ['2026-08-27', '2 级', '二线随访'], ['2026-09-24', '3 级', '门诊记录'], ['2026-10-16', '2 级', '复诊']]) },
  { key: 'hfs', name: '手足反应', dec: null, kind: 'grade', band: null, note: '舒尼替尼治疗期记录；按医生分级抄录', ...cat('用药与症状'),
    points: pts([['2026-08-27', '1 级', '二线随访'], ['2026-09-10', '2 级', '门诊记录'], ['2026-09-24', '2 级', '门诊记录'], ['2026-10-16', '2 级', '复诊']]) },
  { key: 'diarrhea', name: '腹泻', dec: null, kind: 'grade', band: null, note: '按医生记录的分级抄录', ...cat('用药与症状'),
    points: pts([['2026-06-18', '1 级', '门诊记录'], ['2026-08-27', '1 级', '二线随访'], ['2026-10-08', '2 级', '门诊记录']]) },
];

/* ---------- 档案 A：胃 GIST，高危，术后辅助伊马替尼 ---------- */

const PROFILE_A = {
  name: '顾文琴',
  sex: '女',
  age: 58,
  meta: '胃体 GIST · 高危 · 术后辅助治疗中',
  headline: '胃体 GIST 6.8 cm，2026-04 行胃楔形切除（R0），5 月起伊马替尼 400 mg 辅助治疗',
  stage: '局限期 · 术后（R0）',
  mindset: '最担心的是"要吃三年药"和每次复查前的等待；已经在记副作用和漏服。',
  dash_keys: ['hgb', 'wt', 'alb', 'fatigue'],
  path: ['胃体 GIST', '高危', '术后辅助 · 伊马替尼'],
  activity: '每天散步 30 分钟；术后 3 个月内避免提重物（医生交代）',
  familyTalk: '想和女儿说清楚：这个病需要长期吃药复查，但不需要她辞职回来照顾。',
  molecular: [
    { k: 'CD117 (c-KIT)', v: '弥漫强阳性（+）', src: '免疫组化报告', state: 'ok', note: 'GIST 常用诊断标志物之一' },
    { k: 'DOG1', v: '阳性（+）', src: '免疫组化报告', state: 'ok', note: '与 CD117 联合判读' },
    { k: 'KIT 基因', v: '外显子 11 c.1676T>A（V559D）', src: '基因检测报告 2026-04-25', state: 'ok', note: '外显子与变异写法照报告原文' },
    { k: 'PDGFRA 基因', v: '外显子 18 未见 D842V', src: '基因检测报告 2026-04-25', state: 'ok', note: '阴性结果同样照原文记录' },
    { k: 'SDHB 表达', v: '保留表达', src: '免疫组化报告', state: 'ok', note: '用于区分 SDH 缺陷型，判读由病理医生给出' },
    { k: 'NGS 扩展检测', v: '未检测', src: '—', state: 'na', note: '未检测不等于阴性；是否补做由医生决定' },
  ],
  lines: [
    { name: '术后辅助治疗', detail: '伊马替尼 400 mg 每日一次；计划 3 年，满 3 年由医生评估是否延长', done: true },
    { name: '复查影像', detail: '腹部增强 MRI / CT，每 3–6 个月；下次 2026-11-10', done: false },
  ],
  cycles: [
    ['术后恢复', '2026-04-08', '胃楔形切除（R0）', '已完成', 1],
    ['辅助治疗第 1–3 月', '2026-05-06', '伊马替尼 400 mg/日', '已完成', 1],
    ['辅助治疗第 4–6 月', '2026-08-06', '伊马替尼 400 mg/日 → 300 mg/日', '进行中', 0],
    ['第 6 月复查', '2026-11-10', '腹部增强 MRI + 血常规肝肾功能', '待安排', 0],
  ],
  rhythm: [
    ['腹部影像（MRI / CT）', '每 3–6 个月', '高危术后前 3 年', '2026-11-10'],
    ['血常规 + 肝肾功能', '每 1–3 个月', '伊马替尼治疗期', '2026-12-08'],
    ['血药浓度（谷浓度）', '医生按需', '非所有中心开展', '待医生安排'],
  ],
  pathology: {
    title: '病理与手术标本',
    status: '已核对',
    rows: [
      ['标本来源', '胃体后壁楔形切除标本'],
      ['肿瘤大小', '6.8 × 5.2 × 4.6 cm'],
      ['核分裂象', '12 个 / 50 HPF'],
      ['组织学类型', '梭形细胞型'],
      ['免疫组化', 'CD117 弥漫强阳性；DOG1 阳性；SDHB 保留表达'],
      ['切缘', 'R0（镜下切缘阴性）'],
      ['肿瘤破裂', '术中未见破裂'],
      ['危险度（中国 GIST 共识 2017 修改版）', '高危'],
    ],
    gaps: [
      ['KIT / PDGFRA 外显子原文', '报告已出，转录待逐字核对'],
      ['术前影像基线', '外院 CT 原件尚未归档'],
    ],
  },
  risk: {
    title: '危险度分级依据',
    rows: [
      ['中国 GIST 共识 2017 修改版', '高危', '胃来源；6.8 cm；核分裂 12/50 HPF；无破裂', '病理报告 + 主治医生记录', '用于辅助治疗时长讨论的依据之一'],
      ['NIH 2008 修改版（Joensuu）', '高危', '肿瘤 >5 cm 且核分裂 >5/50 HPF', '病理报告', '与共识版结论一致，两套体系并存不合并'],
      ['AFIP / Miettinen', '高危', '胃；>5 cm；>10/50 HPF', '病理报告', 'AFIP 按胃 / 非胃分层，数值口径与上两行不同'],
    ],
  },
  pathway: {
    title: '治疗路径',
    rows: [
      ['当前', '术后辅助靶向（伊马替尼）', '2026-05-06 → 计划 3 年', '伊马替尼 400 mg 每日一次；每 3–6 个月腹部影像', '主治医生：按高危给 3 年，满 3 年再评估是否延长'],
      ['既往', '手术（根治性切除）', '2026-04-08', '腹腔镜胃楔形切除，R0，未行淋巴结清扫', '—'],
    ],
  },
  surgery: {
    title: '手术记录',
    rows: [
      ['2026-04-08', '腹腔镜胃楔形切除', '胃体后壁局部楔形切除，未行淋巴结清扫', 'R0', '未见破裂', '市立医院胃肠外科', '术后恢复顺利，第 5 天出院'],
    ],
  },
  meds: {
    title: '当前用药',
    rows: [
      ['伊马替尼', '400 mg（2026-09-22 起 300 mg）', '每日一次，早餐后', '2026-05-06', '', '在用', '医嘱原文记录；不比较品牌与仿制药'],
      ['复方甘草酸苷', '50 mg', '每日三次', '2026-06-02', '2026-07-14', '已停', 'ALT 轻度升高时短期使用，医生开'],
    ],
  },
  dose: {
    title: '剂量变更',
    rows: [
      ['2026-09-22', '伊马替尼', '400 mg', '300 mg', '医生：中度水肿伴腹泻，先减量观察，未停药'],
    ],
  },
  adherence: {
    title: '服药记录',
    rows: [
      ['2026-10-12', '伊马替尼', '300 mg', '300 mg', ''],
      ['2026-10-13', '伊马替尼', '300 mg', '漏服', '早上出门忘带，晚上未补服'],
      ['2026-10-14', '伊马替尼', '300 mg', '300 mg', ''],
      ['2026-10-15', '伊马替尼', '300 mg', '300 mg', ''],
    ],
  },
  sideEffects: {
    title: '副作用记录',
    rows: [
      ['2026-05-19', '眼睑水肿', '1 级', '继续原剂量', '晨起明显，午后减轻'],
      ['2026-06-16', '腹泻', '1 级', '继续原剂量 + 对症', '每日 2–3 次，未影响日常'],
      ['2026-07-14', '乏力', '2 级', '继续原剂量', '午后需休息'],
      ['2026-08-11', '眼睑水肿', '2 级', '继续原剂量', '医生看过，未调整'],
      ['2026-09-22', '腹泻', '2 级', '减量至 300 mg', '医生记录：减量后复查'],
      ['2026-10-06', '乏力', '1 级', '继续 300 mg', ''],
    ],
  },
  imaging: {
    title: '影像与内镜',
    rows: [
      ['2026-04-02', '腹部增强 CT', '胃体后壁肿块 7.0 cm，未见远处转移', '术后复查', '术前基线'],
      ['2026-08-11', '腹部增强 MRI', '术区未见复发征象；肝内未见新发病灶', '2026-11 复查', '医生记录原文'],
      ['2026-10-15', '腹部超声', '术区及肝内未见明显异常', '按计划 2026-11 复查', '门诊复查'],
    ],
  },
  monitor: {
    title: '复查安排',
    rows: [
      ['腹部影像（CT / MRI）', '每 3–6 个月', '2026-08-11', '2026-11-10', '主治医生安排；高危术后前 3 年'],
      ['血常规与肝肾功能', '每 1–3 个月', '2026-10-06', '2026-12-08', '伊马替尼治疗期'],
      ['血药浓度（伊马替尼谷浓度）', '医生按需', '2026-08-11', '待医生安排', '非所有中心开展'],
    ],
  },
  bleeds: {
    title: '出血与急症事件',
    rows: [
      ['2026-04-02', '黑便', '术前一次黑便，急诊查 Hb 92 g/L，输血 2 U 后手术'],
    ],
  },
  nutrition: {
    title: '进食记录',
    rows: [
      ['2026-10-13', '早餐', '半碗粥 + 一个鸡蛋', '粥、鸡蛋', '无', '术后食量比术前小，分 5–6 餐'],
      ['2026-10-14', '午餐', '半碗米饭 + 少量鱼肉', '米饭、清蒸鱼', '餐后腹胀', ''],
      ['2026-10-15', '晚餐', '一小碗面', '汤面', '无', ''],
    ],
  },
  viewpoints: [
    ['2026-06-20', '担心', '每次复查前一周都睡不好，怕看到"复发"两个字。'],
    ['2026-08-15', '疲惫', '每天吃药像提醒自己得过癌症；有时想停一天，又不敢。'],
    ['2026-09-30', '平静', '开始能接受"长期吃药"这件事，把它当成刷牙一样的日常。'],
  ],
  docs: [
    ['d1', '术后病理报告', '2026-04-12', '病理报告', '已入库'],
    ['d2', '基因检测报告（KIT/PDGFRA）', '2026-04-25', '基因检测', '已入库'],
    ['d3', '腹部增强 MRI 报告', '2026-08-11', '影像报告', '已入库'],
    ['d4', '2026-10 血常规 + 肝肾功能', '2026-10-06', '化验单', '待核对'],
  ],
  candidates: [
    ['c1', '核分裂象', '12 个 / 50 HPF', '病理报告 p.2', '已接受'],
    ['c2', '肿瘤大小', '6.8 cm', '病理报告 p.1', '已接受'],
    ['c3', '伊马替尼谷浓度', '1104 ng/mL', '2026-08-11 血药浓度报告', '待确认'],
    ['c4', '下次复查日期', '2026-11-10', '门诊记录', '待确认'],
  ],
  events: [
    ['2026-04-08', '手术 · 胃楔形切除'],
    ['2026-04-21', '术后病理与危险度评估'],
    ['2026-05-06', '开始伊马替尼 400 mg'],
    ['2026-06-16', '第一次血药浓度检测'],
    ['2026-08-11', '复查 MRI'],
    ['2026-09-22', '剂量减至 300 mg'],
    ['2026-10-08', '辅助治疗第 5 个月复诊'],
  ],
  extraMetrics: [],
};

/* ---------- 档案 B：小肠 GIST，复发转移，一线 → 二线 ---------- */

const PROFILE_B = {
  name: '罗建平',
  sex: '男',
  age: 66,
  meta: '小肠 GIST · 复发转移 · 二线治疗中',
  headline: '小肠 GIST 术后 7 个月出现肝转移，伊马替尼加量后仍进展，2026-08 换用舒尼替尼',
  stage: '复发转移（肝）',
  mindset: '最怕半夜肚子疼和黑便；换药后手脚疼，情绪也跟着起伏。',
  dash_keys: ['hgb', 'wt', 'tsh', 'fatigue'],
  path: ['小肠 GIST', '高危', '复发转移 · 舒尼替尼二线'],
  activity: '以室内活动为主；手足反应明显时减少步行',
  familyTalk: '还没跟老伴说换药的事，怕她担心费用。',
  molecular: [
    { k: 'CD117 (c-KIT)', v: '阳性（+）', src: '外院免疫组化', state: 'ok', note: '外院报告原文' },
    { k: 'DOG1', v: '阳性（+）', src: '外院免疫组化', state: 'ok', note: '—' },
    { k: 'KIT 基因', v: '外显子 9 重复（c.1521_1523dup）', src: '外院基因检测 2025-12', state: 'ok', note: '外显子 9 突变与剂量讨论有关，具体由医生判断' },
    { k: 'PDGFRA 基因', v: '野生型', src: '外院基因检测 2025-12', state: 'ok', note: '—' },
    { k: 'SDHB 表达', v: '保留表达', src: '外院免疫组化', state: 'ok', note: '—' },
    { k: 'NGS 扩展检测', v: '未检测', src: '—', state: 'na', note: '进展后是否再活检 / 补做由医生决定' },
  ],
  lines: [
    { name: '晚期一线', detail: '伊马替尼 400 mg → 800 mg；2026-07 影像示肝转移灶增大', done: true },
    { name: '晚期二线', detail: '舒尼替尼 37.5 mg，服 4 周停 2 周；2026-08-06 起', done: true },
    { name: '下一阶段评估', detail: '2026-11 复查 CT 后由医生决定是否继续二线', done: false },
  ],
  cycles: [
    ['小肠段切除', '2025-11-19', '开腹小肠部分切除（R0）', '已完成', 1],
    ['一线伊马替尼', '2026-01-13', '400 mg/日 → 2026-05-20 起 800 mg/日', '已完成', 1],
    ['二线舒尼替尼第 1 周期', '2026-08-06', '37.5 mg/日，服 4 周停 2 周', '已完成', 1],
    ['二线舒尼替尼第 2 周期', '2026-09-17', '37.5 mg/日，服 4 周停 2 周', '进行中', 0],
  ],
  rhythm: [
    ['腹部影像（CT / MRI）', '每 6–8 周', '二线治疗期', '2026-11-19'],
    ['血常规 + 肝肾功能', '每 2–4 周', '舒尼替尼治疗期', '2026-10-30'],
    ['甲状腺功能', '每 3 个月', '舒尼替尼治疗期', '2027-01-15'],
  ],
  pathology: {
    title: '病理与手术标本',
    status: '已核对（外院报告转录）',
    rows: [
      ['标本来源', '外院小肠段切除标本（距回盲部约 40 cm）'],
      ['肿瘤大小', '8.5 × 6.0 × 5.5 cm'],
      ['核分裂象', '9 个 / 50 HPF'],
      ['组织学类型', '梭形细胞型'],
      ['免疫组化', 'CD117 阳性；DOG1 阳性；SDHB 保留表达'],
      ['切缘', 'R0'],
      ['肿瘤破裂', '未见破裂'],
      ['危险度（中国 GIST 共识 2017 修改版）', '高危（非胃来源）'],
    ],
    gaps: [
      ['外院手术记录原件', '仅有出院小结复印件，手术记录未拿到'],
      ['进展后再次活检', '医生暂未安排；是否需要由医生判断'],
    ],
  },
  risk: {
    title: '危险度分级依据',
    rows: [
      ['中国 GIST 共识 2017 修改版', '高危', '非胃来源；8.5 cm；核分裂 9/50 HPF；无破裂', '外院病理报告 + 主治医生记录', '非胃来源的高危阈值低于胃来源'],
      ['NIH 2008 修改版（Joensuu）', '高危', '肿瘤 >5 cm 且核分裂 >5/50 HPF', '外院病理报告', '与共识版结论一致'],
      ['AFIP / Miettinen', '高危', '小肠；>5 cm；>5/50 HPF', '外院病理报告', 'AFIP 对小肠的阈值与胃不同'],
    ],
  },
  pathway: {
    title: '治疗路径',
    rows: [
      ['当前', '晚期二线（舒尼替尼）', '2026-08-06 →', '舒尼替尼 37.5 mg 每日一次，服 4 周停 2 周', '医生原话：伊马替尼加量后仍进展，换二线'],
      ['既往', '晚期一线（伊马替尼）', '2026-01-13 → 2026-08-05', '伊马替尼 400 mg → 2026-05-20 起 800 mg', '2026-07 MRI 示肝转移灶增大；加量后仍进展'],
      ['既往', '手术 + 术后观察', '2025-11-19 → 2026-01', '小肠段切除，R0；当时未行辅助治疗', '外院建议观察，后出现肝转移'],
    ],
  },
  surgery: {
    title: '手术记录',
    rows: [
      ['2025-11-19', '开腹小肠部分切除', '距回盲部约 40 cm 小肠段切除，端端吻合', 'R0', '未见破裂', '外院普外科', '术后病理确诊 GIST；2026-06 出现肝转移'],
    ],
  },
  meds: {
    title: '当前用药',
    rows: [
      ['舒尼替尼', '37.5 mg', '每日一次，服 4 周停 2 周', '2026-08-06', '', '在用', '第 2 周期 2026-09-17 起'],
      ['伊马替尼', '800 mg', '每日一次（400 mg × 2）', '2026-05-20', '2026-08-05', '已停', '加量后仍进展'],
      ['伊马替尼', '400 mg', '每日一次', '2026-01-13', '2026-05-19', '已停', '一线起始剂量'],
      ['左甲状腺素', '25 μg', '每日一次（医生开）', '2026-09-24', '', '在用', 'TSH 升高后医生加用；剂量调整由医生决定'],
    ],
  },
  dose: {
    title: '剂量变更',
    rows: [
      ['2026-05-20', '伊马替尼', '400 mg', '800 mg', '医生：影像示肝转移灶增大，先加量；外显子 9 突变'],
      ['2026-08-06', '伊马替尼', '800 mg', '停用', '医生：加量后仍进展，换舒尼替尼二线'],
      ['2026-08-06', '舒尼替尼', '—', '37.5 mg', '医生：标准 4/2 方案'],
    ],
  },
  adherence: {
    title: '服药记录',
    rows: [
      ['2026-10-13', '舒尼替尼', '37.5 mg', '37.5 mg', ''],
      ['2026-10-14', '舒尼替尼', '37.5 mg', '37.5 mg', ''],
      ['2026-10-15', '舒尼替尼', '37.5 mg', '37.5 mg', ''],
    ],
  },
  sideEffects: {
    title: '副作用记录',
    rows: [
      ['2026-08-27', '乏力', '2 级', '继续原剂量', ''],
      ['2026-09-10', '手足反应', '2 级', '继续原剂量 + 外用护理', '医生记录'],
      ['2026-09-24', '高血压', '1 级', '继续原剂量 + 监测血压', '家庭自测记录'],
      ['2026-10-08', '腹泻', '2 级', '继续原剂量 + 对症', ''],
    ],
  },
  imaging: {
    title: '影像与内镜',
    rows: [
      ['2026-02-10', '腹部增强 CT', '小肠术后改变；肝内未见明确转移灶', '3 个月后复查', '基线'],
      ['2026-06-10', '腹部增强 CT', '肝右叶新发低密度灶 2.1 cm，考虑转移', 'MDT 讨论', '急诊黑便同期'],
      ['2026-07-15', '腹部增强 MRI', '肝右叶病灶增大至 3.0 cm，另见小灶', '调整治疗', '医生记录'],
      ['2026-09-24', '腹部增强 CT', '肝内病灶较前缩小，最大 2.4 cm', '继续当前治疗，6–8 周复查', '医生记录原文'],
    ],
  },
  monitor: {
    title: '复查安排',
    rows: [
      ['腹部影像（CT / MRI）', '每 6–8 周', '2026-09-24', '2026-11-19', '二线治疗期'],
      ['血常规与肝肾功能', '每 2–4 周', '2026-10-16', '2026-10-30', '舒尼替尼治疗期'],
      ['甲状腺功能', '每 3 个月', '2026-10-16', '2027-01-15', '舒尼替尼治疗期'],
      ['血压家庭监测', '每日', '2026-10-15', '每日', '舒尼替尼治疗期'],
    ],
  },
  bleeds: {
    title: '出血与急症事件',
    rows: [
      ['2026-06-10', '黑便 + 头晕', '急诊就诊，Hb 88 g/L，禁食补液；未输血；3 天后好转'],
      ['2026-09-28', '牙龈出血', '刷牙时少量出血，血小板 148×10⁹/L，医生看过'],
    ],
  },
  nutrition: {
    title: '进食记录',
    rows: [
      ['2026-10-14', '早餐', '一小碗粥', '粥、咸菜', '恶心', ''],
      ['2026-10-15', '午餐', '半碗饭 + 青菜', '米饭、青菜', '食欲差', '体重较上月下降 0.6 kg'],
    ],
  },
  viewpoints: [
    ['2026-06-12', '害怕', '黑便那天以为自己要不行了，家里人都吓坏了。'],
    ['2026-08-20', '烦躁', '换药后手脚脱皮，走路疼，心情很差。'],
    ['2026-10-01', '接受', '知道可能要一直换药，先把眼前这个周期过完。'],
  ],
  docs: [
    ['d1', '外院手术记录（复印件）', '2025-11-19', '手术记录', '已入库'],
    ['d2', '外院病理报告', '2025-12-02', '病理报告', '已入库'],
    ['d3', '基因检测报告（KIT 外显子 9）', '2025-12-10', '基因检测', '已入库'],
    ['d4', '2026-07 腹部增强 MRI', '2026-07-15', '影像报告', '待核对'],
  ],
  candidates: [
    ['c1', 'KIT 外显子', '外显子 9 重复', '外院基因检测 p.1', '已接受'],
    ['c2', '肝转移灶最大径', '3.0 cm', '2026-07-15 MRI 报告', '已接受'],
    ['c3', '舒尼替尼起始剂量', '37.5 mg', '2026-08-06 门诊记录', '待确认'],
    ['c4', '下次复查日期', '2026-11-19', '门诊预约单', '待确认'],
  ],
  events: [
    ['2025-11-19', '小肠段切除（外院）'],
    ['2026-01-13', '开始伊马替尼 400 mg'],
    ['2026-05-20', '加量至 800 mg'],
    ['2026-06-10', '黑便急诊'],
    ['2026-07-15', 'MRI 示肝转移灶增大'],
    ['2026-08-06', '换用舒尼替尼'],
    ['2026-09-24', '复查 CT'],
  ],
  extraMetrics: [],
};


/* ---------- 档案 C：胃底 GIST，局部进展，未手术，术前靶向 ----------
   C 是"信息最缺"的那一类：只有穿刺标本，没有切除标本，所以核分裂数与危险度都还定不下来。
   这一套专门用来验证"缺字段时的显示"——危险度写"待定（未切除）"，不是留空、也不是 0。 */

const DC = ['2026-06-18', '2026-07-02', '2026-07-16', '2026-08-13', '2026-08-27', '2026-09-10',
  '2026-09-24', '2026-10-01', '2026-10-13'];
const LC = ['首诊', '治疗前评估', '用药前', '术前第 4 周', '术前第 6 周', '术前第 8 周',
  '术前第 10 周', '加量前复查', '复诊'];
const zipC = (vals) => pts(DC.map((d, i) => [d, vals[i], LC[i]]));

const commonLabsC = () => [
  { key: 'hgb', name: '血红蛋白', unit: 'g/L', dec: 0, band: [115, 150], note: '首诊前黑便后偏低，用药后缓慢回升', ...cat('血象'),
    points: zipC([98, 99, 101, 104, 106, 108, 110, 112, 113]) },
  { key: 'wbc', name: '白细胞', unit: '10⁹/L', dec: 1, band: [3.5, 9.5], note: '伊马替尼治疗期可轻度下降', ...cat('血象'),
    points: zipC([6.8, 6.4, 5.6, 5.0, 4.6, 4.2, 4.0, 4.1, 4.2]) },
  { key: 'anc', name: '中性粒细胞', unit: '10⁹/L', dec: 2, band: [1.8, 6.3], note: '—', ...cat('血象'),
    points: zipC([4.2, 3.9, 3.2, 2.8, 2.5, 2.3, 2.2, 2.3, 2.4]) },
  { key: 'plt', name: '血小板', unit: '10⁹/L', dec: 0, band: [125, 350], note: '—', ...cat('血象'),
    points: zipC([240, 232, 226, 218, 214, 208, 206, 210, 212]) },
  { key: 'alt', name: 'ALT', unit: 'U/L', dec: 0, band: [9, 50], note: '伊马替尼治疗期定期复查', ...cat('生化'),
    points: zipC([22, 24, 27, 29, 28, 26, 25, 24, 23]) },
  { key: 'ast', name: 'AST', unit: 'U/L', dec: 0, band: [15, 40], note: '—', ...cat('生化'),
    points: zipC([20, 22, 24, 26, 25, 24, 23, 22, 21]) },
  { key: 'tbil', name: '总胆红素', unit: 'μmol/L', dec: 1, band: [3.4, 20.5], note: '—', ...cat('生化'),
    points: zipC([10.8, 11.2, 11.6, 12.0, 11.4, 11.0, 10.8, 10.6, 10.4]) },
  { key: 'cr', name: '肌酐', unit: 'μmol/L', dec: 0, band: [41, 81], note: '女性参考区间与男性不同，不合并', ...cat('生化'),
    points: zipC([62, 63, 64, 63, 62, 63, 62, 62, 61]) },
  { key: 'ldh', name: 'LDH', unit: 'U/L', dec: 0, band: [120, 250], note: '只作为普通化验记录，不当疗效指标使用', ...cat('生化'),
    points: zipC([268, 260, 248, 238, 230, 224, 218, 214, 210]) },
  { key: 'alb', name: '白蛋白', unit: 'g/L', dec: 1, band: [40, 55], note: '与体重一起看；不同医院参考区间不合并', ...cat('营养'),
    points: zipC([39.0, 39.4, 39.8, 40.2, 40.6, 41.0, 41.2, 41.4, 41.6]) },
  { key: 'wt', name: '体重', unit: 'kg', dec: 1, band: null, note: '同一台秤、同一时间称更可比', ...cat('营养'),
    points: zipC([55.6, 55.2, 54.8, 54.4, 54.2, 54.0, 54.2, 54.4, 54.6]) },
  { key: 'tsh', name: 'TSH', unit: 'mIU/L', dec: 2, band: [0.27, 4.2], note: '长期靶向治疗期按医生安排复查', ...cat('生化'),
    points: zipC([2.1, 2.0, 2.1, 2.2, 2.1, 2.2, 2.3, 2.2, 2.2]) },
  { key: 'tdm', name: '伊马替尼谷浓度', unit: 'ng/mL', dec: 0, band: null, note: '采样时间、目标区间与是否调量由医生判断；本页只记录数值', ...cat('药物浓度'),
    points: pts([['2026-08-13', 640, '血药浓度报告'], ['2026-10-01', 980, '血药浓度报告']]) },
  { key: 'edema', name: '眼睑 / 下肢水肿', dec: null, kind: 'grade', band: null, note: '按医生记录的分级抄录，不自行评级', ...cat('用药与症状'),
    points: pts([['2026-07-16', '1 级', '用药随访'], ['2026-08-27', '1 级', '门诊记录'], ['2026-10-13', '1 级', '复诊']]) },
  { key: 'fatigue', name: '乏力', dec: null, kind: 'grade', band: null, note: '按医生记录的分级抄录；自查感受另记在「生活与心理」', ...cat('用药与症状'),
    points: pts([['2026-07-02', '1 级', '治疗前'], ['2026-08-13', '1 级', '门诊记录'], ['2026-09-10', '2 级', '门诊记录'], ['2026-10-13', '1 级', '复诊']]) },
  { key: 'diarrhea', name: '腹泻', dec: null, kind: 'grade', band: null, note: '按医生记录的分级抄录', ...cat('用药与症状'),
    points: pts([['2026-07-16', '1 级', '用药随访'], ['2026-09-10', '1 级', '门诊记录']]) },
];

const PROFILE_C = {
  name: '邱惠兰',
  sex: '女',
  age: 49,
  meta: '胃底 GIST · 局部进展 · 术前靶向治疗中',
  headline: '胃底 GIST 8.2 cm，影像评估与胃壁关系密切，2026-07 起伊马替尼术前治疗，计划 2026-12 评估手术',
  stage: '局限期 · 未手术（术前治疗中）',
  mindset: '最想知道"到底还能不能开刀"，也怕一直吃药下去。',
  dash_keys: ['hgb', 'wt', 'alb', 'fatigue'],
  path: ['胃底 GIST', '危险度待定（未切除）', '术前靶向 · 伊马替尼'],
  activity: '正常上班，改为半天；治疗期避免剧烈运动与提重物',
  familyTalk: '还没跟父母细说，只说在吃药观察；想等手术方案定了再讲。',
  molecular: [
    { k: 'CD117 (c-KIT)', v: '弥漫阳性（+）', src: '穿刺标本免疫组化', state: 'ok', note: '穿刺标本即可判读' },
    { k: 'DOG1', v: '阳性（+）', src: '穿刺标本免疫组化', state: 'ok', note: '与 CD117 联合判读' },
    { k: 'KIT 基因', v: '外显子 11 c.1669_1674del（p.W557_V559del）', src: '基因检测报告 2026-07-02', state: 'ok', note: '外显子与变异写法照报告原文' },
    { k: 'PDGFRA 基因', v: '未检出 D842V', src: '基因检测报告 2026-07-02', state: 'ok', note: '阴性结果同样照原文记录' },
    { k: 'SDHB 表达', v: '保留表达', src: '穿刺标本免疫组化', state: 'ok', note: '判读由病理医生给出' },
    { k: 'NGS 扩展检测', v: '待出', src: '基因检测报告 2026-07-02', state: 'pending', note: '待出 ≠ 阴性；结果出来前不据此调整任何记录' },
  ],
  lines: [
    { name: '术前靶向治疗', detail: '伊马替尼 400 mg → 300 mg；计划 9–12 个月，2026-12 评估手术', done: true },
    { name: '手术评估', detail: '由外科与内科共同评估可否切除；工作台不判断', done: false },
  ],
  cycles: [
    ['术前治疗第 1–3 月', '2026-07-16', '伊马替尼 400 mg/日', '已完成', 1],
    ['术前治疗第 4–6 月', '2026-10-13', '伊马替尼 300 mg/日', '进行中', 0],
    ['手术评估', '2026-12-15', '腹部 CT + 外科门诊', '待安排', 0],
  ],
  rhythm: [
    ['腹部影像（CT / 超声内镜）', '每 2–3 个月', '术前治疗期', '2026-12-15'],
    ['血常规 + 肝肾功能', '每 2–4 周', '伊马替尼治疗期', '2026-10-27'],
    ['手术评估（外科门诊）', '医生安排', '由外科与内科共同评估', '2026-12-15'],
  ],
  pathology: {
    title: '病理与穿刺标本',
    status: '已核对（穿刺标本；切除标本待补）',
    rows: [
      ['标本来源', '胃底穿刺活检标本（超声内镜引导）'],
      ['肿瘤大小', '8.2 × 6.4 × 5.9 cm（影像测量，非病理测量）'],
      ['核分裂象', '活检标本计数不可靠，待切除标本评估'],
      ['组织学类型', '梭形细胞型'],
      ['免疫组化', 'CD117 弥漫强阳性；DOG1 阳性；SDHB 保留表达'],
      ['切缘', '不适用（尚未手术）'],
      ['肿瘤破裂', '未发生'],
      ['危险度（中国 GIST 共识 2017 修改版）', '待定（需切除标本的核分裂计数）'],
    ],
    gaps: [
      ['核分裂象（切除标本）', '穿刺标本不足以计数，需切除标本'],
      ['危险度分级结论', '由病理与主治医生在切除标本后给出'],
      ['手术记录', '尚未手术'],
    ],
  },
  risk: {
    title: '危险度分级依据',
    rows: [
      ['中国 GIST 共识 2017 修改版', '待定（未切除）', '需切除标本的核分裂计数；目前只有穿刺标本', '穿刺病理报告 + 主治医生记录', '工作台不代为分级，也不套用影像大小推算'],
      ['AFIP / Miettinen', '待定（未切除）', '需部位 + 大小 + 核分裂；大小来自影像，核分裂待定', '影像报告 + 穿刺病理', '两套体系都等同一个缺失参数，所以都写待定'],
    ],
  },
  pathway: {
    title: '治疗路径',
    rows: [
      ['当前', '术前靶向（伊马替尼）', '2026-07-16 → 计划 9–12 个月', '伊马替尼 400 mg 每日一次（2026-09-08 起 300 mg）；每 2–3 个月影像', '主治医生：先缩小再评估手术，能否切除由外科判断'],
      ['既往', '诊断与评估', '2026-06-18 → 2026-07-15', '增强 CT + 超声内镜 + 穿刺活检 + 基因检测', '外院 CT 与本院超声内镜结论并存，不合并'],
    ],
  },
  meds: {
    title: '当前用药',
    rows: [
      ['伊马替尼', '400 mg（2026-09-08 起 300 mg）', '每日一次，早餐后', '2026-07-16', '', '在用', '医嘱原文记录；不比较品牌与仿制药'],
      ['氯雷他定', '10 mg', '每日一次', '2026-09-08', '2026-09-24', '已停', '皮疹对症，医生开'],
    ],
  },
  dose: {
    title: '剂量变更',
    rows: [
      ['2026-09-08', '伊马替尼', '400 mg', '300 mg', '医生：皮疹 2 级伴腹泻，先减量观察，未停药'],
    ],
  },
  adherence: {
    title: '服药记录',
    rows: [
      ['2026-10-11', '伊马替尼', '300 mg', '300 mg', ''],
      ['2026-10-12', '伊马替尼', '300 mg', '漏服', '出差忘带药，当天未补服'],
      ['2026-10-13', '伊马替尼', '300 mg', '300 mg', ''],
    ],
  },
  sideEffects: {
    title: '副作用记录',
    rows: [
      ['2026-07-30', '皮疹', '1 级', '继续原剂量 + 外用', '面颈部为主'],
      ['2026-08-27', '眼睑水肿', '1 级', '继续原剂量', '晨起明显'],
      ['2026-09-08', '皮疹', '2 级', '减量至 300 mg', '医生记录：减量后复查'],
      ['2026-09-24', '腹泻', '1 级', '继续 300 mg + 对症', '每日 2 次'],
      ['2026-10-08', '乏力', '1 级', '继续 300 mg', ''],
    ],
  },
  imaging: {
    title: '影像与内镜',
    rows: [
      ['2026-06-18', '腹部增强 CT', '胃底肿块 8.2 cm，与胃壁关系密切，未见远处转移', '术前治疗 3 个月后评估', '基线（外院 CT）'],
      ['2026-09-15', '腹部增强 CT', '胃底肿块较前缩小至 7.1 cm，内部密度不均', '继续术前治疗，12 月评估手术', '医生记录原文'],
      ['2026-10-13', '腹部增强 CT', '肿块 6.8 cm，与 9 月相仿', '2026-12 手术评估', '门诊复查'],
    ],
  },
  monitor: {
    title: '复查安排',
    rows: [
      ['腹部影像（CT / 超声内镜）', '每 2–3 个月', '2026-10-13', '2026-12-15', '术前治疗期'],
      ['血常规与肝肾功能', '每 2–4 周', '2026-10-13', '2026-10-27', '伊马替尼治疗期'],
      ['手术评估（外科门诊）', '医生安排', '2026-09-15', '2026-12-15', '由外科与内科共同评估'],
    ],
  },
  bleeds: {
    title: '出血与急症事件',
    rows: [
      ['2026-06-20', '黑便', '首诊前一次黑便，Hb 96 g/L，未输血；此后未再发生'],
    ],
  },
  nutrition: {
    title: '进食记录',
    rows: [
      ['2026-10-12', '早餐', '一小碗粥 + 一个鸡蛋', '粥、鸡蛋', '无', '食量比治疗前少，分 5–6 餐'],
      ['2026-10-13', '午餐', '半碗面', '汤面', '餐后饱胀', ''],
    ],
  },
  viewpoints: [
    ['2026-06-25', '焦虑', '医生说先吃药再决定能不能开刀，我不知道要等多久。'],
    ['2026-08-10', '疲惫', '每天吃药，还要每两周抽血，工作已经请假了。'],
    ['2026-10-05', '平静', '复查说小了一点，至少知道药是有作用的。'],
  ],
  docs: [
    ['d1', '外院腹部增强 CT', '2026-06-18', '影像报告', '已入库'],
    ['d2', '超声内镜报告', '2026-06-19', '内镜报告', '已入库'],
    ['d3', '穿刺病理报告', '2026-06-24', '病理报告', '已入库'],
    ['d4', '基因检测报告（KIT/PDGFRA）', '2026-07-02', '基因检测', '已入库'],
    ['d5', '2026-10 血常规 + 肝肾功能', '2026-10-13', '化验单', '待核对'],
  ],
  candidates: [
    ['c1', '肿瘤最大径', '8.2 cm', '2026-06-18 增强 CT 报告', '已接受'],
    ['c2', 'KIT 外显子', '外显子 11 缺失', '基因检测报告 p.1', '已接受'],
    ['c3', '伊马替尼谷浓度', '980 ng/mL', '2026-10-01 血药浓度报告', '待确认'],
    ['c4', '手术评估时间', '2026-12-15', '外科门诊记录', '待确认'],
  ],
  events: [
    ['2026-06-20', '首诊（黑便后）'],
    ['2026-06-24', '穿刺活检确诊 GIST'],
    ['2026-07-02', '基因检测报告（KIT 外显子 11）'],
    ['2026-07-16', '开始伊马替尼 400 mg 术前治疗'],
    ['2026-09-08', '减量至 300 mg'],
    ['2026-10-13', '术前治疗第 3 个月复查'],
  ],
  extraMetrics: [],
};

/* ---------- 试验演示行 ----------
   来自本地资料包 `research/gist-cancer/`（真实登记摘录，2026 首次公示，共 16 条）。
   标题是登记标题的中文摘要；原文、状态与入组资格以 source_url 为准。
   登记状态不等于入组资格，页面不排序、不标"适合"。 */
const TRIAL_ROWS = [
  ['NCT07585266', '初治转移/不可切除 GIST：Velzatinib 对比伊马替尼（StrateGIST Frontline）', 'Ⅲ期', '招募中', 'GlaxoSmithKline'],
  ['NCT07689201', '伊马替尼、舒尼替尼、瑞戈非尼、匹米替尼后线：Velzatinib 治疗转移/不可切除 GIST', 'Ⅱ期', '招募中', 'GlaxoSmithKline'],
  ['NCT07843641', 'GSK 既往 GIST 研究的长期随访（Legacy Study）', 'Ⅱ期', '尚未招募', 'GlaxoSmithKline'],
  ['NCT07379047', '晚期 GIST：NB003 的疗效与安全性研究', 'Ⅱ/Ⅲ期', '招募中', 'Ningbo Newbay Technology Development'],
  ['NCT07434843', 'SDH 缺陷型 GIST：Pemigatinib Ⅱ 期研究', 'Ⅱ期', '招募中', 'Dana-Farber Cancer Institute'],
  ['NCT07406633', '晚期/转移 GIST 一线：KQB198 联合伊马替尼（SynerGIST-1st Line）', 'Ⅱ期', '招募中', 'Kumquat Biosciences'],
  ['NCT07559864', 'KIT 外显子 17 突变耐药 GIST：瑞戈非尼联合恩沃利单抗对比医生选择', 'Ⅱ期', '招募中', 'Jian Li（研究者发起）'],
  ['NCT07618377', '≥3 线治疗后 GIST：DCC-2618（瑞普替尼）Ⅰ 期研究', 'Ⅰ期', '招募中', 'Ono Pharmaceutical'],
  ['NCT07457775', '晚期软组织肉瘤（含 GIST）：脂质体伊立替康 + 替莫唑胺 + 贝伐珠单抗', 'Ⅱ期', '尚未招募', '浙江大学医学院附属第二医院'],
  ['NCT07647068', '局部晚期/复发/转移 GIST：自体 TIL 联合白细胞介素-2', 'Ⅱ期', '尚未招募', 'Joal Beane（研究者发起）'],
  ['NCT07507773', '肢体/躯干壁软组织肉瘤：中等分割新辅助放疗长期疗效', 'Ⅱ期', '招募中', 'Centre Oscar Lambret'],
  ['NCT07673861', 'ctDNA 检测耐药机制并指导精准治疗（含 GIST）', 'NA（未分期）', '招募中', 'Royal Marsden NHS Foundation Trust'],
  ['NCT07411118', 'GIST 内镜切除：EFTR 对比 STER 的随机对照研究', 'NA（未分期）', '招募中', 'Chinese University of Hong Kong'],
  ['NCT07581977', 'GIST 的 ESD/EFTR：新型双齿夹辅助闭合', 'NA（未分期）', '招募中', '军事医学科学院附属医院'],
  ['NCT07405125', '特殊解剖部位 GIST：机器人手术安全性研究', 'NA（未分期）', '招募中', '南京医科大学第一附属医院'],
  ['NCT07550582', '食管胃结合部黏膜下肿瘤：肠系膜血管预处理联合双镜手术', 'Ⅱ期', '邀请入组', '北京大学人民医院'],
].map(([id, title, phase, status, sponsor]) => ({ id, title, phase, status, sponsor, url: 'https://clinicaltrials.gov/study/' + id }));

/* ---------- 组装 ---------- */

function assemble(P, commonLabs) {
  /* band 必须显式写 null：分类指标没有区间，读模型按 === null 判定 */
  const metrics = [...P.extraMetrics, ...commonLabs()].map((m) => ({ ...m, color: KEY_COLOR[m.key] || m.color, band: m.band ?? null }));
  /* extraMetrics 是组装中间量，不能漏进产物（多一个键 parity 就红） */
  const { extraMetrics, ...rest } = P;
  return { ...rest, metrics };
}

const DATA = {
  profiles: {
    A: assemble(PROFILE_A, commonLabsA),
    B: assemble(PROFILE_B, commonLabsB),
    C: assemble(PROFILE_C, commonLabsC),
  },
  trials: TRIAL_ROWS,
};

/* ---------- 纯数据出口（不碰磁盘） ---------- */

export function buildDemoProfiles() {
  return { profiles: DATA.profiles, trials: DATA.trials, meta: buildMeta() };
}

function buildMeta() {
  return [
    ['disclaimer', '全部患者数据为虚构模拟，仅供原型演示；trials 表为真实登记摘录，登记状态未核实'],
    ['generated_at', new Date().toISOString()],
    ['source', 'demo/build-demo-data.mjs（唯一数据源）'],
    ['subjects', '3'],
    ['window', '2026-04-20..2026-10-18'],
    ['window_label', '演示数据覆盖 2026-04-20 → 2026-10-18（约 6 个月）'],
    ['views', '11'],
    ['metrics_rows', String(Object.values(DATA.profiles).reduce((a, p) => a + p.metrics.length, 0))],
    ['points_rows', String(Object.values(DATA.profiles).reduce((a, p) => a + p.metrics.reduce((b, m) => b + m.points.length, 0), 0))],
  ];
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

/* ---------- 产 1：SQLite ---------- */

function writeSqlite() {
  const file = join(ROOT, 'demo/demo-data.sqlite');
  /* 每次重建：旧库里的表结构可能来自上一版 schema，先删掉再按 schema/ 全量建 */
  try { unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const db = new DatabaseSync(file);
  /* 直接执行全部迁移：表结构只有 schema/ 一份来源，不会出现
     "生成器建表列不一致" 这种只能靠比对才发现的问题。 */
  for (const f of readdirSync(SCHEMA_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(SCHEMA_DIR, f), 'utf8'));
  }

  const insSubject = db.prepare(`INSERT INTO subjects
    (profile_key, name, sex, age, meta, headline, stage, mindset, dash_keys, path,
     activity, family_talk, pathology_title, pathology_status, molecular_title, risk_title,
     pathway_title, surgery_title, meds_title, side_title, adherence_title,
     imaging_title, monitor_title, bleed_title, nutrition_title)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insMetric = db.prepare(`INSERT INTO metrics (profile_key, key, name, unit, cat, color, dec, kind, band_low, band_high, note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insPoint = db.prepare('INSERT INTO metric_points (profile_key, metric_key, d, v_num, v_text, src, ord) VALUES (?,?,?,?,?,?,?)');
  const insMolecular = db.prepare('INSERT INTO molecular (profile_key, k, v, src, state, note, ord) VALUES (?,?,?,?,?,?,?)');
  const insEvent = db.prepare('INSERT INTO events (profile_key, d, label) VALUES (?,?,?)');
  const insRhythm = db.prepare('INSERT INTO rhythm (profile_key, item, freq, guideline, next, ord) VALUES (?,?,?,?,?,?)');
  const insCycle = db.prepare('INSERT INTO cycles (profile_key, name, date, drugs, status, done, ord) VALUES (?,?,?,?,?,?,?)');
  const insLine = db.prepare('INSERT INTO treatment_lines (profile_key, name, detail, done, ord) VALUES (?,?,?,?,?)');
  const insPathway = db.prepare('INSERT INTO pathway_rows (profile_key, phase, name, window, detail, note, ord) VALUES (?,?,?,?,?,?,?)');
  const insRisk = db.prepare('INSERT INTO risk_rows (profile_key, system, grade, basis, source, note, ord) VALUES (?,?,?,?,?,?,?)');
  const insSurgery = db.prepare('INSERT INTO surgery_rows (profile_key, d, kind, resection, margin, rupture, institution, note, ord) VALUES (?,?,?,?,?,?,?,?,?)');
  const insMed = db.prepare('INSERT INTO med_rows (profile_key, name, dose, schedule, start, end, status, note, ord) VALUES (?,?,?,?,?,?,?,?,?)');
  const insDose = db.prepare('INSERT INTO dose_rows (profile_key, d, drug, from_dose, to_dose, reason, ord) VALUES (?,?,?,?,?,?,?)');
  const insAdherence = db.prepare('INSERT INTO adherence_rows (profile_key, d, drug, planned, taken, note, ord) VALUES (?,?,?,?,?,?,?)');
  const insSide = db.prepare('INSERT INTO side_effect_rows (profile_key, d, term, grade, action, note, ord) VALUES (?,?,?,?,?,?,?)');
  const insImaging = db.prepare('INSERT INTO imaging_rows (profile_key, d, kind, site, finding, next, note, ord) VALUES (?,?,?,?,?,?,?,?)');
  const insMonitor = db.prepare('INSERT INTO monitor_rows (profile_key, item, freq, last, next, note, ord) VALUES (?,?,?,?,?,?,?)');
  const insBleed = db.prepare('INSERT INTO bleed_rows (profile_key, d, kind, detail, ord) VALUES (?,?,?,?,?)');
  const insNutrition = db.prepare('INSERT INTO nutrition_rows (profile_key, d, slot, amount, foods, symptoms, note, ord) VALUES (?,?,?,?,?,?,?,?)');
  const insView = db.prepare('INSERT INTO viewpoints (profile_key, d, mood, text, ord) VALUES (?,?,?,?,?)');
  const insTrial = db.prepare('INSERT OR IGNORE INTO trials (nct_id, title, phase, status, sponsor, url) VALUES (?,?,?,?,?,?)');
  const insDoc = db.prepare('INSERT INTO documents (profile_key, id, name, date, type, status, ord) VALUES (?,?,?,?,?,?,?)');
  const insCand = db.prepare('INSERT INTO candidate_fields (profile_key, id, name, value, source, status, ord) VALUES (?,?,?,?,?,?,?)');
  const insPath = db.prepare('INSERT INTO pathology_rows (profile_key, kind, a, b, ord) VALUES (?,?,?,?,?)');
  const insMeta = db.prepare('INSERT OR IGNORE INTO demo_meta (k, v) VALUES (?,?)');

  const j = (v) => (v === undefined ? null : JSON.stringify(v));
  const flag = (v) => (v ? 1 : 0);

  db.exec('BEGIN');
  try {
    for (const [key, p] of Object.entries(DATA.profiles)) {
      insSubject.run(key, p.name, p.sex, p.age, p.meta, p.headline, p.stage, p.mindset,
        j(p.dash_keys), j(p.path), p.activity ?? null, p.familyTalk ?? null,
        p.pathology ? p.pathology.title : null, p.pathology ? p.pathology.status : null,
        '分子与免疫组化', p.risk ? p.risk.title : null,
        p.pathway ? p.pathway.title : null, p.surgery ? p.surgery.title : null,
        p.meds ? p.meds.title : null, p.sideEffects ? p.sideEffects.title : null,
        p.adherence ? p.adherence.title : null, p.imaging ? p.imaging.title : null,
        p.monitor ? p.monitor.title : null, p.bleeds ? p.bleeds.title : null,
        p.nutrition ? p.nutrition.title : null);

      for (const m of p.metrics) {
        insMetric.run(key, m.key, m.name, m.unit ?? null, m.cat ?? null, m.color ?? null,
          m.dec ?? null, m.dec === null ? (m.kind || 'qual') : 'numeric',
          m.band ? m.band[0] : null, m.band ? m.band[1] : null, m.note ?? null);
        for (const [pi, pt] of (m.points || []).entries()) {
          const num = typeof pt.v === 'number' ? pt.v : null;
          const txt = typeof pt.v === 'number' ? null : (pt.v === undefined ? null : String(pt.v));
          insPoint.run(key, m.key, pt.d, num, txt, pt.src ?? null, pi);
        }
      }

      (p.molecular || []).forEach((r, i) => insMolecular.run(key, r.k, r.v, r.src, r.state, r.note ?? null, i));
      (p.events || []).forEach((e) => insEvent.run(key, e[0], e[1]));
      (p.rhythm || []).forEach((r, i) => insRhythm.run(key, r[0], r[1], r[2], r[3], i));
      (p.cycles || []).forEach((c, i) => insCycle.run(key, c[0], c[1], c[2], c[3], flag(c[4]), i));
      (p.lines || []).forEach((l, i) => insLine.run(key, l.name, l.detail, flag(l.done), i));
      if (p.pathway) p.pathway.rows.forEach((r, i) => insPathway.run(key, r[0], r[1], r[2], r[3], r[4], i));
      if (p.risk) p.risk.rows.forEach((r, i) => insRisk.run(key, r[0], r[1], r[2], r[3], r[4], i));
      if (p.surgery) p.surgery.rows.forEach((r, i) => insSurgery.run(key, r[0], r[1], r[2], r[3], r[4], r[5], r[6], i));
      if (p.meds) p.meds.rows.forEach((r, i) => insMed.run(key, r[0], r[1], r[2], r[3], r[4] ?? null, r[5], r[6] ?? null, i));
      if (p.dose) p.dose.rows.forEach((r, i) => insDose.run(key, r[0], r[1], r[2], r[3], r[4], i));
      if (p.adherence) p.adherence.rows.forEach((r, i) => insAdherence.run(key, r[0], r[1], r[2], r[3], r[4] ?? null, i));
      if (p.sideEffects) p.sideEffects.rows.forEach((r, i) => insSide.run(key, r[0], r[1], r[2], r[3], r[4] ?? null, i));
      if (p.imaging) p.imaging.rows.forEach((r, i) => insImaging.run(key, r[0], r[1], r[2], r[3], r[4] ?? null, r[5] ?? null, i));
      if (p.monitor) p.monitor.rows.forEach((r, i) => insMonitor.run(key, r[0], r[1], r[2] ?? null, r[3], r[4], i));
      if (p.bleeds) p.bleeds.rows.forEach((r, i) => insBleed.run(key, r[0], r[1], r[2], i));
      if (p.nutrition) p.nutrition.rows.forEach((r, i) => insNutrition.run(key, r[0], r[1], r[2], r[3], r[4], r[5], i));
      (p.viewpoints || []).forEach((v, i) => insView.run(key, v[0], v[1], v[2], i));
      (p.docs || []).forEach((d, i) => insDoc.run(key, d[0], d[1], d[2], d[3], d[4], i));
      (p.candidates || []).forEach((c, i) => insCand.run(key, c[0], c[1], c[2], c[3], c[4], i));
      if (p.pathology) {
        (p.pathology.rows || []).forEach((r, i) => insPath.run(key, 'row', r[0], r[1], i));
        (p.pathology.gaps || []).forEach((r, i) => insPath.run(key, 'gap', r[0], r[1], i));
      }
    }
    for (const t of DATA.trials) insTrial.run(t.id, t.title, t.phase, t.status, t.sponsor, t.url);
    for (const [k, v] of buildMeta()) insMeta.run(k, v);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* 回滚失败也把原错误抛出去 */ }
    throw new Error(`写 demo-data.sqlite 失败（已回滚）：${error.message}`);
  } finally {
    db.close();
  }
}

/* ---------- 产 2：原型数据文件 ---------- */

function writeDemoJs() {
  const payload = buildDemoProfiles();
  const body = `/* 自动生成，请勿手改；改数据去 demo/build-demo-data.mjs 重跑。 */
window.DEMO_DATA = ${JSON.stringify({ profiles: payload.profiles, trials: payload.trials, meta: Object.fromEntries(payload.meta) }, null, 2)};
`;
  writeFileSync(join(P2, 'demo-data.js'), body);
}

/* ---------- 入口 ---------- */

if (isDirectRun()) {
  writeSqlite();
  writeDemoJs();
  const total = Object.values(DATA.profiles).reduce((a, p) => a + p.metrics.reduce((b, m) => b + m.points.length, 0), 0);
  console.log(`✓ demo/demo-data.sqlite + prototypes/v0.2/demo-data.js（3 套档案 · ${Object.values(DATA.profiles).reduce((a, p) => a + p.metrics.length, 0)} 项指标 · ${total} 个数据点 · ${DATA.trials.length} 条登记摘录）`);
}
