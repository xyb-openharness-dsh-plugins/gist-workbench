#!/usr/bin/env node
/**
 * 采集「胃肠间质瘤（GIST）」2026 年首次公示的干预性临床试验，产出本地资料包。
 *
 * 用法：
 *   node scripts/fetch-gist-trials-2026.mjs             # 采集并写出资料包
 *   node scripts/fetch-gist-trials-2026.mjs --dry-run   # 只打印命中数，不写文件
 *
 * 口径（家族同一方法学，检索词按 GIST 收窄）：
 *   - ClinicalTrials.gov API v2
 *   - query.cond 三组并集：gastrointestinal stromal tumor / GIST / gastrointestinal stromal tumour
 *   - filter.advanced = AREA[StudyFirstPostDate]RANGE[2026-01-01,MAX] AND AREA[StudyType]INTERVENTIONAL
 *   - 再经本地疾病术语过滤（命中标题或 conditions 任一）
 *
 * 与其它癌种资料包的边界：
 *   - GIST 与「胃癌」「软组织肉瘤」在登记库里常有交叉（部分研究把 GIST 列进 soft tissue sarcoma 篮式），
 *     这类篮式研究**保留但标 category=basket**，跨包相加会重复计数，README 里写明。
 *   - 不把 leiomyoma / leiomyosarcoma / schwannoma 当 GIST：它们是不同的间叶源性肿瘤，
 *     检索词里出现只是鉴别诊断，不能并包。
 *
 * 坑（勿改回）：
 *   1. filter.advanced 是单值参数，两个 AREA 必须用 AND 拼成一个值，传两次会 400。
 *   2. pageToken 为空串会 400 —— 只有拿到非空 token 才带上。
 *   3. pageSize 上限 1000，取 200 稳。
 *   4. 裸词 'stromal' 不收：会把骨髓基质、角膜基质等非肿瘤研究一起收进来。
 *   5. 缩写 GIST 用词边界匹配：小写包含匹配会命中 "gist" 出现在普通英文里的情况。
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(HERE, '..');
const OUT_DIR = process.env.GIST_RESEARCH_DIR || join(PROJECT_ROOT, 'research', 'gist-cancer');

const API = 'https://clinicaltrials.gov/api/v2/studies';
const YEAR_FROM = '2026-01-01';
const PAGE_SIZE = 200;

/** 三组检索词：全称两种拼写 + 缩写（缩写覆盖小细胞/胃肠道以外的写法差异） */
const QUERIES = [
  'gastrointestinal stromal tumor',
  'gastrointestinal stromal tumour',
  'GIST',
];

/** 本地疾病术语过滤（小写比对，命中标题或 conditions 任一即保留） */
const DISEASE_TERMS = [
  'gastrointestinal stromal tumor', 'gastrointestinal stromal tumour',
  'gastrointestinal stromal neoplasm', 'gastrointestinal stromal neoplasms',
  'gastrointestinal stromal sarcoma', 'stromal tumor of the gastrointestinal',
  'stromal tumour of the gastrointestinal', 'gist',
];

/** 反向检查词：命中这些词的**保留**记录要打印出来人工看一眼 */
const SUSPECT_TERMS = [
  'leiomyoma', 'leiomyosarcoma', 'schwannoma', 'neurofibroma', 'desmoid',
  'lymphoma', 'neuroendocrine', 'carcinoma',
];
/** 明确 GIST 词：同时命中反向词时仍视为有效记录 */
const GIST_WORDS = ['gastrointestinal stromal', 'gist'];

/** 篮式研究判定：conditions 含泛化实体瘤词，且同时列入了 ≥1 个其它瘤种 */
const BASKET_TERMS = ['solid tumor', 'solid tumour', 'advanced cancer', 'advanced solid', 'solid neoplas', 'sarcoma'];
const OTHER_CANCER_TERMS = [
  'lung cancer', 'non-small cell lung', 'small cell lung', 'nsclc', 'sclc',
  'breast cancer', 'colorectal', 'colon cancer', 'rectal cancer', 'gastric cancer',
  'esophageal', 'pancreatic', 'ovarian', 'prostate', 'hepatocellular',
  'head and neck', 'endometrial', 'biliary', 'cholangiocarcinoma', 'melanoma',
  'bladder', 'renal cell', 'cervical', 'thyroid', 'glioma', 'osteosarcoma',
  'leukemia', 'lymphoma', 'myeloma', 'urothelial',
];

const ADVANCED = `AREA[StudyFirstPostDate]RANGE[${YEAR_FROM},MAX] AND AREA[StudyType]INTERVENTIONAL`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(cond, pageToken) {
  const url = new URL(API);
  url.searchParams.set('query.cond', cond);
  url.searchParams.set('filter.advanced', ADVANCED);
  url.searchParams.set('pageSize', String(PAGE_SIZE));
  url.searchParams.set('countTotal', 'true');
  if (pageToken) url.searchParams.set('pageToken', pageToken);

  let lastErr;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text().catch(() => '')}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await sleep(800 * (attempt + 1));
    }
  }
  throw new Error(`检索失败 cond="${cond}": ${lastErr && lastErr.message}`);
}

const txt = (v) => (typeof v === 'string' ? v.trim() : '');
const dateOf = (s) => txt(s && s.date);

/** GIST 缩写要词边界匹配，避免 "gist" 出现在普通英文里被误判 */
const hasGist = (hay) => /(^|[^a-z])gist([^a-z]|$)/.test(hay);

function flatten(study) {
  const p = (study && study.protocolSection) || {};
  const id = (p.identificationModule || {}).nctId;
  if (!id) return null;

  const status = p.statusModule || {};
  const design = p.designModule || {};
  const conds = ((p.conditionsModule || {}).conditions || []).filter(Boolean);
  const ivs = ((p.armsInterventionsModule || {}).interventions || []);
  const locs = ((p.contactsLocationsModule || {}).locations || []);
  const desc = p.descriptionModule || {};
  const elig = p.eligibilityModule || {};

  const title = txt((p.identificationModule || {}).briefTitle);
  const conditions = conds.join('; ');

  const interventions = ivs
    .map((i) => [txt(i.type), txt(i.name)].filter(Boolean).join(': '))
    .filter(Boolean)
    .join('; ');

  const countries = [...new Set(locs.map((l) => txt(l.country)).filter(Boolean))].join('; ');

  const hay = `${title} ${conditions}`.toLowerCase();
  const hitsDisease = DISEASE_TERMS.some((t) => (t === 'gist' ? hasGist(hay) : hay.includes(t)));
  const condLower = conditions.toLowerCase();
  const isBasket = BASKET_TERMS.some((t) => condLower.includes(t))
    && OTHER_CANCER_TERMS.some((t) => condLower.includes(t));
  const category = isBasket ? 'basket' : 'disease-specific';

  return {
    registry: 'ClinicalTrials.gov',
    registry_id: id,
    title,
    official_title: txt((p.identificationModule || {}).officialTitle),
    first_posted: dateOf(status.studyFirstPostDateStruct),
    start_date: dateOf(status.startDateStruct),
    primary_completion: dateOf(status.primaryCompletionDateStruct),
    last_update: dateOf(status.lastUpdatePostDateStruct),
    overall_status: txt(status.overallStatus),
    study_type: txt(design.studyType),
    phases: ((design.phases || []).join('; ')).toUpperCase().replace(/ /g, ''),
    conditions,
    interventions,
    lead_sponsor: txt(((p.sponsorCollaboratorsModule || {}).leadSponsor || {}).name),
    countries,
    enrollment: Number.isFinite(design.enrollmentInfo && design.enrollmentInfo.count)
      ? design.enrollmentInfo.count
      : null,
    summary: txt(desc.briefSummary),
    eligibility: txt(elig.eligibilityCriteria),
    category,
    source_url: `https://clinicaltrials.gov/study/${id}`,
    fetched_at: new Date().toISOString(),
    _hitsDisease: hitsDisease,
  };
}

async function collectAll(dryRun) {
  const byId = new Map();
  const rawCounts = {};

  for (const cond of QUERIES) {
    let token = '';
    let pages = 0;
    let raw = 0;
    for (;;) {
      const data = await fetchPage(cond, token);
      raw = Number(data.totalCount) || raw;
      const studies = data.studies || [];
      for (const s of studies) {
        const rec = flatten(s);
        if (rec) byId.set(rec.registry_id, rec);
      }
      pages += 1;
      if (dryRun && pages >= 1) break;
      token = txt(data.nextPageToken);
      if (!token || studies.length === 0) break;
      await sleep(120);
    }
    rawCounts[cond] = raw;
    console.log(`  · ${cond}: 原始 ${raw} 条，已翻 ${pages} 页`);
  }
  return { byId, rawCounts };
}

function applyFilter(byId) {
  const kept = [];
  const droppedList = [];
  for (const rec of byId.values()) {
    const { _hitsDisease, ...clean } = rec; // eslint-disable-line no-unused-vars
    if (_hitsDisease) kept.push(clean);
    else droppedList.push(rec);
  }
  kept.sort((a, b) => (a.first_posted < b.first_posted ? 1 : a.first_posted > b.first_posted ? -1
    : a.registry_id < b.registry_id ? -1 : 1));
  return { kept, dropped: droppedList.length, droppedList };
}

function writeSqlite(file, rows) {
  rmSync(file, { force: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE trial_records (
      id INTEGER PRIMARY KEY,
      registry TEXT NOT NULL, registry_id TEXT NOT NULL, title TEXT, official_title TEXT,
      first_posted TEXT, start_date TEXT, primary_completion TEXT, last_update TEXT,
      overall_status TEXT, study_type TEXT, phases TEXT, conditions TEXT,
      interventions TEXT, lead_sponsor TEXT, countries TEXT, enrollment INTEGER,
      summary TEXT, eligibility TEXT, category TEXT, source_url TEXT, fetched_at TEXT,
      UNIQUE(registry, registry_id)
    );
    CREATE TABLE source_coverage (
      source TEXT PRIMARY KEY, included INTEGER, record_count INTEGER, coverage_note TEXT
    );
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
    CREATE INDEX idx_records_status ON trial_records(overall_status);
    CREATE INDEX idx_records_category ON trial_records(category);
  `);
  const ins = db.prepare(`INSERT INTO trial_records
    (registry, registry_id, title, official_title, first_posted, start_date, primary_completion,
     last_update, overall_status, study_type, phases, conditions, interventions, lead_sponsor,
     countries, enrollment, summary, eligibility, category, source_url, fetched_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  db.exec('BEGIN');
  for (const r of rows) {
    ins.run(r.registry, r.registry_id, r.title, r.official_title, r.first_posted, r.start_date,
      r.primary_completion, r.last_update, r.overall_status, r.study_type, r.phases,
      r.conditions, r.interventions, r.lead_sponsor, r.countries, r.enrollment, r.summary,
      r.eligibility, r.category, r.source_url, r.fetched_at);
  }
  db.exec('COMMIT');

  db.prepare('INSERT INTO source_coverage VALUES (?,?,?,?)').run(
    'ClinicalTrials.gov', 1, rows.length,
    `API v2，query.cond 三组并集（${QUERIES.join(' / ')}），${ADVANCED}，本地疾病术语过滤`,
  );
  db.prepare('INSERT INTO source_coverage VALUES (?,?,?,?)').run(
    'ChinaDrugTrials', 0, 0, '本轮未采集（需会话采集器与既有会话配置），覆盖未知',
  );
  db.prepare('INSERT INTO source_coverage VALUES (?,?,?,?)').run(
    'ChiCTR', 0, 0, '本轮未采集，覆盖未知',
  );

  const meta = db.prepare('INSERT INTO metadata VALUES (?,?)');
  meta.run('year_filter', `StudyFirstPostDate >= ${YEAR_FROM}`);
  meta.run('study_type', 'INTERVENTIONAL');
  meta.run('queries', QUERIES.join(' | '));
  meta.run('disease_terms', DISEASE_TERMS.join(', '));
  meta.run('raw_total_before_filter', String(rows.length));
  db.close();
}

const sha256Of = async (file) => {
  const buf = await readFile(file);
  return createHash('sha256').update(buf).digest('hex');
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`GIST 2026 试验采集 · ${dryRun ? '试跑（不写文件）' : '正式采集'}`);
  console.log(`口径：${ADVANCED}`);

  const { byId, rawCounts } = await collectAll(dryRun);
  const { kept, dropped, droppedList } = applyFilter(byId);

  const byStatus = {};
  const byCategory = {};
  let china = 0;
  for (const r of kept) {
    const st = r.overall_status || 'UNKNOWN';
    byStatus[st] = (byStatus[st] || 0) + 1;
    byCategory[r.category] = (byCategory[r.category] || 0) + 1;
    if (/china|hong kong/i.test(r.countries || '')) china += 1;
  }

  console.log(`\n去重后 ${byId.size} 条；术语过滤保留 ${kept.length} 条，剔除 ${dropped} 条`);
  console.log('状态分布：', byStatus);
  console.log('类别分布：', byCategory);
  console.log(`含中国中心：${china} 条`);

  const suspects = kept.filter((r) => {
    const hay = `${r.title} ${r.conditions}`.toLowerCase();
    return SUSPECT_TERMS.some((t) => hay.includes(t))
      && !GIST_WORDS.some((t) => hay.includes(t));
  });
  console.log(`\n疑似非 GIST 记录 ${suspects.length} 条（命中鉴别诊断词且全文本无 GIST 词，需人工看一眼）：`);
  for (const r of suspects.slice(0, 12)) {
    console.log(`  - ${r.registry_id} | ${(r.title || '').slice(0, 60)} | cond: ${(r.conditions || '').slice(0, 60)}`);
  }

  if (droppedList.length) {
    console.log('\n被术语过滤剔除的样本（前 10 条，用于核对是否误杀）：');
    for (const r of droppedList.slice(0, 10)) {
      console.log(`  - ${r.registry_id} | ${(r.title || '').slice(0, 70)} | cond: ${(r.conditions || '').slice(0, 60)}`);
    }
  }

  if (dryRun) {
    console.log('\n（试跑结束，未写文件）');
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  const jsonlPath = join(OUT_DIR, 'trials-2026.jsonl');
  const dbPath = join(OUT_DIR, 'gist_cancer_trials_2026.sqlite');
  const manifestPath = join(OUT_DIR, 'manifest.json');

  await writeFile(jsonlPath, kept.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  writeSqlite(dbPath, kept);

  const dbStat = await stat(dbPath);
  const manifest = {
    disease: 'gist-cancer',
    year: 2026,
    generated_at: new Date().toISOString(),
    total_records: kept.length,
    raw_studies: byId.size,
    by_status: byStatus,
    by_category: byCategory,
    china_sites: china,
    sources: {
      ClinicalTrials: {
        included: true,
        count: kept.length,
        method: `ClinicalTrials.gov API v2, query.cond 三组并集（${QUERIES.join(' / ')}）, ${ADVANCED}, 本地疾病术语过滤`,
        raw_by_query: rawCounts,
      },
      ChinaDrugTrials: { included: false, count: 0, note: '本轮未采集，覆盖未知' },
      ChiCTR: { included: false, count: 0, note: '本轮未采集，覆盖未知' },
    },
    files: {
      gist_cancer_trials_2026: {
        sqlite: { sha256: await sha256Of(dbPath), bytes: dbStat.size },
        jsonl: { lines: kept.length },
      },
    },
    limitations: [
      '年份口径=首次公示在 2026 年，不是试验启动时间或结果发表年份',
      '仅干预性研究；观察性研究未采集',
      'ClinicalTrials.gov 覆盖仅限所记录查询词、日期与术语过滤；不代表全部全球注册库',
      'ChinaDrugTrials 与 ChiCTR 未采集，未命中不能解释为不存在',
      '登记状态不是入组资格；不构成方案推荐',
      '篮式研究（category=basket）同时归入软组织肉瘤等其它包，跨包相加会重复计数',
      'FAQ：GIST 与 leiomyosarcoma / schwannoma 属不同病种，本包不合并',
    ],
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`\n已写出：\n  ${jsonlPath}\n  ${dbPath}\n  ${manifestPath}`);
  console.log(`sqlite sha256 = ${manifest.files.gist_cancer_trials_2026.sqlite.sha256}`);
}

main().catch((err) => {
  console.error('采集失败：', err);
  process.exit(1);
});
