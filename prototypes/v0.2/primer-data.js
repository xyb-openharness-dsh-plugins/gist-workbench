/* 小吉宝 GistPal · 疾病概要数据（36 号）
 * 口径：docs/DISEASE-PRIMER.md；规范：starter docs/36-DISEASE-PRIMER.md。
 * 全部内容属第 ② 层（解释）：只写定义、文件、指南列举过的手段、已发生的变化。
 * 任何「你该怎么办」的判断都不在这里，固定出口是「这一句需要问你的医生」。
 *
 * 本癌种有两处必须分开写：
 *   ① 分期（TNM）与危险度分级（改良 NIH / AFIP-Miettinen / 中国共识 2017）不是一套东西；
 *   ② 危险度只记录医生给的原文与体系，不重算、不取最高、不换算。
 * 原件状态：NCCN / CSCO / WHO / 中国共识均未取得原件，页码「页码待核」；
 *   按 36 号 §2.5，未取得原件的每一行都给 `secondaryUrl`（2026-10-27 逐条用真浏览器验活）。
 */
const L = {
  /* NCCN 官网指南详情页（GIST，v1.2026；全文需 NCCN 账号） */
  nccn: 'https://www.nccn.org/guidelines/guidelines-detail?category=1&id=1507',
  /* CSCO 2025 版出版方书目页（人卫智慧服务商城；全文需购买） */
  csco: 'https://www.pmphmall.com/gdsdetail/656257-335855',
  /* 中国 GIST 共识 2017 的英文版（Chin J Cancer Res 2017;29(4):281-293）DOI */
  consensus: 'https://doi.org/10.21147/j.issn.1000-9604.2017.04.01',
  /* WHO 分类第 5 版第 1 卷「消化系统肿瘤」IARC 出版方页（全本需购买） */
  who: 'https://publications.iarc.who.int/Book-And-Report-Series/Who-Classification-Of-Tumours/Digestive-System-Tumours-2019',
  /* ClinicalTrials.gov 检索页：条件 = GIST，仅干预性研究（与自采口径一致） */
  ctgov: 'https://clinicaltrials.gov/search?cond=Gastrointestinal%20Stromal%20Tumor&aggFilters=studyType:int'
}

const NOTE = {
  nccn: '官网指南详情页；全文需 NCCN 账号',
  csco: '人卫社出版方书目页；全文需购买',
  consensus: '英文版 Chin J Cancer Res 2017;29(4):281-293；中文原版未取得',
  who: 'IARC 出版方页；全本需购买',
  ctgov: '自采快照；第三方原件未存档；ChinaDrugTrials 与 ChiCTR 未采集'
}

window.DISEASE_PRIMER = {
  brand: '小吉宝 GistPal',
  name: '胃肠间质瘤',
  en: 'Gastrointestinal Stromal Tumor（GIST）',
  updated: '2026-10-27',
  sections: [
    {
      id: 'definition',
      title: '定义',
      intro: '胃肠间质瘤（GIST）是起源于消化道间叶组织、通常与 Cajal 间质细胞相关的肿瘤，'
        + '与上皮来源的「癌」不属于同一类。因此本台不用 TNM 作默认结构，而把「病理四事实 + 危险度」放在最前面。',
      points: [
        '最常见部位为胃（50–70%），其次小肠（20–30%）；结直肠、食管、网膜少见。部位必须单列，因为不同危险度体系按部位给不同阈值。',
        '分子主轴：KIT 突变约 70–80%（exon 11 最常见，exon 9 约 10–15%）、PDGFRA 约 5–8%、野生型约 10–15%（SDH 缺陷、NF1、BRAF、NTRK 等）。外显子编号照报告原文抄，本台不推断。',
        '危险度分级与分期是两套东西：GIST 常用改良 NIH（Fletcher）与 AFIP-Miettinen 等危险度体系，按肿瘤大小 + 核分裂数（AFIP 另加部位）分级；本台不把危险度当 TNM，也不在两套体系之间换算、不取最高。',
        '肿瘤破裂（术前自发或术中）独立于危险度体系记录，不与任何一级混写。',
        '转移以肝转移与腹膜播散为主，淋巴结转移少；本台不设「淋巴结分期」结构。',
        'GIST 没有公认的血清肿瘤标志物；CEA / CA19-9 / SCC 不进默认指标集，LDH 只作普通化验记录。' // wording-allow: 否定表述——「不进默认指标集」是排除这些标志物，不是上一癌种残留
      ],
      sources: [
        { org: 'NCCN', doc: 'NCCN Guidelines · Gastrointestinal Stromal Tumors（GIST）', version: 'v1.2026（2026-01-13 更新）', original: false, secondaryUrl: L.nccn, note: NOTE.nccn, page: '页码待核' },
        { org: 'CSCO', doc: 'CSCO 胃肠间质瘤诊疗指南', version: '2025 版', original: false, secondaryUrl: L.csco, note: NOTE.csco, page: '页码待核' },
        { org: '中国 GIST 共识', doc: '中国胃肠间质瘤诊断治疗共识（2017 修改版）', version: '2017', original: false, secondaryUrl: L.consensus, note: NOTE.consensus, page: '页码待核' }
      ]
    },
    {
      id: 'evidence',
      title: '医学资料规范和指南情况',
      intro: '这台工作台里出现的每一条「该记什么、按什么粒度记」，都应能追到下面某一份文件。'
        + '本项目对这几份文件都没有取得原件——表格里照实写，不假装看过；每一行都给出可点开的出版方页或二次来源。',
      table: {
        head: ['机构', '文件', '版本 / 年份', '原件', '本台的用途'],
        rows: [
          ['NCCN', 'NCCN Guidelines · Gastrointestinal Stromal Tumors（GIST）', 'v1.2026（2026-01-13 更新）', { text: '未取得原件，据二次来源', url: L.nccn }, '危险度多体系、线序与复查节奏的并列引用'],
          ['CSCO', 'CSCO 胃肠间质瘤诊疗指南', '2025 版', { text: '未取得原件，据二次来源', url: L.csco }, '国内推荐分级与野生型四分；具体条文未逐条落文档，不作引用依据'],
          ['中国 GIST 共识', '中国胃肠间质瘤诊断治疗共识（2017 修改版）', '2017', { text: '未取得原件，据二次来源', url: L.consensus }, '国内常用危险度分级；阈值与 AFIP 接近但不完全一致'],
          ['WHO', 'Classification of Tumours: Digestive System Tumours', '版本未核实', { text: '未取得原件，据二次来源', url: L.who }, '病理类型命名的口径']
        ]
      },
      points: [
        '指南给的是「通常怎么做」，不是「你该怎么做」。版本号必须写清：同一份指南隔一年，条目会变。',
        '危险度至少两套体系并列，每套标「体系 / 分级原文 / 依据参数 / 来源」；不合并、不取最高、不替医生选体系。',
        'CSCO 2025 的具体推荐级别条文未逐条落文档，本台不把指南条文写成工作台口径。',
        '本台对未取得原件的文件只记「存在」与「大致讲什么」，不引用其具体条文，页码一律写待核。'
      ],
      sources: [
        { org: 'NCCN', doc: 'NCCN Guidelines · Gastrointestinal Stromal Tumors（GIST）', version: 'v1.2026', original: false, secondaryUrl: L.nccn, note: NOTE.nccn, page: '页码待核' },
        { org: 'CSCO', doc: 'CSCO 胃肠间质瘤诊疗指南', version: '2025 版', original: false, secondaryUrl: L.csco, note: NOTE.csco, page: '页码待核' },
        { org: '中国 GIST 共识', doc: '中国胃肠间质瘤诊断治疗共识（2017 修改版）', version: '2017', original: false, secondaryUrl: L.consensus, note: NOTE.consensus, page: '页码待核' },
        { org: 'WHO', doc: 'Classification of Tumours: Digestive System Tumours', version: '版本未核实', original: false, secondaryUrl: L.who, note: NOTE.who, page: '页码待核' }
      ]
    },
    {
      id: 'landscape',
      title: '目前治疗全景概要',
      intro: '下面按期别与线序列出指南里出现过的手段类别。这是「世界上大致有哪些办法」的地图，不是给你排的先后顺序，'
        + '也不含任何剂量、疗程与适用条件——那些必须由医生按你的病理、分子结果与影像决定。',
      groups: [
        {
          label: '局限期（可以完整切除时）',
          points: [
            '手术：完整切除（R0）是被列出的目标，同时避免肿瘤破裂；一般不常规清扫淋巴结。',
            '术前靶向治疗：部分局部进展、需要缩小体积的情形先做 TKI，本台按「术前 / 术后」阶段分开记录。',
            '内镜切除：EFTR / ESD 等术式出现在在研登记里，适用条件按内镜与病理评估决定。'
          ]
        },
        {
          label: '术后辅助',
          points: [
            '靶向治疗（TKI）：高危常规 3 年；极高危（含破裂、非胃来源高核分裂等情形）可考虑延至 5–6 年。是否延长、用多大剂量属于医生判断。',
            '复查：高危切除后前 2–3 年每 3–4 个月腹盆增强 CT，第 4–5 年每 6 个月，之后每年至 10 年；本台只记医生给的间隔与实际日期。'
          ]
        },
        {
          label: '晚期 / 转移后（线序）',
          points: [
            '一线：伊马替尼。',
            '二线：舒尼替尼。三线：瑞戈非尼。四线：瑞普替尼。',
            '特殊分子亚型单列：PDGFRA D842V 对应阿伐替尼；SDH 缺陷型对应舒尼替尼 / 瑞戈非尼等。本台只并列记录，不比较优劣。',
            '临床研究：指南把「参加登记良好的临床试验」列为一项正式选项，而不是最后手段。'
          ]
        },
        {
          label: '贯穿全程的两件事',
          points: [
            '靶向用药记录：剂量变更每次一行，含「从多少到多少 + 医生原话理由」；漏服按天记事实，不计算依从率百分比。',
            '副作用与复查：副作用按 CTCAE 原文分级照抄；晚期用药中每 2–3 个月影像评估，影像结论抄原文，不做疗效评价。'
          ]
        }
      ],
      points: [
        '以上是文献与指南里列出的手段，按病期与线序排列，不代表任何一项适合你。选哪一个，这一句需要问你的医生。'
      ],
      sources: [
        { org: 'NCCN', doc: 'NCCN Guidelines · Gastrointestinal Stromal Tumors（GIST）', version: 'v1.2026', original: false, secondaryUrl: L.nccn, note: NOTE.nccn, page: '页码待核' },
        { org: 'CSCO', doc: 'CSCO 胃肠间质瘤诊疗指南', version: '2025 版', original: false, secondaryUrl: L.csco, note: NOTE.csco, page: '页码待核' }
      ]
    },
    {
      id: 'trend',
      title: '发展趋势',
      intro: '这一段只写已经发生的事：哪份文件换了版本、哪一天更新、登记平台上多了多少条。'
        + '不写预测，不做评价，也不给任何倾向。登记数量随检索日期变化，检索口径记录在 docs/CLINICAL-DATA-2026.md。',
      points: [
        '2026-01-13：NCCN GIST 指南更新为 v1.2026（本项目据该版本的更新日期记录）。',
        '2025 年：CSCO 胃肠间质瘤诊疗指南 2025 版出版；与本台字段相关的两条已记录的变化是「辅助治疗 6 年推荐级别上调」与「野生型 GIST 按 SDH / NF1 / BRAF / NTRK 四分」。',
        '2017 年：中国胃肠间质瘤诊断治疗共识 2017 修改版发布，国内报告常用其危险度分级；阈值与 AFIP-Miettinen 接近但不完全一致。',
        '截至 2026-10：本项目资料包收录 2026 年首次公示的 GIST 干预性试验 16 条，状态分布为 RECRUITING 12 / NOT_YET_RECRUITING 3 / ENROLLING_BY_INVITATION 1，含中国中心 8 条；ChinaDrugTrials 与 ChiCTR 未采集，中国登记总量未知。'
      ],
      sources: [
        { org: 'NCCN', doc: 'NCCN Guidelines · Gastrointestinal Stromal Tumors（GIST）', version: 'v1.2026（2026-01-13 更新）', original: false, secondaryUrl: L.nccn, note: NOTE.nccn, page: '页码待核' },
        { org: 'CSCO', doc: 'CSCO 胃肠间质瘤诊疗指南', version: '2025 版', original: false, secondaryUrl: L.csco, note: NOTE.csco, page: '页码待核' },
        { org: '中国 GIST 共识', doc: '中国胃肠间质瘤诊断治疗共识（2017 修改版）', version: '2017', original: false, secondaryUrl: L.consensus, note: NOTE.consensus, page: '页码待核' },
        { org: 'ClinicalTrials.gov', doc: '2026 年 GIST 干预性研究登记资料包（research/gist-cancer/）', version: '检索日 2026-10（首次公示 2026 年起）', original: true, url: L.ctgov, note: NOTE.ctgov }
      ]
    }
  ]
}
