/* MinerU 客户端：协议顺序、错误语义、Token 不外泄。
   全部离线：fetchImpl 注入假的，ZIP 用 stored（method 0）手搓一个，不需要外部工具。 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import { MineruClient, MineruError, maskToken, modelFallbackWorthy } from '../dsh/mineru.js';
import { readZip } from '../lib/zip.js';

const tmp = mkdtempSync(join(homedir(), '.xyb-gist-mineru-'));
after(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ } });

/* ---------- 最小的 stored ZIP 生成器（只为测试 lib/zip.js） ---------- */
function storedZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);      // method 0 = stored
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(0, 14);     // crc 不校验（我们的读取器不解 CRC）
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt32LE(0, 12);
    cd.writeUInt32LE(0, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    centrals.push(cd, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

const MD = '# 病理报告\n核分裂象 12 个 / 50 HPF\n';

/** 按调用顺序回放响应；fetchImpl 记录每次请求。 */
function replay(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    const hit = routes.find((r) => (typeof r.match === 'string' ? url.includes(r.match) : r.match.test(url)));
    if (!hit) throw new Error(`测试没准备这个请求：${init.method || 'GET'} ${url}`);
    return hit.response();
  };
  return { impl, calls };
}

const okJson = (body) => () => ({ ok: true, status: 200, json: async () => body });
const bin = (buf) => () => ({ ok: true, status: 200, arrayBuffer: async () => buf });

test('① Token 优先级：显式 > 环境变量 > 密钥文件；都没有就 NO_TOKEN', () => {
  const secret = join(tmp, 'secret.json');
  writeFileSync(secret, JSON.stringify({ token: 'sk-from-file-key' }), 'utf8');

  const c1 = new MineruClient({ token: 'sk-explicit', env: { MINERU_TOKEN: 'sk-env' }, secretFile: secret, fetchImpl: () => {} });
  assert.equal(c1.token, 'sk-explicit');
  assert.equal(c1.tokenSource, 'explicit');

  const c2 = new MineruClient({ env: { MINERU_TOKEN: 'sk-env' }, secretFile: secret, fetchImpl: () => {} });
  assert.equal(c2.token, 'sk-env');
  assert.equal(c2.tokenSource, 'env:MINERU_TOKEN');

  const c3 = new MineruClient({ env: {}, secretFile: secret, fetchImpl: () => {} });
  assert.equal(c3.token, 'sk-from-file-key');

  assert.throws(
    () => new MineruClient({ env: {}, secretFile: join(tmp, 'nope.json'), fetchImpl: () => {} }),
    (e) => e instanceof MineruError && e.code === 'NO_TOKEN' && /MINERU_TOKEN/.test(e.message),
  );
});

test('② 掩码：只露前 4 后 2，短 token 全遮', () => {
  assert.equal(maskToken('sk-demo00000000TEST'), 'sk-d****ST');
  assert.equal(maskToken('short'), '****');
  assert.equal(maskToken(''), '(空)');
});

test('③ 401 的错误消息只带掩码，不带整串', async () => {
  const token = 'sk-demo0000000000000000TESTTOKENxyz';
  const client = new MineruClient({
    token, env: {}, fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
  });
  await assert.rejects(
    () => client.createUploadBatch({ files: [{ name: 'a.pdf' }] }),
    (e) => {
      assert.equal(e.code, 'UNAUTHORIZED');
      assert.equal(e.message.includes(token), false, '错误消息里绝不能出现完整 Token');
      assert.match(e.message, /sk-d\*\*\*\*yz/, '掩码只留前 4 后 2');
      return true;
    },
  );
});

test('④ 完整协议顺序：批 → PUT（不设 Content-Type）→ 轮询 → 下载 → full.md', async () => {
  const zip = storedZip({ 'full.md': MD, 'paper_content_list.json': JSON.stringify([{ page_idx: 0 }, { page_idx: 1 }]) });
  const { impl, calls } = replay([
    { match: '/file-urls/batch', response: okJson({ code: 0, data: { batch_id: 'b-1', file_urls: ['https://upload.example/put-1'] } }) },
    { match: 'upload.example', response: () => ({ ok: true, status: 200 }) },
    {
      match: '/extract-results/batch/b-1',
      response: okJson({ code: 0, data: { extract_result: [{ file_name: 'a.pdf', state: 'done', full_zip_url: 'https://zip.example/r.zip' }] } }),
    },
    { match: 'zip.example', response: bin(zip) },
  ]);

  const client = new MineruClient({ token: 'sk-test', env: {}, fetchImpl: impl });
  const out = await client.parse({ bytes: Buffer.from('%PDF-1.4'), filename: 'a.pdf' });

  assert.equal(out.markdown.trim(), MD.trim());
  assert.equal(out.pages, 2, '页数从 content_list 的 page_idx 上限推');
  assert.equal(calls.length, 4);
  assert.equal(calls[1].method, 'PUT');
  assert.equal(
    Object.keys(calls[1].headers).some((h) => h.toLowerCase() === 'content-type'),
    false,
    '上传那步设了 Content-Type 会被 MinerU 拒',
  );
});

test('⑤ 任务 failed：不返回半份结果，抛 TASK_FAILED', async () => {
  const { impl } = replay([
    { match: '/file-urls/batch', response: okJson({ code: 0, data: { batch_id: 'b-2', file_urls: ['https://upload.example/put-2'] } }) },
    { match: 'upload.example', response: () => ({ ok: true, status: 200 }) },
    {
      match: '/extract-results/batch/b-2',
      response: okJson({ code: 0, data: { extract_result: [{ file_name: 'a.pdf', state: 'failed', err_msg: '文件损坏' }] } }),
    },
  ]);
  const client = new MineruClient({ token: 'sk-test', env: {}, fetchImpl: impl });
  await assert.rejects(
    () => client.parse({ bytes: Buffer.from('%PDF'), filename: 'a.pdf' }),
    (e) => e.code === 'TASK_FAILED' && /文件损坏/.test(e.message),
  );
});

test('⑥ 业务码非 0 → API_ERROR；ZIP 里没有 full.md → NO_MARKDOWN', async () => {
  const bad = new MineruClient({
    token: 'sk-test', env: {},
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ code: -60012, msg: 'task not found or expire' }) }),
  });
  await assert.rejects(() => bad.createUploadBatch({ files: [{ name: 'a.pdf' }] }), (e) => e.code === 'API_ERROR');

  const noMd = storedZip({ 'other.txt': 'hi' });
  const { impl } = replay([
    { match: '/file-urls/batch', response: okJson({ code: 0, data: { batch_id: 'b-3', file_urls: ['https://upload.example/put-3'] } }) },
    { match: 'upload.example', response: () => ({ ok: true, status: 200 }) },
    {
      match: '/extract-results/batch/b-3',
      response: okJson({ code: 0, data: { extract_result: [{ state: 'done', full_zip_url: 'https://zip.example/r3.zip' }] } }),
    },
    { match: 'zip.example', response: bin(noMd) },
  ]);
  const client = new MineruClient({ token: 'sk-test', env: {}, fetchImpl: impl });
  await assert.rejects(() => client.parse({ bytes: Buffer.from('%PDF'), filename: 'a.pdf' }), (e) => e.code === 'NO_MARKDOWN');
});

test('⑦ 只有「模型参数被拒」才换模型重试，文件失败不重试', () => {
  assert.equal(modelFallbackWorthy(new MineruError('API_ERROR', 'model_version not supported')), true);
  assert.equal(modelFallbackWorthy(new MineruError('API_ERROR', 'invalid param: model')), true);
  assert.equal(modelFallbackWorthy(new MineruError('TASK_FAILED', '文件损坏')), false);
  assert.equal(modelFallbackWorthy(new MineruError('TIMEOUT', 'model timeout')), false);
  assert.equal(modelFallbackWorthy(null), false);
});

test('⑧ lib/zip.js：能列出条目、取文本，缺条目报错而不是返回空串', () => {
  const zip = readZip(storedZip({ 'a/full.md': MD, 'b.json': '{"x":1}' }));
  assert.deepEqual(zip.names.sort(), ['a/full.md', 'b.json']);
  assert.equal(zip.has('full.md'), true, '多层目录里的 full.md 也要能找到');
  assert.equal(zip.text('full.md').trim(), MD.trim());
  assert.throws(() => zip.text('missing.md'), /没有这个条目/);
});
