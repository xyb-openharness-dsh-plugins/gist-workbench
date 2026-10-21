/* HTTP 层：健康检查 / bootstrap / 静态文件 / 未知接口 / 路径穿越 / 资料目录校验。
 *
 * 起真实服务（port:0 由系统分配），只用内置 fetch。测完必须关 server 与 db，
 * 否则 node --test 进程不会退出。 */

import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { Workbench, validateWorkspacePath } from '../dsh/workbench.js';
import { startWorkbenchServer } from '../dsh/server.js';

const tmp = mkdtempSync(join(homedir(), '.xyb-gastric-server-'));
after(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* 清理失败不影响结果 */ } });

async function withServer(fn) {
  const workbench = await Workbench.open(join(tmp, 'workspace'));
  const { server, port, url } = await startWorkbenchServer({ port: 0, host: '127.0.0.1', workbench });
  try {
    await fn({ url, port, workbench });
  } finally {
    await new Promise((r) => server.close(r));
    workbench.close();
  }
}

test('① /api/health 返回 ok 与版本', async () => {
  await withServer(async ({ url }) => {
    const r = await fetch(`${url}api/health`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.ok, true);
    assert.match(j.version, /^\d+\.\d+\.\d+/);
  });
});

test('② /api/bootstrap 返回三个档案与临床研究，且与原型数据同形', async () => {
  await withServer(async ({ url }) => {
    const r = await fetch(`${url}api/bootstrap`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.deepEqual(Object.keys(j.profiles).sort(), ['A', 'B', 'C']);
    assert.ok(j.profiles.A.metrics.length > 10);
    assert.ok(j.profiles.A.docs.length >= 1, '病情整理的资料库要随档案返回');
    assert.equal(j.trials.length, 16, '演示试验行应与资料包条数一致');
    assert.equal(j.agent.available, true, '开发版自带挂载位演示');
  });
});

test('③ 静态文件：/ → index.html，app.js / style.css / topbar.css 可取', async () => {
  await withServer(async ({ url }) => {
    for (const path of ['', 'index.html', 'app.js', 'style.css', 'topbar.css']) {
      const r = await fetch(url + path);
      assert.equal(r.status, 200, `${path} 应可取，实际 ${r.status}`);
      assert.ok((await r.text()).length > 50, `${path} 内容不应为空`);
    }
    const html = await (await fetch(url)).text();
    assert.ok(html.includes('id="agent-toggle"'), '顶栏主按钮在骨架里');
    assert.ok(html.includes('id="top-hint"'), '顶栏中区说明在骨架里');
  });
});

test('④ 未知 /api/* 返回 JSON 404，不是 HTML', async () => {
  await withServer(async ({ url }) => {
    const r = await fetch(`${url}api/nope`);
    assert.equal(r.status, 404);
    assert.match(r.headers.get('content-type'), /application\/json/);
    assert.equal((await r.json()).error, 'not_found');
  });
});

test('⑤ 路径穿越被拦：../../package.json 拿不到仓库文件', async () => {
  await withServer(async ({ url }) => {
    for (const evil of ['../package.json', '..%2F..%2Fpackage.json', '/../../etc/hosts']) {
      const r = await fetch(url + evil, { redirect: 'manual' });
      const body = r.status === 200 ? await r.text() : '';
      assert.ok(!body.includes('"name": "@xyb-community'), `${evil} 不应返回 package.json 内容`);
    }
  });
});

test('⑥ 资料目录校验：主目录 / 桌面根 / /tmp 一律拒绝，正常目录放行', () => {
  const home = homedir();
  assert.ok(validateWorkspacePath(home).length > 0, '主目录应被拒绝');
  assert.ok(validateWorkspacePath(join(home, 'Desktop')).length > 0, '桌面根目录应被拒绝');
  assert.ok(validateWorkspacePath('/tmp').length > 0, '/tmp 应被拒绝');
  assert.ok(validateWorkspacePath('').length > 0, '空路径应被拒绝');
  assert.deepEqual(validateWorkspacePath(join(home, 'Documents', 'GistPalWorkspace')), []);
});

/* ---------------- 写接口（M2 第二段） ---------------- */

const post = (url, path, body) => fetch(url + path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const today = () => new Date().toISOString().slice(0, 10);

test('⑦ POST /api/adherence：写进去后 bootstrap 能读到，重复提交幂等', async () => {
  await withServer(async ({ url }) => {
    const body = { profile: 'A', date: today(), drug: '伊马替尼', planned: '400 mg', taken: '400 mg' };
    const r1 = await post(url, 'api/adherence', body);
    assert.equal(r1.status, 200);
    const j1 = await r1.json();
    assert.equal(j1.ok, true);
    assert.ok(['created', 'unchanged'].includes(j1.status));

    const r2 = await post(url, 'api/adherence', body);
    const j2 = await r2.json();
    assert.equal(j2.status, 'unchanged', '同一份内容再提交应幂等');

    const boot = await (await fetch(`${url}api/bootstrap`)).json();
    const hit = boot.profiles.A.adherence.rows.find((row) => row[0] === body.date && row[1] === '伊马替尼');
    assert.ok(hit, '服药分节里应能读到刚写的那一条');
    assert.equal(hit[3], '400 mg');
  });
});

test('⑧ 写接口的拒绝路径：GET 405 / 坏 JSON 400 / 未知档案 404 / 缺字段 400', async () => {
  await withServer(async ({ url }) => {
    const g = await fetch(`${url}api/adherence`);
    assert.equal(g.status, 405, '写命令不接受 GET');
    assert.equal(g.headers.get('allow'), 'POST');

    const bad = await post(url, 'api/adherence', '{不是 json');
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'BODY_NOT_JSON');

    const noProfile = await post(url, 'api/viewpoints', { profile: 'ZZ', date: today(), text: '在吗' });
    assert.equal(noProfile.status, 404);
    assert.equal((await noProfile.json()).error, 'PROFILE_NOT_FOUND');

    const noText = await post(url, 'api/viewpoints', { profile: 'A', date: today(), text: '' });
    assert.equal(noText.status, 400);
    assert.equal((await noText.json()).error, 'FIELD_REQUIRED');
  });
});

