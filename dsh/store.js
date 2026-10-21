/**
 * 数据层入口（slice 1）：开库、迁移、关库。零依赖，只用内置 `node:sqlite`。
 *
 * 三条边界：
 * 1. **路径由调用方给**：这里不猜资料目录在哪，也不替用户建目录（A21/A22）；
 * 2. **迁移只增不改**：按文件名顺序执行 `schema/00*.sql`，执行过就跳过（幂等）；
 *    已执行的文件被改动由 `npm run check:schema` 拦，不在这里猜该怎么办；
 * 3. **错误要能诊断**：开库/迁移/关库各自 try/catch，抛出带 code 的异常，
 *    让 `scripts/dev-server.mjs` 能把它翻译成一句人话，而不是甩一段堆栈给使用者。
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SCHEMA_DIR = fileURLToPath(new URL('../schema/', import.meta.url))

const MIGRATION_RE = /^(\d{4})_[a-z0-9_]+\.sql$/

/* ---------------- 异常 ---------------- */

/**
 * 数据层的可诊断异常。`code` 给调用方分支用，`message` 是可以直接显示给用户的人话，
 * `cause` 里留原始错误，服务端日志打完整原因，浏览器只拿 code + message。
 */
export class StoreError extends Error {
  constructor(code, message, options = {}) {
    super(message)
    this.name = new.target.name
    this.code = code
    if (options.cause) this.cause = options.cause
  }
}

/** 开库失败：路径、权限、磁盘。 */
export class OpenDatabaseError extends StoreError {}

/** 迁移失败：schema 文件读不动、SQL 报错、台账写不进去。 */
export class MigrationError extends StoreError {}

/** 关库失败：通常意味着还有未提交的写入，必须让人看见。 */
export class CloseDatabaseError extends StoreError {}

/** 启动阶段的兜底类型，供调用方一个 catch 收口（dev-server 用它打印友好提示）。 */
export class BootstrapError extends StoreError {}

/* ---------------- 迁移文件 ---------------- */

/** 按编号排序的迁移文件列表。文件名不符合 NNNN_name.sql 的不猜，直接报错。 */
export function migrationFiles(dir = SCHEMA_DIR) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch (error) {
    throw new MigrationError('SCHEMA_DIR_MISSING', `读不到迁移目录：${dir}`, { cause: error })
  }
  const files = entries.filter((f) => f.endsWith('.sql'))
  const unknown = files.filter((f) => !MIGRATION_RE.test(f))
  if (unknown.length) {
    throw new MigrationError('SCHEMA_NAME_INVALID', `schema/ 里有不符合 NNNN_name.sql 的文件：${unknown.join(', ')}`)
  }
  return files.sort((a, b) => Number(a.slice(0, 4)) - Number(b.slice(0, 4)))
}

/* ---------------- 开 / 关 ---------------- */

/**
 * 打开本机库。`:memory:` 用于测试；真实文件由调用方传入**用户选定的资料目录**下的路径。
 */
export function openDatabase(path = ':memory:') {
  if (typeof path !== 'string' || !path.trim()) {
    throw new OpenDatabaseError('EMPTY_DB_PATH', '缺少数据库路径：资料目录必须来自你的选择，不在这里猜')
  }
  let db
  try {
    db = new DatabaseSync(path)
  } catch (error) {
    throw new OpenDatabaseError('OPEN_FAILED', `打不开数据库：${path}`, { cause: error })
  }
  try {
    db.exec('PRAGMA foreign_keys = ON')
  } catch (error) {
    throw new OpenDatabaseError('PRAGMA_FAILED', '打开数据库后没能开启外键约束，库不会被使用', { cause: error })
  }
  return db
}

/** 关库。失败也要抛：静默吞掉等于让人以为数据已经落盘。 */
export function close(db) {
  if (!db) return
  try {
    db.close()
  } catch (error) {
    throw new CloseDatabaseError('CLOSE_FAILED', '关闭数据库时出错，请检查是否还有未完成的写入', { cause: error })
  }
}

/* ---------------- 迁移 ---------------- */

/**
 * 执行未应用的迁移。已在 `schema_migrations` 里的版本跳过（幂等）。
 * 每个文件在一个事务里跑完：跑一半失败会整体回滚，不会留下"半套表"。
 */
export function migrate(db, { dir = SCHEMA_DIR, now = () => new Date().toISOString() } = {}) {
  if (!db || typeof db.exec !== 'function') {
    throw new MigrationError('NO_DATABASE', '迁移需要一个已打开的数据库')
  }

  try {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TEXT
    )`)
  } catch (error) {
    throw new MigrationError('LEDGER_FAILED', '建不了迁移台账 schema_migrations，后续迁移无法记录', { cause: error })
  }

  let applied
  try {
    applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version))
  } catch (error) {
    throw new MigrationError('LEDGER_READ_FAILED', '读不到已执行的迁移记录', { cause: error })
  }

  const executed = []
  for (const file of migrationFiles(dir)) {
    const version = file.slice(0, 4)
    if (applied.has(version)) continue

    let sql
    try {
      sql = readFileSync(join(dir, file), 'utf8')
    } catch (error) {
      throw new MigrationError('SCHEMA_READ_FAILED', `读不到迁移文件：schema/${file}`, { cause: error })
    }

    db.exec('BEGIN')
    try {
      db.exec(sql)
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, now())
      db.exec('COMMIT')
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch (rollbackError) {
        // 回滚也失败说明库已经不在可写状态，把两个原因都带出去，别只留一句"迁移失败"
        throw new MigrationError('ROLLBACK_FAILED', `schema/${file} 执行失败且回滚也失败：${error.message}`, { cause: rollbackError })
      }
      throw new MigrationError('MIGRATE_FAILED', `schema/${file} 执行失败：${error.message}`, { cause: error })
    }
    executed.push(file)
  }

  return {
    executed,
    applied: db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all(),
  }
}
