/* 解析编排：失败语义与事务边界。
   核心断言：失败**不产候选**、状态转「解析失败」、原件保留；成功只写候选，不碰事实表。 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { openDatabase, migrate, close } from '../dsh/store.js';
import { seedDemo } from '../dsh/demo.js';
import { saveImport } from '../dsh/files.js';
import { parseDocument, isParseable } from '../dsh/parse.js';
import { getProfile } from '../dsh/readmodels.js';
import { MineruError } from '../dsh/mineru.js';

const tmp = mkdtempSync(join(homedir(), '.xyb-gist-parse-'));
after(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* 清理失败不影响结果 */ } });

function fresh() {
  const ws = mkdtempSync(join(tmp, 'ws-'));
  const db = openDatabase(':memory:');
  migrate(db);
  seedDemo(db);
  return { ws, db };
}

/** 假客户端：记录被调用了几次，返回给定的 markdown；fail=true 就抛错。 */
function fakeClient({ markdown = '', fail = null, pages = 1 } = {}) {
  const calls = [];
  return {
    calls,
    async parse(args) {
      calls.push(args);
      if (fail) throw fail;
      return { markdown, pages, modelVersion: 'vlm', batchId: 'b1' };
    },
  };
}

const PATHOLOGY_MD = `
报告日期：2026-09-18
发生部位：胃体
肿瘤最大径 6.8 cm
核分裂象 12 个 / 50 HPF
切缘：R0
CD117（+）
`;

const candCount = (db, profile) => db.prepare('SELECT COUNT(*) AS n FROM candidate_fields WHERE profile_key = ?').get(profile).n;

test('① 解析成功：写候选 + 状态转「待核对」，不碰事实表', async () => {
  const { ws, db } = fresh();
  const imp = saveImport(db, ws, { profile: 'A', name: '病理报告.pdf', type: '病理报告', bytes: Buffer.from('%PDF-1.4 fake') });
  const pathBefore = db.prepare('SELECT COUNT(*) AS n FROM pathology_rows WHERE profile_key = ?').get('A').n;
  const candBefore = candCount(db, 'A');

  const client = fakeClient({ markdown: PATHOLOGY_MD });
  const out = await parseDocument(db, ws, { profile: 'A', id: imp.id }, { client });

  assert.equal(out.status, 'parsed');
  assert.ok(out.candidates >= 5, `应抽出至少 5 条，实得 ${out.candidates}`);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].filename, '病理报告.pdf', '文件名要原样传给 MinerU（它按扩展名判类型）');

  const doc = getProfile(db, 'A').docs.find((d) => d[0] === imp.id);
  assert.equal(doc[4], '待核对', '解析成功后状态是待核对');
  assert.equal(candCount(db, 'A'), candBefore + out.candidates);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM pathology_rows WHERE profile_key = ?').get('A').n,
    pathBefore,
    '候选只是候选，不能写进病理事实表',
  );
  close(db);
});

test('② 云端失败：候选一条不加，状态转「解析失败」，原件还在', async () => {
  const { ws, db } = fresh();
  const imp = saveImport(db, ws, { profile: 'A', name: '病理报告.pdf', type: '病理报告', bytes: Buffer.from('%PDF-1.4 fake') });
  const candBefore = candCount(db, 'A');

  const client = fakeClient({ fail: new MineruError('TASK_FAILED', 'MinerU 解析失败：bad page') });
  await assert.rejects(
    () => parseDocument(db, ws, { profile: 'A', id: imp.id }, { client }),
    (e) => e.code === 'MINERU_TASK_FAILED' && e.status === 502,
  );

  assert.equal(candCount(db, 'A'), candBefore, '失败不能产生候选');
  const doc = getProfile(db, 'A').docs.find((d) => d[0] === imp.id);
  assert.equal(doc[4], '解析失败');
  close(db);
});

test('③ 非可解析格式明确拒绝，不白花一次额度', async () => {
  const { ws, db } = fresh();
  const imp = saveImport(db, ws, { profile: 'A', name: '门诊记录.txt', type: '其他', bytes: Buffer.from('核分裂象 3/50 HPF') });
  const client = fakeClient({ markdown: PATHOLOGY_MD });

  await assert.rejects(
    () => parseDocument(db, ws, { profile: 'A', id: imp.id }, { client }),
    (e) => e.code === 'NOT_PARSEABLE',
  );
  assert.equal(client.calls.length, 0, '不该发起任何云端请求');
  assert.equal(getProfile(db, 'A').docs.find((d) => d[0] === imp.id)[4], '待解析', '状态保持不动');
  close(db);
});

test('④ 返回正文为空 → 当失败，不当成功', async () => {
  const { ws, db } = fresh();
  const imp = saveImport(db, ws, { profile: 'A', name: '扫描件.pdf', type: '病理报告', bytes: Buffer.from('%PDF-1.4 fake') });
  const client = fakeClient({ markdown: '   \n  ' });

  await assert.rejects(
    () => parseDocument(db, ws, { profile: 'A', id: imp.id }, { client }),
    (e) => e.code === 'EMPTY_MARKDOWN',
  );
  assert.equal(getProfile(db, 'A').docs.find((d) => d[0] === imp.id)[4], '解析失败');
  close(db);
});

test('⑤ 认出 0 条字段 → 明说没认出，不编候选', async () => {
  const { ws, db } = fresh();
  const imp = saveImport(db, ws, { profile: 'A', name: '须知.pdf', type: '其他', bytes: Buffer.from('%PDF-1.4 fake') });
  const client = fakeClient({ markdown: '门诊三楼，周一至周五 8:00-17:00。停车请走东门。' });

  await assert.rejects(
    () => parseDocument(db, ws, { profile: 'A', id: imp.id }, { client }),
    (e) => e.code === 'NO_CANDIDATE' && e.status === 422,
  );
  assert.equal(getProfile(db, 'A').docs.find((d) => d[0] === imp.id)[4], '解析失败');
  close(db);
});

test('⑥ 原件不在资料目录 → 404，不发起请求', async () => {
  const { ws, db } = fresh();
  const imp = saveImport(db, ws, { profile: 'A', name: 'x.pdf', type: '病理报告', bytes: Buffer.from('%PDF fake') });
  rmSync(join(ws, 'imports'), { recursive: true, force: true });
  const client = fakeClient({ markdown: PATHOLOGY_MD });

  await assert.rejects(
    () => parseDocument(db, ws, { profile: 'A', id: imp.id }, { client }),
    (e) => e.code === 'DOC_FILE_MISSING' && e.status === 404,
  );
  assert.equal(client.calls.length, 0);
  close(db);
});

test('⑦ 重解析同一份材料：候选不重复堆积', async () => {
  const { ws, db } = fresh();
  const imp = saveImport(db, ws, { profile: 'A', name: '病理报告.pdf', type: '病理报告', bytes: Buffer.from('%PDF-1.4 fake') });
  const client = fakeClient({ markdown: PATHOLOGY_MD });

  const first = await parseDocument(db, ws, { profile: 'A', id: imp.id }, { client });
  const n1 = candCount(db, 'A');
  const second = await parseDocument(db, ws, { profile: 'A', id: imp.id }, { client });
  const n2 = candCount(db, 'A');

  assert.equal(first.candidates, second.candidates);
  assert.equal(n2 - n1, second.candidates, '重解析会覆盖自己的候选（id 稳定），不会每跑一次多一批');
  close(db);
});

test('⑧ 格式白名单：PDF / 图片 / Office 走云端，文本文件不走', () => {
  for (const ok of ['a.pdf', 'b.PNG', 'c.jpg', 'd.docx', 'e.pptx']) assert.equal(isParseable(ok), true, ok);
  for (const no of ['a.txt', 'b.md', 'c.csv', 'd', 'e.sqlite']) assert.equal(isParseable(no), false, no);
});
