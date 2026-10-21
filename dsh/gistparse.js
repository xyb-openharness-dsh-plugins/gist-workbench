/* GIST 报告的候选字段抽取：只抄写，不判断。
 *
 * 输入是 MinerU 换回来的 markdown，输出是 `candidate_fields` 的行。
 * 三条规矩（与 docs/18-MINERU-PARSING.md 第 4–5 节一致）：
 *
 * 1. **只抄原文**：值一定是报告里出现过的片段；抽不到就不产候选，
 *    不"按常识补一个"。没有「疑似」「可能」这类词——那是判断，不是抄写。
 * 2. **整行放弃优于错配**：云端会把整张表塞进一个单元格，
 *    这时按位置对齐（第 i 个指标配第 i 个值）；指标数与数值数对不上就整行丢掉。
 *    宁可漏一条让用户手填，也不能把 8 个指标写成同一个数。
 * 3. **不等式原样保留**：`<0.5` 存文本、不折成 0.5——折了就是替用户下结论。
 *
 * 为什么 GIST 要单独一套词表：核心事实是「部位 + 大小 + 核分裂 + 破裂 → 危险度」，
 * 外加 CD117 / DOG1 / KIT / PDGFRA / SDHB 五个分子事实。通用化验单抽取器认不出这些，
 * 而它们恰好是这张工作台最要紧的字段。
 */

/** 病理字段：名称 → 正则。捕获组 1 是值。全部只认"报告里明写"的写法。 */
const PATHOLOGY_RULES = [
  ['核分裂象', /核分裂(?:象|计数)?[^\d\n]{0,8}(\d+\s*(?:个)?\s*\/\s*(?:50\s*)?HPF)/i],
  ['肿瘤大小', /(?:肿瘤)?(?:最大)?(?:径|大小|直径)[^\d\n]{0,8}(\d+(?:\.\d+)?\s*(?:cm|mm|厘米|毫米))/i],
  // 部位的值后面常紧跟别的项目，截到下一个字段名再落库；上限 12 字，避免把整行吞进来
  ['肿瘤部位', /(?:发生)?部位[：:\s]*([^\n|]{2,24})/],
  ['切缘', /切缘[^\n|]{0,12}?(R0|R1|R2)/i],
  ['肿瘤破裂', /(?:肿瘤)?破裂[：:\s]*(有|无|是|否|未见)/],
  ['危险度', /(?:危险度|复发风险|风险分级)[^\n|]{0,16}?(极低危|低危|中危|高危)/],
  ['CD117', /CD117[^\n|]{0,12}?(阳性|阴性|[(（]\s*\+\s*[)）]|[(（]\s*-\s*[)）])/i],
  ['DOG1', /DOG\s*-?\s*1[^\n|]{0,12}?(阳性|阴性|[(（]\s*\+\s*[)）]|[(（]\s*-\s*[)）])/i],
  ['KIT 基因', /KIT[^\n|]{0,24}?(外显子\s*\d+[^\n|]{0,16})/i],
  ['PDGFRA 基因', /PDGFRA[^\n|]{0,24}?(外显子\s*\d+[^\n|]{0,16})/i],
  ['SDHB', /SDHB[^\n|]{0,12}?(阳性|阴性|缺失|表达缺失)/i],
];

/** 化验指标：中文名 / 英文缩写 → 指标键。顺序即匹配优先级（长名在前，避免"白细胞"吃掉"白细胞计数"）。 */
const LAB_RULES = [
  ['hgb', ['血红蛋白', 'HGB', 'Hb'], 'g/L'],
  ['wbc', ['白细胞计数', '白细胞', 'WBC'], '10⁹/L'],
  ['anc', ['中性粒细胞绝对值', '中性粒细胞计数', '中性粒细胞', 'ANC'], '10⁹/L'],
  ['plt', ['血小板计数', '血小板', 'PLT'], '10⁹/L'],
  ['alt', ['丙氨酸氨基转移酶', '谷丙转氨酶', 'ALT'], 'U/L'],
  ['ast', ['天门冬氨酸氨基转移酶', '谷草转氨酶', 'AST'], 'U/L'],
  ['tbil', ['总胆红素', 'TBIL'], 'μmol/L'],
  ['cr', ['血清肌酐', '肌酐', 'Cr', 'CREA'], 'μmol/L'],
  ['ldh', ['乳酸脱氢酶', 'LDH'], 'U/L'],
  ['alb', ['白蛋白', 'ALB'], 'g/L'],
  ['tsh', ['促甲状腺激素', 'TSH'], 'mIU/L'],
  ['tdm', ['伊马替尼谷浓度', '伊马替尼血药浓度', '谷浓度'], 'ng/mL'],
];

/** 报告里的项目名 → 候选用名。报告写「发生部位 / 肿瘤最大径 / 核分裂象计数」，候选统一成一套名字。 */
const PATH_ALIAS = [
  [/^(发生部位|部位)$/, '肿瘤部位'],
  [/^(肿瘤最大径|最大径|肿瘤大小|肿瘤直径|大小)$/, '肿瘤大小'],
  [/^核分裂(象|象计数|计数)?$/, '核分裂象'],
  [/^切缘(状态)?$/, '切缘'],
  [/^(肿瘤)?破裂$/, '肿瘤破裂'],
  [/^CD\s*117$/i, 'CD117'],
  [/^DOG\s*-?\s*1$/i, 'DOG1'],
  [/^KIT(基因)?$/i, 'KIT 基因'],
  [/^PDGFRA(基因)?$/i, 'PDGFRA 基因'],
  [/^SDHB$/i, 'SDHB'],
  [/^(危险度|危险度分级|复发风险)$/, '危险度'],
];
export function canonicalPathName(name) {
  const n = String(name || '').replace(/\s+/g, '');
  for (const [re, canon] of PATH_ALIAS) if (re.test(n)) return canon;
  return null;
}

/** 这些值不是指标结果，是参考区间或单位噪声——见到了要跳过，不能被当成结果。 */
const NOT_A_VALUE = /^(参考|正常|范围|区间|单位|结果|项目|检验|项目名称|null|-{1,3})/i;

const MAX_CANDIDATES = 40;

/**
 * HTML 表格 → 竖线表格。
 *
 * 为什么必须做：MinerU 的 full.md 里表格是 `<table><tr><td>`，不是 markdown 管道表。
 * 直接剥标签会把整张表压成一行（"胃体肿瘤最大径6.8 cm核分裂象计数12 个"），
 * 之后不管是标签正则还是位置对齐都会读错。所以先转成 `| a | b |`，再走同一条对齐路径。
 *
 * colspan 补空的占位单元格（不复制内容）：`<td colspan="2">胃体</td>` → `| 胃体 | |`，
 * 这样「项目 | 结果 | 单位」三列仍然对得上，单位列是空的而不是把值重复一遍。
 */
export function htmlTablesToPipes(md) {
  return String(md || '').replace(/<table[\s\S]*?<\/table>/gi, (table) => {
    const trs = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    const lines = trs.map((tr) => {
      const tds = tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
      const out = [];
      for (const td of tds) {
        const attrs = (td.match(/^<t[dh][^>]*>/i) || [''])[0];
        const span = Number((attrs.match(/colspan\s*=\s*["']?(\d+)/i) || [])[1] || 1);
        const text = td.replace(/^<t[dh][^>]*>/i, '').replace(/<\/t[dh]>$/i, '')
          .replace(/<[^>]+>/g, '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
        out.push(text, ...Array(Math.max(0, span - 1)).fill(''));
      }
      return `| ${out.join(' | ')} |`;
    });
    if (!lines.length) return '';
    // 首行当表头，补一条分隔行，后面所有解析都按「表头 + 分隔行 + 数据行」的同一套规则走
    return `\n${lines[0]}\n| ${lines[0].split('|').slice(1, -1).map(() => '---').join(' | ')} |\n${lines.slice(1).join('\n')}\n`;
  });
}

/** 去掉图片、脚注标记与行内 HTML；表格先转成竖线结构（对齐要靠它）。 */
export function normalizeMarkdown(md) {
  return htmlTablesToPipes(md)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\^[^\]]*\]/g, '')
    .replace(/\r\n?/g, '\n');
}

/** `| a | b |` → ['a','b']；没有竖线返回 null。 */
function cells(line) {
  const t = line.trim();
  if (!t.startsWith('|') || !t.includes('|', 1)) return null;
  return t.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}

/** 表格分隔行 `| --- | --- |` */
const isSeparator = (line) => /^\s*\|?[\s:-]*-{3,}[\s:|-]*$/.test(line);

/**
 * 表格按位置对齐：表头行给出指标名，值行给出数值/单位。
 * 两边数量不一致 → 返回空数组（整行放弃）。
 */
export function alignTableRow(header, valueRow) {
  const names = cells(header);
  const values = cells(valueRow);
  if (!names || !values) return [];
  if (names.length < 2 || names.length !== values.length) return [];
  const pairs = [];
  for (let i = 0; i < names.length; i += 1) {
    const name = names[i];
    const value = values[i];
    if (!name || !value) continue;
    if (NOT_A_VALUE.test(name) || NOT_A_VALUE.test(value)) continue;
    pairs.push([name, value]);
  }
  return pairs;
}

/** 从一段文本里取数值 + 单位；不等式保留为原文。 */
export function readValue(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  if (NOT_A_VALUE.test(raw)) return null;
  // `<0.5` / `≤3` / `>1000`：保留符号与数字，不折成数字
  const ineq = raw.match(/^[<≤>≥]\s*\d+(?:\.\d+)?\s*([A-Za-zμµ⁹¹²%^\/0-9]*)/);
  if (ineq) {
    const sym = ineq[0].match(/^[<≤>≥]\s*\d+(?:\.\d+)?/)[0].replace(/\s+/g, '');
    const unit = normalizeUnit(ineq[1] || '');
    return { text: unit ? `${sym} ${unit}` : sym, numeric: null };
  }
  const num = raw.match(/\d+(?:\.\d+)?/);
  if (!num) return null;
  const unit = normalizeUnit(raw.slice(num.index + num[0].length).trim().split(/\s+/)[0] || '');
  return { text: unit ? `${num[0]} ${unit}` : num[0], numeric: Number(num[0]), unit: unit || null };
}

/** 单位归一：只做写法统一，认不出就留原文（不猜）。 */
export function normalizeUnit(unit) {
  if (!unit) return '';
  const u = String(unit).trim();
  const map = [
    [/^(10\^9|10e9|\*10\^9)\s*\/\s*L$/i, '10⁹/L'],
    [/^(10\^12|10e12)\s*\/\s*L$/i, '10¹²/L'],
    [/^(umol|μmol|µmol)\s*\/\s*L$/i, 'μmol/L'],
    [/^(u|μ|µ)mol\/L$/i, 'μmol/L'],
    [/^g\s*\/\s*l$/i, 'g/L'],
    [/^mg\s*\/\s*dl$/i, 'mg/dL'],
  ];
  for (const [re, out] of map) if (re.test(u)) return out;
  return u;
}

/** 在文本里找一个化验指标的值。返回 `{ value, unit }` 或 null。 */
function findLab(text, aliases) {
  for (const alias of aliases) {
    // 拉丁名要词边界：CRP 不能被当成 Cr，Cr 也不能匹配到 Creatinine 里
    const latin = /^[A-Za-z]+$/.test(alias);
    const pattern = latin
      ? new RegExp(`(?:^|[^A-Za-z])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^A-Za-z]|$)`, 'i')
      : new RegExp(alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const at = text.search(pattern);
    if (at < 0) continue;
    const after = text.slice(at, at + 160);
    // 参考区间 `3.5-9.5` 不是结果：跳过"含 区间/范围"的片段，取第一个裸数值
    const seg = after.replace(/参考值?范围?[^\d]{0,6}[\d.]+\s*[-~—]\s*[\d.]+/g, '').replace(/参考值?范围?[^\d]{0,6}[\d.]+/g, '');
    const m = seg.match(/[\s:：]*([<≤>≥]?\s*\d+(?:\.\d+)?)\s*([A-Za-zμµ⁹¹²%^\/0-9]*)/);
    if (!m) continue;
    const value = `${m[1].replace(/\s+/g, '')}${m[2] ? ` ${normalizeUnit(m[2])}` : ''}`.trim();
    if (!/\d/.test(value)) continue;
    return { value, unit: m[2] ? normalizeUnit(m[2]) : null };
  }
  return null;
}

/** 报告日期：优先带标签的行，其次前 40 行第一个合法日期。不存在 2026-02-31 这种。 */
export function findDate(text) {
  const valid = (y, m, d) => {
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    return dt.getUTCFullYear() === Number(y) && dt.getUTCMonth() + 1 === Number(m) && dt.getUTCDate() === Number(d);
  };
  const mk = (y, m, d) => (valid(y, m, d) ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null);
  const label = text.match(/(?:采样|采集|报告|检查|检验|送检)日期[：:\s]*(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (label) return mk(label[1], label[2], label[3]);
  const head = text.split('\n').slice(0, 40).join('\n');
  const any = head.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  return any ? mk(any[1], any[2], any[3]) : null;
}

/**
 * 抽候选。返回 `[{ name, value, source }]`，去重（同名只留第一条），上限 40 条。
 * @param {string} markdown MinerU 的 full.md
 * @param {{ source?: string }} opts source 写进候选的出处（文件名 / 页码）
 */
export function extractCandidates(markdown, opts = {}) {
  const text = normalizeMarkdown(markdown);
  const source = opts.source || '导入原件';
  const out = [];
  const seen = new Set();
  const push = (name, value) => {
    if (!value || !String(value).trim()) return;
    if (name === '肿瘤部位') {
      // 原文里部位后面常紧跟别的项目（"胃体 肿瘤最大径 6.8 cm"），截到下一个字段名，最多 12 字
      value = String(value).split(/(?:肿瘤最大径|最大径|核分裂|切缘|破裂|CD117|DOG1|KIT|PDGFRA|SDHB)/i)[0].trim().slice(0, 12);
      if (!value) return;
    }
    const key = name.trim();
    if (seen.has(key)) return;
    seen.add(key);
    const v = String(value).trim().replace(/\s+/g, ' ').slice(0, 160);
    if (v.length < 1) return;
    out.push({ name: key, value: v, source });
  };

  /* ① 病理字段：先走标签正则 */
  for (const [name, re] of PATHOLOGY_RULES) {
    const m = text.match(re);
    if (m && m[1]) push(name, m[1]);
  }

  const lines = text.split('\n');

  /* ② 病理竖表：MinerU 常把病理也排成「项目 | 结果 | 单位」，一行一个字段 */
  for (let i = 0; i < lines.length - 2; i += 1) {
    if (!cells(lines[i]) || isSeparator(lines[i])) continue;
    if (!isSeparator(lines[i + 1])) continue;
    const header = cells(lines[i]);
    const nameCol = header.findIndex((h) => /^(项目|项目名称|检验项目|指标|名称)$/.test(h));
    const resCol = header.findIndex((h) => /^(结果|数值|测定值)$/.test(h));
    if (nameCol < 0 || resCol < 0) continue;
    const unitCol = header.findIndex((h) => /^(单位|unit)$/i.test(h));
    for (let j = i + 2; j < lines.length && cells(lines[j]) && !isSeparator(lines[j]); j += 1) {
      const row = cells(lines[j]);
      if (row.length !== header.length) continue;      // 行不对齐 → 整行放弃
      const canon = canonicalPathName(row[nameCol]);
      if (!canon) continue;
      const unit = unitCol >= 0 ? row[unitCol] : '';
      push(canon, unit ? `${row[resCol]} ${unit}` : row[resCol]);
    }
  }

  /* ③ 化验指标：表格对齐优先，其次自由文本 */
  const tablePairs = new Map();
  for (let i = 0; i < lines.length - 2; i += 1) {
    if (!cells(lines[i]) || isSeparator(lines[i])) continue;
    if (!isSeparator(lines[i + 1])) continue;
    const header = cells(lines[i]);
    if (header.length !== cells(lines[i + 2] || '').length && cells(lines[i + 2] || '')) continue;
    const unitCol = header.findIndex((h) => /^(单位|unit)$/i.test(h));
    /* 两种排版都要认：
       A. 竖表 —— 表头是「项目 | 结果 | 单位」，一行一个指标（化验单最常见）
       B. 横表 —— 表头是「血红蛋白 | 白细胞 | 血小板」，一行一个时间点 */
    const nameCol = header.findIndex((h) => /^(项目|项目名称|检验项目|指标|名称)$/.test(h));
    const resCol = header.findIndex((h) => /^(结果|数值|测定值)$/.test(h));
    const metricOf = (name) => LAB_RULES.find(([, aliases]) => aliases.some((a) => name.toLowerCase() === a.toLowerCase()));
    let j = i + 2;
    while (j < lines.length && cells(lines[j]) && !isSeparator(lines[j])) {
      const row = cells(lines[j]);
      if (row.length !== header.length) { j += 1; continue; }   // 行不对齐 → 这一行整行放弃
      if (nameCol >= 0 && resCol >= 0) {
        const hit = metricOf(row[nameCol]);
        if (hit) {
          const unit = unitCol >= 0 ? row[unitCol] : '';
          const v = readValue(unit ? `${row[resCol]} ${unit}` : row[resCol]);
          if (v && !tablePairs.has(hit[0])) tablePairs.set(hit[0], v.text);
        }
      } else {
        for (let c = 0; c < header.length; c += 1) {
          const name = header[c];
          if (!name || NOT_A_VALUE.test(name)) continue;
          const hit = metricOf(name);
          if (!hit) continue;
          const unit = unitCol >= 0 ? row[unitCol] : '';
          const v = readValue(unit ? `${row[c]} ${unit}` : row[c]);
          if (v && !tablePairs.has(hit[0])) tablePairs.set(hit[0], v.text);
        }
      }
      j += 1;
    }
    i = j - 1;
  }

  for (const [key, aliases] of LAB_RULES) {
    if (tablePairs.has(key)) {
      push(metricName(key), tablePairs.get(key));
      continue;
    }
    const hit = findLab(text, aliases);
    if (hit) push(metricName(key), hit.value);
  }

  /* ④ 日期：报告日期本身也是候选（写进档案要用户确认） */
  const date = findDate(text);
  if (date) push('报告日期', date);

  return out.slice(0, MAX_CANDIDATES);
}

/** 指标键 → 页面上的中文名（与 metrics 表同一套写法）。 */
const METRIC_NAMES = {
  hgb: '血红蛋白', wbc: '白细胞', anc: '中性粒细胞', plt: '血小板',
  alt: 'ALT', ast: 'AST', tbil: '总胆红素', cr: '肌酐', ldh: 'LDH', alb: '白蛋白',
  tsh: 'TSH', tdm: '伊马替尼谷浓度',
};
export function metricName(key) {
  return METRIC_NAMES[key] || key;
}
