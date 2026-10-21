/* 文件落盘：导入原件与导出 Markdown。
 *
 * 两条边界（与 server.js 的资料目录校验同一套规矩）：
 * 1. 只在**用户选定的资料目录**下写：imports/ 与 exports/，不写到别处、不写系统临时目录；
 * 2. 文件名只保留基名，路径分隔符、控制字符、超长名一律清理——导入的是别人给的文件，
 *    文件名里带什么都不能变成路径。
 *
 * 状态语义：刚导入的行是「待解析」——解析成功才变「待核对」（有候选等你逐条确认），
 * 失败变「解析失败」（原件留着可重试）。导入本身**不产生候选**。
 *
 * 原件语义：导入时**复制**一份到 imports/，不改动用户原来那个文件；
 * 内容相同（sha256 前 12 位相同）视为同一份，不重复入库、不重置解析状态（契约② 的思路）。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { CommandError } from './commands.js';

export const MAX_IMPORT_BYTES = 40 * 1024 * 1024;

const today = () => new Date().toISOString().slice(0, 10);

/** 只留基名，去掉控制字符与路径分隔符，限长 120；全空则给个兜底名。 */
function safeName(raw) {
  const base = basename(String(raw || '').replace(/\\/g, '/')).replace(/[\u0000-\u001f<>:"|?*]/g, '').trim();
  const cut = base.slice(0, 120);
  return cut || '未命名文件';
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function assertProfile(db, profile) {
  if (typeof profile !== 'string' || !profile.trim()) {
    throw new CommandError('PROFILE_REQUIRED', '缺少档案标识：这份材料属于哪一位');
  }
  const row = db.prepare('SELECT profile_key FROM subjects WHERE profile_key = ?').get(profile);
  if (!row) throw new CommandError('PROFILE_NOT_FOUND', `没有这个档案：${profile}`, 404);
  return profile;
}

/**
 * 导入一份原件。
 * @param {object} input { profile, name, type, bytes }
 * @returns {{ status:'created'|'unchanged', id, name, path, size }}
 */
export function saveImport(db, workspace, input = {}) {
  const profile = assertProfile(db, input.profile);
  const name = safeName(input.name);
  const type = typeof input.type === 'string' && input.type.trim() ? input.type.trim().slice(0, 40) : '其他';
  const bytes = input.bytes;
  if (!bytes || typeof bytes.length !== 'number') {
    throw new CommandError('FILE_EMPTY', '没有收到文件内容');
  }
  if (bytes.length === 0) throw new CommandError('FILE_EMPTY', '这个文件是空的');
  if (bytes.length > MAX_IMPORT_BYTES) {
    throw new CommandError('FILE_TOO_LARGE', `文件超过 ${MAX_IMPORT_BYTES / 1024 / 1024} MB 上限，未导入`, 413);
  }

  const sha = createHash('sha256').update(bytes).digest('hex');
  const id = `f${sha.slice(0, 12)}`;
  const dir = ensureDir(join(workspace, 'imports'));
  const file = join(dir, `${id}-${name}`);

  const existed = db.prepare('SELECT id, name FROM documents WHERE profile_key = ? AND id = ?').get(profile, id);
  if (existed) {
    return { ok: true, status: 'unchanged', id, name: existed.name, path: file, size: bytes.length };
  }

  try {
    writeFileSync(file, bytes);
  } catch (error) {
    throw new CommandError('FILE_WRITE_FAILED', `原件没能存进资料目录：${error.message}`, 500);
  }

  const ord = db.prepare('SELECT COALESCE(MAX(ord), 0) + 1 AS n FROM documents WHERE profile_key = ?').get(profile).n;
  db.prepare('INSERT INTO documents (profile_key, id, name, date, type, status, ord) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(profile, id, name, today(), type, '待解析', ord);

  return { ok: true, status: 'created', id, name, path: file, size: bytes.length };
}

/** 导出 Markdown 到 exports/。文件名固定为 日期-种类.md，重复导出覆盖同名文件（导出物不是事实，可重生成）。 */
export function saveExport(workspace, input = {}) {
  const text = typeof input.text === 'string' ? input.text : '';
  if (!text.trim()) throw new CommandError('EXPORT_EMPTY', '导出内容是空的');
  if (text.length > 512 * 1024) throw new CommandError('EXPORT_TOO_LARGE', '导出内容超过 512KB', 413);

  const kindRaw = typeof input.kind === 'string' && input.kind.trim() ? input.kind.trim() : '复诊准备';
  const kind = kindRaw.replace(/[^\w\u4e00-\u9fa5-]/g, '').slice(0, 40) || '导出';
  const dir = ensureDir(join(workspace, 'exports'));
  const file = join(dir, `${today()}-${kind}.md`);

  try {
    writeFileSync(file, text, 'utf8');
  } catch (error) {
    throw new CommandError('FILE_WRITE_FAILED', `导出没能写进资料目录：${error.message}`, 500);
  }
  return { ok: true, status: 'created', path: file, bytes: Buffer.byteLength(text, 'utf8') };
}
