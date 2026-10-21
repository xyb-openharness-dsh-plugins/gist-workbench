/* HTTP 层：一个 /api 前缀的 JSON 接口 + public/ 静态文件。零依赖，只用 node:http / node:fs。
 *
 * 三件事这里说了算，别处不许再定一遍：
 * 1. 静态文件只在 public/ 目录内解析；`..` 一律拦掉（路径穿越），解析结果必须仍在根目录里。
 * 2. 未知 /api/* 返回 JSON 404，不返回 HTML（前端按 JSON 解析，收到 HTML 会报很难查的错）。
 * 3. assertWorkspacePath：资料目录必须由用户选定——主目录 / 桌面 / 下载根目录、/tmp、/var
 *    都在拒绝清单里，父目录不存在时不静默创建，把可读错误交回调用方去提示用户。 */

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { COMMANDS, CommandError } from './commands.js';
import { saveExport, saveImport, MAX_IMPORT_BYTES } from './files.js';

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
};

/* ---------------- 工作区路径校验 ---------------- */

/** 返回人类可读的问题；空数组＝可以用。调用方负责把问题提示给用户，这里不帮用户"猜一个目录"。 */
export function workspaceProblems(p) {
  if (typeof p !== 'string' || !p.trim()) return ['资料目录不能为空：需要你明确选择一个目录'];
  const target = resolve(p);
  const home = resolve(homedir());
  const problems = [];
  if (target === home) problems.push('不能用主目录当资料目录（会和个人文件混在一起）');
  if (target === '/tmp' || target.startsWith('/tmp' + sep) || target === '/var' || target.startsWith('/var' + sep)) {
    problems.push('不能用 /tmp 或 /var：系统可能会清理，资料会丢');
  }
  for (const name of ['Desktop', 'Downloads', 'Documents']) {
    const d = join(home, name);
    if (target === d) problems.push(`不能用「${name}」根目录当资料目录：请在它下面新建一个目录`);
  }
  if (!existsSync(dirname(target))) problems.push(`上级目录不存在：${dirname(target)}（不自动创建，请确认你选的位置）`);
  return problems;
}

/** 校验版：不合法就抛 Error。启动流程用它拦在打开数据库之前。 */
export function assertWorkspacePath(p) {
  const problems = workspaceProblems(p);
  if (problems.length) throw new Error(problems.join('；'));
  return resolve(p);
}

/* ---------------- 静态文件 ---------------- */

function safeJoin(root, urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const rel = clean.replace(/^\/+/, '');
  const full = resolve(root, rel || 'index.html');
  // 解析后必须仍在 root 内（含 root 自身）
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

function sendFile(res, file) {
  try {
    const st = statSync(file);
    if (!st.isFile()) return false;
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': 'no-cache',
    });
    createReadStream(file).pipe(res);
    return true;
  } catch {
    return false;
  }
}

/* ---------------- 路由 ---------------- */

/**
 * 把 public/ 下的文件按 urlPath 回出去（只读 GET/HEAD，路径穿越已拦）。
 * 独立启动与 DSH 宿主两条链路共用这一份，避免"本地能开、装进 Desktop 就 404"。
 * @returns {boolean} 是否已经写完响应
 */
export function servePublic(req, res, urlPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    res.end();
    return true;
  }
  const file = safeJoin(PUBLIC_DIR, urlPath);
  if (file && sendFile(res, file)) return true;
  // 单页应用：未知路径回 index.html，交给前端按 hash 路由
  return sendFile(res, join(PUBLIC_DIR, 'index.html'));
}

/* ---------------- 请求体 ---------------- */

const MAX_BODY = 64 * 1024;

/** 请求体解析失败的可诊断异常（与 commands.js 的 CommandError 同形，HTTP 层统一按 status 回）。 */
class BodyError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** 读 JSON 请求体。没有 content-type 也认（本机调用方就一个前端）；超长直接断开，不缓冲半截。 */
function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new BodyError('BODY_TOO_LARGE', `请求内容超过 ${MAX_BODY / 1024}KB，这不是一条记录该有的长度`, 413));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return reject(new BodyError('BODY_EMPTY', '请求内容是空的'));
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(new BodyError('BODY_NOT_OBJECT', '请求内容必须是一个 JSON 对象'));
        }
        return resolve(parsed);
      } catch {
        return reject(new BodyError('BODY_NOT_JSON', '请求内容不是合法 JSON'));
      }
    });
    req.on('error', (error) => reject(Object.assign(new BodyError('BODY_READ_FAILED', error.message), { status: 400 })));
  });
}

/** 读原始字节（导入原件用）。上限 40MB，超了立刻断，不把半个文件写进资料目录。 */
function readBytes(req, limit = MAX_IMPORT_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new BodyError('FILE_TOO_LARGE', `文件超过 ${Math.round(limit / 1024 / 1024)} MB 上限，未导入`, 413));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (error) => reject(Object.assign(new BodyError('BODY_READ_FAILED', error.message), { status: 400 })));
  });
}

export function createHandler({ workbench }) {
  return function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const path = url.pathname;

    const json = (code, body) => {
      const buf = Buffer.from(JSON.stringify(body), 'utf8');
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length });
      res.end(buf);
    };

    if (path === '/api/health') return json(200, { ok: true, version: workbench.version });
    if (path === '/api/bootstrap') {
      try {
        return json(200, workbench.bootstrap());
      } catch (error) {
        return json(500, { error: 'bootstrap_failed', message: error.message });
      }
    }

    /* 导入原件：原始字节 + 查询参数带元信息，不套 JSON/base64（40MB 的文件 base64 会胀三分之一）。 */
    if (path === '/api/import') {
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); return res.end(); }
      return readBytes(req).then((bytes) => {
        try {
          const out = saveImport(workbench.db, workbench.workspace, {
            profile: url.searchParams.get('profile') || '',
            name: url.searchParams.get('name') || '',
            type: url.searchParams.get('type') || '其他',
            bytes
          });
          return json(200, out);
        } catch (error) {
          if (error instanceof CommandError) return json(error.status, { error: error.code, message: error.message });
          return json(500, { error: 'import_failed', message: error.message });
        }
      }).catch((error) => json(error.status || 400, { error: error.code || 'BAD_REQUEST', message: error.message }));
    }

    /* 导出 Markdown 到资料目录 exports/ */
    if (path === '/api/export') {
      if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); return res.end(); }
      return readJson(req).then((body) => {
        try {
          return json(200, saveExport(workbench.workspace, body));
        } catch (error) {
          if (error instanceof CommandError) return json(error.status, { error: error.code, message: error.message });
          return json(500, { error: 'export_failed', message: error.message });
        }
      }).catch((error) => json(error.status || 400, { error: error.code || 'BAD_REQUEST', message: error.message }));
    }

    /* 写命令：只认 commands.js 的 COMMANDS 表，加命令只改那张表。
       只收 POST + JSON；请求体上限 64KB（这几个命令都是几十个字，超了基本是搞错了）。 */
    if (COMMANDS[path]) {
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' });
        return res.end();
      }
      return readJson(req).then((body) => {
        try {
          return json(200, COMMANDS[path](workbench.db, body));
        } catch (error) {
          if (error instanceof CommandError) return json(error.status, { error: error.code, message: error.message });
          return json(500, { error: 'command_failed', message: error.message });
        }
      }).catch((error) => json(error.status || 400, { error: error.code || 'BAD_REQUEST', message: error.message }));
    }

    if (path.startsWith('/api/')) return json(404, { error: 'not_found', path });

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      return res.end();
    }

    const file = safeJoin(PUBLIC_DIR, path);
    if (!file || !sendFile(res, file)) {
      // 单页应用：未知路径回 index.html，交给前端按 hash 路由
      if (sendFile(res, join(PUBLIC_DIR, 'index.html'))) return;
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404');
    }
  };
}

/** 起服务。port=0 时由系统分配（测试用），返回实际端口。 */
export function startWorkbenchServer({ port = 4173, host = '127.0.0.1', workbench }) {
  if (!workbench) throw new Error('startWorkbenchServer 需要一个 workbench 实例');
  const server = createServer(createHandler({ workbench }));
  return new Promise((res, rej) => {
    server.once('error', rej);
    server.listen(port, host, () => {
      const actual = server.address().port;
      res({ server, port: actual, host, url: `http://${host}:${actual}/` });
    });
  });
}
