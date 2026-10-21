/* 文件落盘：导入原件（复制进 imports/，sha256 去重）与导出 Markdown（exports/）。 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { openDatabase, migrate, close } from '../dsh/store.js';
import { seedDemo } from '../dsh/demo.js';
import { getProfile } from '../dsh/readmodels.js';
import { saveImport, saveExport } from '../dsh/files.js';

const tmp = mkdtempSync(join(homedir(), '.xyb-gist-files-'));
after(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* 清理失败不影响结果 */ } });

function fresh() {
  const ws = mkdtempSync(join(tmp, 'ws-'));
  const db = openDatabase(':memory:');
  migrate(db);
  seedDemo(db);
  return { ws, db };
}

test('① 导入：原件复制进 imports/，库里多一行「待核对」', () => {
  const { ws, db } = fresh();
  const bytes = Buffer.from('病理报告 胃肠间质瘤 核分裂象 5/50 HPF', 'utf8');
  const out = saveImport(db, ws, { profile: 'A', name: '病理报告.txt', type: '病理报告', bytes });

  assert.equal(out.status, 'created');
  assert.ok(existsSync(out.path), '文件应真的落盘');
  assert.equal(readFileSync(out.path, 'utf8'), bytes.toString('utf8'), '内容必须原样保存');
  assert.equal(readdirSync(join(ws, 'imports')).length, 1);

  const p = getProfile(db, 'A');
  const hit = p.docs.find((d) => d[0] === out.id);
  assert.ok(hit, '资料库里应能看到这份材料');
  assert.equal(hit[1], '病理报告.txt');
  assert.equal(hit[4], '待核对', '导入后状态是待核对，不是已核对');
  close(db);
});

test('② 导入去重：同一份内容再导入返回 unchanged，文件与行都不新增', () => {
  const { ws, db } = fresh();
  const bytes = Buffer.from('%PDF-1.7 同样的一份', 'utf8');
  const a = saveImport(db, ws, { profile: 'A', name: 'a.pdf', type: '影像报告', bytes });
  const b = saveImport(db, ws, { profile: 'A', name: 'b.pdf', type: '影像报告', bytes });

  assert.equal(b.status, 'unchanged');
  assert.equal(b.id, a.id, '内容相同 → 同一个 id');
  assert.equal(readdirSync(join(ws, 'imports')).length, 1, '不该写第二份文件');
  assert.equal(getProfile(db, 'A').docs.filter((d) => d[0] === a.id).length, 1);
  close(db);
});

test('③ 文件名里的路径被剥掉，不会写到资料目录之外', () => {
  const { ws, db } = fresh();
  const out = saveImport(db, ws, { profile: 'A', name: '../../../etc/passwd', type: '其他', bytes: Buffer.from('x') });
  assert.ok(out.path.startsWith(join(ws, 'imports')), `必须落在 imports/ 内，实际 ${out.path}`);
  assert.ok(!out.path.includes('..'), '落盘路径里不该出现 ..');
  assert.ok(!existsSync(join(ws, '..', 'etc')), '资料目录之外不该出现文件');
  close(db);
});

test('④ 空文件与超限文件被拒，且不落盘', () => {
  const { ws, db } = fresh();
  assert.throws(() => saveImport(db, ws, { profile: 'A', name: 'empty.txt', bytes: Buffer.alloc(0) }),
    (e) => e.code === 'FILE_EMPTY');
  const big = Buffer.alloc(41 * 1024 * 1024);
  assert.throws(() => saveImport(db, ws, { profile: 'A', name: 'big.pdf', bytes: big }),
    (e) => e.code === 'FILE_TOO_LARGE' && e.status === 413);
  assert.ok(!existsSync(join(ws, 'imports')) || readdirSync(join(ws, 'imports')).length === 0, '被拒的文件不该留下');
  close(db);
});

test('⑤ 导出：写到 exports/日期-种类.md，同名重导出覆盖', () => {
  const { ws, db } = fresh();
  const a = saveExport(ws, { kind: '复诊准备', text: '# 复诊准备\n第一版' });
  assert.ok(a.path.startsWith(join(ws, 'exports')));
  assert.ok(a.path.endsWith('-复诊准备.md'), a.path);
  assert.ok(readFileSync(a.path, 'utf8').includes('第一版'));

  const b = saveExport(ws, { kind: '复诊准备', text: '# 复诊准备\n第二版' });
  assert.equal(b.path, a.path, '同一天同种类应是同一个文件');
  assert.ok(readFileSync(b.path, 'utf8').includes('第二版'), '导出物可重生成，覆盖即可');
  assert.throws(() => saveExport(ws, { kind: 'x', text: '   ' }), (e) => e.code === 'EXPORT_EMPTY');
  close(db);
});
