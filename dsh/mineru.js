/**
 * MinerU 云端解析客户端（GIST 工作台 · 解析接入层）。
 *
 * 协议来源：https://mineru.net/doc/docs （API v4）。本文件只封装**四个动作**：
 *   ① `POST /file-urls/batch` 申请上传链接 → ② `PUT` 上传原件 → ③ 轮询 `GET /extract-results/batch/{id}`
 *   → ④ 下载 `full_zip_url` 并取出 `full.md` 与 `*_content_list.json`。
 *
 * 三条边界：
 * 1. **Token 只从环境或本地私密文件来**，不写进仓库、不进日志、不进错误消息（错误里只给来源与掩码）；
 * 2. **不猜解析结果**：拿不到 `full.md` 就是失败，不返回半份数据当成功；
 * 3. **解析失败不产生候选**——调用方（`dsh/parse.js`）拿到异常后把 documents 标成 `解析失败`，
 *    原件留着可重试；不做"云端失败就本地正则凑一份"的静默降级（两套口径的数据没法比较）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { readZip } from '../lib/zip.js'

export const MINERU_BASE_URL = 'https://mineru.net/api/v4'
/** 本地私密文件：已进 .gitignore，不进包（package.json 的 files 不含 .secrets） */
export const MINERU_SECRET_FILE = fileURLToPath(new URL('../.secrets/mineru.json', import.meta.url))

export class MineruError extends Error {
  constructor(code, message, detail = null) {
    super(message)
    this.name = 'MineruError'
    this.code = code
    this.detail = detail
  }
}

/** 只露前 4 位与后 2 位，用于"到底用的哪把 key"的排查，不可反推。 */
export function maskToken(token) {
  if (!token) return '(空)'
  if (token.length <= 8) return '****'
  return `${token.slice(0, 4)}****${token.slice(-2)}`
}

/**
 * Token 解析优先级：显式传入 > `.secrets/mineru.json` > 环境变量 `MINERU_TOKEN`。
 * 文件优先、env 次之（2026-10-22 统一口径）：界面里保存的 Token 永远生效，
 * env 只在文件缺失时兜底——否则一条遗留的过期 env 会长期盖住新存的 Token，
 * 表现为"换了 Token 还是 401"，极难自查。
 * 三处都没有就报 `NO_TOKEN`，**不静默用匿名请求**（那只会得到一个看不懂的 401）。
 */
export function resolveToken({ token = null, env = process.env, secretFile = MINERU_SECRET_FILE } = {}) {
  if (token?.trim()) return { token: token.trim(), source: 'explicit' }
  try {
    const parsed = JSON.parse(readFileSync(secretFile, 'utf8'))
    if (parsed?.token?.trim()) return { token: parsed.token.trim(), source: `.secrets/mineru.json` }
  } catch {
    /* 文件不存在或不是 JSON 都视为"没配"，不掩盖真正的问题 */
  }
  if (env?.MINERU_TOKEN?.trim()) return { token: env.MINERU_TOKEN.trim(), source: 'env:MINERU_TOKEN' }
  throw new MineruError(
    'NO_TOKEN',
    '没有 MinerU Token：设置环境变量 MINERU_TOKEN，或写 .secrets/mineru.json（{"token": "sk-..."}）。该文件已在 .gitignore 里。',
  )
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 解析模型：默认 `pipeline`，接口不接受这个参数时退回 `vlm`。
 *
 * 历史（2026-10-21 实测）：同一份靠空格分列的检验单 PDF，`pipeline` 会把整张表压成 3 个 `<td>`，
 * 210 / 22 直接丢失，抽取出 0 条候选；`vlm` 还原成 4 列、5/5 全中。当时因此默认改成了 vlm。
 *
 * 2026-10-22 统一口径决定：**默认回到 pipeline**（跨工作台统一，便于比较解析结果）。
 * 代价是上面那类压平表格可能丢列，核对时留意；调用方显式传 `modelVersion: 'vlm'` 可覆盖。
 */
export const MINERU_MODEL_DEFAULT = 'pipeline'
export const MINERU_MODEL_FALLBACK = 'vlm'

/** 这个错误值得换模型再试一次吗？只认"模型参数本身不被接受"，不认文件失败。 */
export function modelFallbackWorthy(error) {
  if (!error) return false
  if (!['API_ERROR', 'BAD_INPUT'].includes(error.code)) return false
  return /model|模型|version|版本|参数|param/i.test(String(error.message ?? ''))
}

export class MineruClient {
  /**
   * @param {object} opts
   * @param {string} [opts.token] 不给就按 resolveToken 的顺序找
   * @param {string} [opts.baseUrl]
   * @param {Function} [opts.fetchImpl] 注入用（单测不联网）
   * @param {number} [opts.requestTimeoutMs] 单次请求超时
   */
  constructor({
    token = null, baseUrl = MINERU_BASE_URL, fetchImpl = null,
    requestTimeoutMs = 60000, env = process.env, secretFile = MINERU_SECRET_FILE,
  } = {}) {
    const resolved = resolveToken({ token, env, secretFile })
    this.token = resolved.token
    this.tokenSource = resolved.source
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.fetchImpl = fetchImpl ?? globalThis.fetch
    this.requestTimeoutMs = requestTimeoutMs
  }

  get maskedToken() {
    return maskToken(this.token)
  }

  async #request(method, path, { body = null, raw = false } = {}) {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`
    const headers = { Authorization: `Bearer ${this.token}`, Accept: '*/*' }
    if (body !== null && !raw) headers['Content-Type'] = 'application/json'

    const signal = AbortSignal.timeout(this.requestTimeoutMs)
    let response
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: raw ? body : body === null ? undefined : JSON.stringify(body),
        signal,
      })
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new MineruError('TIMEOUT', `MinerU 请求超时（${method} ${url}）`, { url })
      }
      throw new MineruError('NETWORK', `请求 MinerU 失败：${error.message}`, { url })
    }

    if (response.status === 401 || response.status === 403) {
      throw new MineruError(
        'UNAUTHORIZED',
        `MinerU 拒绝了这个 Token（HTTP ${response.status}，来源 ${this.tokenSource}，key=${this.maskedToken}）`,
        { status: response.status },
      )
    }

    if (raw) {
      if (!response.ok) throw new MineruError('UPLOAD_FAILED', `上传文件失败：HTTP ${response.status}`)
      return null
    }

    let json = null
    try {
      json = await response.json()
    } catch {
      throw new MineruError('BAD_RESPONSE', `MinerU 返回的不是 JSON（HTTP ${response.status}）`, { url })
    }
    if (json?.code !== 0) {
      const message = String(json?.msg ?? '未知错误')
      const code = /token|auth|权限|登录/i.test(message) ? 'UNAUTHORIZED' : 'API_ERROR'
      throw new MineruError(code, `MinerU 接口报错（code=${json?.code}）：${message}`, {
        apiCode: json?.code, traceId: json?.trace_id,
      })
    }
    return json
  }

  /** ① 申请上传链接。返回 batchId 与一一对应的 PUT 地址。 */
  async createUploadBatch({ files, enableFormula = true, enableTable = true, language = 'ch', modelVersion = null, pageRanges = null }) {
    if (!Array.isArray(files) || files.length === 0) {
      throw new MineruError('BAD_INPUT', 'createUploadBatch 需要至少一个文件')
    }
    const body = {
      enable_formula: enableFormula,
      enable_table: enableTable,
      language,
      files: files.map((f) => ({ name: f.name, ...(f.dataId ? { data_id: f.dataId } : {}) })),
    }
    if (modelVersion) body.model_version = modelVersion
    if (pageRanges) body.page_ranges = pageRanges

    const json = await this.#request('POST', '/file-urls/batch', { body })
    const batchId = json?.data?.batch_id
    const urls = json?.data?.file_urls
    if (!batchId || !Array.isArray(urls) || urls.length !== files.length) {
      throw new MineruError('BAD_RESPONSE', '申请上传链接的返回不完整（缺 batch_id 或 file_urls 数量对不上）', {
        got: json?.data,
      })
    }
    return { batchId, uploadUrls: urls }
  }

  /** ② 上传原件。MinerU 要求**不设 Content-Type**，所以这里走 raw。 */
  async uploadFile(uploadUrl, bytes) {
    await this.#request('PUT', uploadUrl, { body: bytes, raw: true })
    return { ok: true }
  }

  /** ③ 查一次批次结果。 */
  async getBatchResult(batchId) {
    const json = await this.#request('GET', `/extract-results/batch/${batchId}`)
    const results = json?.data?.extract_result
    if (!Array.isArray(results)) {
      throw new MineruError('BAD_RESPONSE', '批次结果里没有 extract_result 数组', { got: json?.data })
    }
    return results.map((r) => ({
      fileName: r.file_name ?? null,
      state: r.state ?? null,
      zipUrl: r.full_zip_url ?? null,
      errMsg: r.err_msg ?? null,
      dataId: r.data_id ?? null,
      progress: r.extract_progress ?? null,
    }))
  }

  /** ③ 轮询到全部结束（done / failed）或超时。 */
  async waitForBatch(batchId, { intervalMs = 3000, timeoutMs = 300000, onProgress = null } = {}) {
    const startedAt = Date.now()
    for (;;) {
      const results = await this.getBatchResult(batchId)
      if (onProgress) onProgress(results)
      const pending = results.filter((r) => r.state !== 'done' && r.state !== 'failed')
      if (pending.length === 0) return results
      if (Date.now() - startedAt > timeoutMs) {
        throw new MineruError(
          'TIMEOUT',
          `等了 ${Math.round(timeoutMs / 1000)} 秒还没解析完（batch=${batchId}，仍在 ${[...new Set(pending.map((p) => p.state))].join('/')}）`,
          { batchId, results },
        )
      }
      await sleep(intervalMs)
    }
  }

  /** ④ 下载结果压缩包（不落盘，直接读内存）。 */
  async downloadZip(zipUrl) {
    let response
    try {
      response = await this.fetchImpl(zipUrl, { signal: AbortSignal.timeout(this.requestTimeoutMs) })
    } catch (error) {
      throw new MineruError('NETWORK', `下载解析结果失败：${error.message}`, { zipUrl })
    }
    if (!response.ok) throw new MineruError('DOWNLOAD_FAILED', `下载解析结果失败：HTTP ${response.status}`, { zipUrl })
    return Buffer.from(await response.arrayBuffer())
  }

  /**
   * 完整跑一遍：申请 → 上传 → 轮询 → 下载 → 取出 markdown 与 content_list。
   * 任一环节失败都抛异常，**不返回半份结果**。
   */
  async parse({
    bytes, filename, dataId = null, intervalMs = 3000, timeoutMs = 300000,
    enableFormula = true, enableTable = true, language = 'ch',
    modelVersion = MINERU_MODEL_DEFAULT, pageRanges = null,
  }) {
    if (!bytes || bytes.length === 0) throw new MineruError('BAD_INPUT', '文件内容为空，不提交解析')
    if (!filename?.trim()) throw new MineruError('BAD_INPUT', '缺少文件名（MinerU 按扩展名判类型）')

    const { batchId, uploadUrls } = await this.createUploadBatch({
      files: [{ name: filename.trim(), dataId }],
      enableFormula, enableTable, language, modelVersion, pageRanges,
    })
    await this.uploadFile(uploadUrls[0], bytes)
    const results = await this.waitForBatch(batchId, { intervalMs, timeoutMs })
    const first = results[0]

    if (first.state !== 'done') {
      throw new MineruError('TASK_FAILED', `MinerU 解析失败：${first.errMsg || first.state}`, { batchId, result: first })
    }
    if (!first.zipUrl) throw new MineruError('BAD_RESPONSE', '解析完成但没有返回 full_zip_url', { batchId, result: first })

    const zipBuffer = await this.downloadZip(first.zipUrl)
    let zip
    try {
      zip = readZip(zipBuffer)
    } catch (error) {
      throw new MineruError('BAD_ZIP', `解析结果不是可读的 ZIP：${error.message}`, { batchId })
    }
    if (!zip.has('full.md')) {
      throw new MineruError('NO_MARKDOWN', `解析结果里没有 full.md（实际条目：${zip.names.slice(0, 8).join(', ')}）`, {
        names: zip.names,
      })
    }

    const markdown = zip.text('full.md')
    const contentListName = zip.names.find((n) => n.endsWith('_content_list.json')) ?? null
    let contentList = null
    if (contentListName) {
      try {
        contentList = JSON.parse(zip.text(contentListName))
      } catch (error) {
        throw new MineruError('BAD_CONTENT_LIST', `content_list 不是合法 JSON：${error.message}`, { contentListName })
      }
    }

    // 批次接口在 done 后不再返回 extract_progress，页数改从 content_list 的 page_idx 上限推；
    // 两处都没有就留 null（不拿文件大小之类的猜一个）。
    const pagesFromList = Array.isArray(contentList) && contentList.length
      ? Math.max(...contentList.map((item) => (Number.isInteger(item?.page_idx) ? item.page_idx + 1 : 0)))
      : null
    return {
      batchId,
      zipUrl: first.zipUrl,
      markdown,
      contentList,
      pages: first.progress?.total_pages ?? pagesFromList ?? null,
      modelVersion,
      names: zip.names,
    }
  }
}

export function createMineruClient(options = {}) {
  return new MineruClient(options)
}
