/* 工作台实例：把「工作区目录 → 库 → 读模型」串起来。
 *
 * 与 DSH 插件入口（dsh/index.js）分开的原因：入口必须 import 宿主给的 peer 依赖
 * （Schemastery），本仓库装不上，一 import 就炸。所以可单测的那一层放这里，
 * `npm start -- --workspace <目录>` 与将来的宿主 apply() 用的是同一个类。
 *
 * 规则（与乳腺癌工作台一致）：
 * - 资料目录由用户选定，不猜、不静默创建；
 * - 打开即 migrate，只补未执行的迁移；
 * - 库里没有档案时才播种演示数据，之后每次启动都沿用用户自己的资料。 */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { close, migrate, openDatabase } from './store.js';
import { hasDemoData, seedDemo } from './demo.js';
import { bootstrap, getProfile, listSubjects } from './readmodels.js';
import { workspaceProblems } from './server.js';
import { version, build, displayVersion } from '../lib/version.js';

export const DB_FILE = 'xyb-gist.sqlite';

/** 校验资料目录：返回问题数组（空数组＝可用）。不抛错，方便 UI 一次性列出所有问题。 */
export function validateWorkspacePath(p) {
  return workspaceProblems(p);
}

export class Workbench {
  #db = null;
  #workspace = null;

  /** 打开（必要时创建）工作区里的库。workspace 必须已经通过 validateWorkspacePath。 */
  static async open(workspace) {
    const problems = validateWorkspacePath(workspace);
    if (problems.length) throw new Error(problems.join('；'));

    let dir = workspace;
    if (!existsSync(dir)) {
      try { mkdirSync(dir, { recursive: true }); } catch (error) {
        throw new Error(`建不了资料目录 ${dir}：${error.message}`);
      }
    }

    const wb = new Workbench();
    wb.#workspace = dir;
    wb.#db = openDatabase(join(dir, DB_FILE));
    try {
      migrate(wb.#db);
      if (!hasDemoData(wb.#db)) seedDemo(wb.#db);
    } catch (error) {
      try { close(wb.#db); } catch { /* 关不掉也要把原始错误抛出去 */ }
      throw error;
    }
    return wb;
  }

  get version() { return version; }
  get displayVersion() { return displayVersion; }
  get build() { return build; }
  get workspace() { return this.#workspace; }
  get db() { return this.#db; }

  bootstrap() { return bootstrap(this.#db, { version, build }); }
  listSubjects() { return listSubjects(this.#db); }
  getProfile(key) { return getProfile(this.#db, key); }

  close() {
    if (this.#db) { close(this.#db); this.#db = null; }
  }
}
