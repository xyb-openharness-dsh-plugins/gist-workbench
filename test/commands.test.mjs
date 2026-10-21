/* 写命令（M2 第二段）：四条命令的校验、幂等、更正只新增版本、以及"写进去能读出来"。
 *
 * 这一层不比 HTML，比的是「库里的行」与「读模型出来的形状」——
 * 写接口最容易出的 bug 不是抛错，而是写进去了、读模型看不见（ord 排序 / 分节标题 / 类型不对）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase, migrate, close } from '../dsh/store.js';
import { seedDemo } from '../dsh/demo.js';
import { getProfile } from '../dsh/readmodels.js';
import {
  recordAdherence, recordSideEffect, recordMetricPoint, recordViewpoint, COMMANDS, CommandError
} from '../dsh/commands.js';

const TODAY = () => new Date().toISOString().slice(0, 10);
const YDAY = () => {
  const t = new Date(Date.now() - 86400000);
  return t.toISOString().slice(0, 10);
};

function freshDb() {
  const db = openDatabase(':memory:');
  migrate(db);
  seedDemo(db);
  return db;
}

test('① 服药：同一天同一药重复提交只写一行', () => {
  const db = freshDb();
  const body = { profile: 'A', date: YDAY(), drug: '伊马替尼', planned: '400 mg', taken: '400 mg' };

  const first = recordAdherence(db, body);
  assert.equal(first.status, 'created');
  const again = recordAdherence(db, body);
  assert.equal(again.status, 'unchanged', '同样内容再提交应为 unchanged');

  const n = db.prepare('SELECT COUNT(*) AS c FROM adherence_rows WHERE profile_key = ? AND d = ? AND drug = ?')
    .get('A', body.date, '伊马替尼').c;
  assert.equal(n, 1, '不该写第二行');
  close(db);
});

test('② 服药：改了内容 → 追加新版本，旧行保留（契约② 更正只新增版本）', () => {
  const db = freshDb();
  const d = YDAY();
  recordAdherence(db, { profile: 'A', date: d, drug: '伊马替尼', planned: '400 mg', taken: '400 mg' });
  const fix = recordAdherence(db, { profile: 'A', date: d, drug: '伊马替尼', planned: '400 mg', taken: '300 mg', note: '当天减量' });

  assert.equal(fix.status, 'superseded');
  const all = db.prepare('SELECT taken, ord FROM adherence_rows WHERE profile_key = ? AND d = ? AND drug = ? ORDER BY ord')
    .all('A', d, '伊马替尼');
  assert.equal(all.length, 2, '旧版本必须留着');
  assert.deepEqual(all.map((r) => r.taken), ['400 mg', '300 mg']);
  assert.deepEqual(all.map((r) => r.ord), [1, 2]);
  close(db);
});

test('③ 不良事件：分级与处理按原文存，写入后能在档案里读出来', () => {
  const db = freshDb();
  recordSideEffect(db, { profile: 'A', date: YDAY(), term: '眼睑水肿', grade: '1 级', action: '继续原剂量' });

  const p = getProfile(db, 'A');
  // 副作用行是变长数组 [日期, 症状, 分级, 处理, 备注]
  const hit = p.sideEffects.rows.find((r) => r[1] === '眼睑水肿');
  assert.ok(hit, `副作用分节里应能看到新记录，实际：${JSON.stringify(p.sideEffects.rows.at(-1))}`);
  assert.equal(hit[2], '1 级');
  assert.equal(hit[3], '继续原剂量');
  close(db);
});

test('④ 指标点：数值指标收数字也收数字字符串，同一天改值追加版本', () => {
  const db = freshDb();
  const d = YDAY();

  const a = recordMetricPoint(db, { profile: 'A', date: d, metric: 'hgb', value: '99', src: '社区化验' });
  assert.equal(a.status, 'created');
  assert.equal(a.point.v, 99, '落库应为数字，dec=0 时取整');

  const b = recordMetricPoint(db, { profile: 'A', date: d, metric: 'hgb', value: 101, src: '社区化验' });
  assert.equal(b.status, 'superseded');

  const p = getProfile(db, 'A');
  const hgb = p.metrics.find((m) => m.key === 'hgb');
  const sameDay = hgb.points.filter((x) => x.d === d);
  assert.ok(sameDay.length >= 1);
  assert.equal(typeof sameDay.at(-1).v, 'number', '读出来必须是数字，不是字符串');
  assert.equal(sameDay.at(-1).v, 101, '读模型取最后一条（ord 最大）');
  close(db);
});

test('⑤ 指标点：分类指标存原文；未定义的指标名直接拒绝', () => {
  const db = freshDb();
  const g = recordMetricPoint(db, { profile: 'A', date: YDAY(), metric: 'fatigue', value: '2 级' });
  assert.equal(g.point.v, '2 级', '分类指标存原文文本');

  assert.throws(
    () => recordMetricPoint(db, { profile: 'A', date: YDAY(), metric: 'cea', value: 3.2 }),
    (e) => e instanceof CommandError && e.code === 'METRIC_NOT_FOUND',
    'GIST 没有 CEA 这个指标，必须报错而不是新建一条线'
  );
  close(db);
});

test('⑥ 校验：未来日期 / 假日期 / 档案不存在 / 空内容都拒绝，且不写库', () => {
  const db = freshDb();
  const before = db.prepare('SELECT COUNT(*) AS c FROM viewpoints').get().c;

  assert.throws(() => recordViewpoint(db, { profile: 'A', date: '2999-01-01', text: '提前记' }),
    (e) => e.code === 'DATE_FUTURE');
  assert.throws(() => recordViewpoint(db, { profile: 'A', date: '2026-02-30', text: '不存在的日子' }),
    (e) => e.code === 'DATE_INVALID');
  assert.throws(() => recordViewpoint(db, { profile: 'Z', date: YDAY(), text: '没有这个档案' }),
    (e) => e.code === 'PROFILE_NOT_FOUND' && e.status === 404);
  assert.throws(() => recordViewpoint(db, { profile: 'A', date: YDAY(), text: '   ' }),
    (e) => e.code === 'FIELD_REQUIRED');

  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM viewpoints').get().c, before, '被拒的请求一条都不该落库');
  close(db);
});

test('⑦ 看法：只存原话，返回里没有任何评估字段（契约① 看法恒不为结论）', () => {
  const db = freshDb();
  const out = recordViewpoint(db, { profile: 'C', date: TODAY(), mood: '发怵', text: '还是想早点手术，怕一直吃药' });

  assert.equal(out.status, 'created');
  assert.deepEqual(Object.keys(out.row).sort(), ['d', 'mood', 'text'], '返回值里不该有结论类字段');
  const p = getProfile(db, 'C');
  // 看法行是变长数组 [日期, 心情, 原话]
  assert.ok(p.viewpoints.some((r) => r[1] === '发怵' && String(r[2]).includes('怕一直吃药')));
  close(db);
});

test('⑧ 命令表与路由一致：四条命令都是函数，路径以 /api/ 开头', () => {
  const paths = Object.keys(COMMANDS);
  assert.deepEqual(paths.sort(), ['/api/adherence', '/api/metric-points', '/api/side-effects', '/api/viewpoints']);
  for (const p of paths) {
    assert.ok(p.startsWith('/api/'), `${p} 必须挂在 /api/ 下`);
    assert.equal(typeof COMMANDS[p], 'function');
  }
});
