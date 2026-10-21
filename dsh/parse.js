/* 解析编排：一份原件 → MinerU → markdown → 候选字段。
 *
 * 事务边界与失败语义（docs/18-MINERU-PARSING.md 第 6 节）：
 *   标「解析中」→ 云端解析 → 抽候选 → 同一事务写候选 + 把 documents 标「待核对」
 *                              ↘ 任一步失败：候选 0 条，documents 标「解析失败」，
 *                                原件保留，可重试；错误文本留在返回体里给界面显示。
 *
 * 三条不做：
 * 1. **不静默降级**：云端失败不会退回本地正则凑一份——两套口径的数据没法比较，
 *    宁可让用户看到「解析失败」并手填；
 * 2. **不把候选当事实**：只写 candidate_fields，不碰 pathology_rows / metric_points；
 * 3. **不把「跑完了」当「解析对了」**：拿不到 full.md 就是失败，空字符串不当成功。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CommandError } from './commands.js';
import { MineruError, createMineruClient } from './mineru.js';
import { extractCandidates } from './gistparse.js';

/** 能被 MinerU 接的文件类型（按扩展名判，接口那边也按扩展名判类型）。 */
const PARSEABLE = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'doc', 'docx', 'ppt', 'pptx']);

export function isParseable(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  return PARSEABLE.has(ext);
}

function assertDoc(db, profile, id) {
  const row = db.prepare('SELECT id, name, status FROM documents WHERE profile_key = ? AND id = ?').get(profile, id);
  if (!row) throw new CommandError('DOC_NOT_FOUND', `资料库里没有这份材料：${id}`, 404);
  return row;
}

const setStatus = (db, profile, id, status) =>
  db.prepare('UPDATE documents SET status = ? WHERE profile_key = ? AND id = ?').run(status, profile, id);

function nextCandOrd(db, profile) {
  return db.prepare('SELECT COALESCE(MAX(ord), -1) + 1 AS n FROM candidate_fields WHERE profile_key = ?').get(profile).n;
}

/**
 * 解析一份已导入的原件。
 * @param {object} db
 * @param {string} workspace 用户选定的资料目录
 * @param {{ profile:string, id:string, force?:boolean }} input
 * @param {object} [deps] 注入 `client`（单测用假的，不联网）
 * @returns {Promise<{status:'parsed', docId, candidates:number, pages:number|null, modelVersion:string}>}
 */
export async function parseDocument(db, workspace, input = {}, deps = {}) {
  const profile = String(input.profile || '').trim();
  if (!profile) throw new CommandError('PROFILE_REQUIRED', '缺少档案标识：这份材料属于哪一位');
  const doc = assertDoc(db, profile, input.id);

  if (!isParseable(doc.name)) {
    // 明确拒绝而不是"试一下"：TXT/MD 走本机读取，走云端只是白花一次额度
    throw new CommandError(
      'NOT_PARSEABLE',
      `「${doc.name}」不是可解析的格式：PDF / 图片 / Word / PPT 才走云端解析，文本文件请直接手工补录`,
    );
  }

  const file = join(workspace, 'imports', `${doc.id}-${doc.name}`);
  if (!existsSync(file)) {
    throw new CommandError('DOC_FILE_MISSING', `原件不在资料目录里（${file}），请重新导入这一份`, 404);
  }
  const bytes = readFileSync(file);

  // 不把「解析中」写进库：进程中途退出会留下一个永远转圈的状态。
  // 「正在解析」由前端内存态表示，库里只有「待解析 / 待核对 / 解析失败」三种终态。
  const client = deps.client || createMineruClient();

  let parsed;
  try {
    parsed = await client.parse({
      bytes,
      filename: doc.name,
      dataId: doc.id,
      intervalMs: deps.intervalMs ?? 3000,
      timeoutMs: deps.timeoutMs ?? 300000,
    });
  } catch (error) {
    setStatus(db, profile, doc.id, '解析失败');
    if (error instanceof MineruError) {
      throw new CommandError(`MINERU_${error.code}`, `解析失败：${error.message}`, error.code === 'UNAUTHORIZED' ? 401 : 502);
    }
    throw new CommandError('PARSE_FAILED', `解析失败：${error.message}`, 502);
  }

  const markdown = String(parsed.markdown || '');
  if (!markdown.trim()) {
    setStatus(db, profile, doc.id, '解析失败');
    throw new CommandError('EMPTY_MARKDOWN', '云端返回的正文是空的；原件保留，可以重试或手工补录', 502);
  }

  const source = `${doc.name}${parsed.pages ? ` · 共 ${parsed.pages} 页` : ''}`;
  const found = extractCandidates(markdown, { source });
  if (!found.length) {
    // 抽不到就明确说抽不到，不硬编一条"看起来合理"的候选
    setStatus(db, profile, doc.id, '解析失败');
    throw new CommandError(
      'NO_CANDIDATE',
      '解析完成了，但这份材料里没有认出可抄写的字段（可能不是病理/化验类报告）；原件保留，可手工补录',
      422,
    );
  }

  let ord = nextCandOrd(db, profile);
  const insert = db.prepare('INSERT OR REPLACE INTO candidate_fields (profile_key, id, name, value, source, status, ord) VALUES (?,?,?,?,?,?,?)');
  db.exec('BEGIN');
  try {
    for (const c of found) {
      // id 用「材料 id + 序号」，同一份材料重解析会覆盖自己的候选，不会无限堆积
      insert.run(profile, `${doc.id}-${ord}`, c.name, c.value, c.source, '待核对', ord);
      ord += 1;
    }
    setStatus(db, profile, doc.id, '待核对');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    setStatus(db, profile, doc.id, '解析失败');
    throw new CommandError('PARSE_WRITE_FAILED', `候选没能写进库：${error.message}`, 500);
  }

  return {
    ok: true,
    status: 'parsed',
    docId: doc.id,
    candidates: found.length,
    pages: parsed.pages ?? null,
    modelVersion: parsed.modelVersion ?? null,
  };
}
