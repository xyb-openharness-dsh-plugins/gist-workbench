#!/usr/bin/env node
/**
 * 装机目标检查：本包必须登记到 **DSH Desktop 实际加载的那个 Harness profile**。
 *
 * 判据不是目录名。2026-10-21 实测（DSH Desktop 0.12.0）：Desktop 用的是 app 自己的 Harness，
 *   macOS: ~/Library/Application Support/dsh-desktop/harness，活动 profile 名恰好叫 `web`
 *   Windows: %APPDATA%/dsh-desktop/harness（Electron userData 约定；未在 Windows 实测）
 * 而 `~/.dsh/profiles/*` 是 CLI 侧的另一份 Harness —— Desktop **不读**。
 * 另外 `package.json` 的 `dsh.client.platform = "web"` 指客户端运行环境，与装机目录无关。
 *
 * 用法：
 *   node scripts/check-install.mjs                  # 自动探测 Desktop Harness
 *   node scripts/check-install.mjs --home <dir> --profile <name>
 * 退出码：0 = 已在 Desktop 实际加载的 profile 中登记；1 = 未登记或只登记在别处。
 *
 * 这个脚本只做**只读核对**，不写任何文件；装包命令请用目标版本明确支持的入口。
 */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? resolve(args[i + 1]) : null;
}

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const NAME = pkg.name;

function appSupportRoot() {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support');
  if (process.platform === 'win32') return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
}

/** 候选 Harness：先 Desktop app 自己的，再 DSH_HOME，最后 CLI 侧（只用于提示"装错地方"）。 */
function candidates() {
  const explicitHome = argValue('--home');
  const explicitProfile = args.includes('--profile') ? args[args.indexOf('--profile') + 1] : null;
  if (explicitHome) {
    return [{ label: '手动指定（--home）', home: explicitHome, profile: explicitProfile || 'web', live: true }];
  }

  const list = [];
  const appHome = join(appSupportRoot(), 'dsh-desktop', 'harness');
  list.push({
    label: 'DSH Desktop Harness（app 自带）',
    home: appHome,
    profile: explicitProfile || 'web',
    live: existsSync(join(appHome, 'desktop-workbenches', 'state.json')) || existsSync(join(appHome, 'desktop-workbenches', 'market-installs.json')),
  });

  if (process.env.DSH_HOME) {
    list.push({ label: 'DSH_HOME 环境变量', home: resolve(process.env.DSH_HOME), profile: explicitProfile || 'web' });
  }

  const cliHome = join(homedir(), '.dsh');
  list.push({ label: 'CLI Harness（Desktop 不读）', home: cliHome, profile: 'web' });
  list.push({ label: '旧结论 desktop profile（Desktop 不读）', home: cliHome, profile: 'desktop' });
  return list;
}

function readProfile(home, profile) {
  const file = join(home, 'profiles', profile, 'package.json');
  if (!existsSync(file)) return null;
  try {
    const json = JSON.parse(readFileSync(file, 'utf8'));
    return {
      file,
      dep: json.dependencies?.[NAME] ?? null,
      bundled: (json.dsh?.profile?.bundles ?? []).includes(NAME),
    };
  } catch (error) {
    return { file, error: error.message };
  }
}

/** 市场安装记录：有记录=被市场认作「已安装」，无记录=手工/native 安装。 */
function marketRecord(home) {
  const file = join(home, 'desktop-workbenches', 'market-installs.json');
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const repo = (pkg.repository?.url || pkg.repository || '').replace(/^git\+/, '').replace(/\.git$/, '');
    return (
      Object.values(data.installs || {}).find(
        (item) => item.pluginName === NAME || (repo && item.catalogId && repo.toLowerCase().endsWith(item.catalogId.toLowerCase())),
      ) || null
    );
  } catch {
    return null;
  }
}

const all = candidates().map((c) => ({ ...c, entry: readProfile(c.home, c.profile) }));
const live =
  all.find((c) => c.live === true) ||
  all.find((c) => c.label.startsWith('DSH Desktop') && c.entry) ||
  all.find((c) => c.label.startsWith('DSH_HOME') && c.entry) ||
  null;

const lines = [];
let ok = false;

if (!live) {
  lines.push('✗ 找不到 DSH Desktop 的 Harness（没看到 desktop-workbenches/state.json）。');
  lines.push('  Desktop 是否装过并至少启动一次？位置可用 --home 指定。');
} else {
  lines.push(`判定基准：${live.label} → ${join(live.home, 'profiles', live.profile)}`);
  const entry = live.entry;
  if (!entry) {
    lines.push(`✗ 这个 profile 下没有 package.json：${join(live.home, 'profiles', live.profile, 'package.json')}`);
  } else if (entry.error) {
    lines.push(`✗ package.json 读不了：${entry.error}`);
  } else if (!entry.dep) {
    lines.push(`✗ dependencies 里没有 ${NAME}——Desktop 不会加载这个工作台。`);
  } else if (!entry.bundled) {
    lines.push(`✗ 依赖装了（${entry.dep}）但 dsh.profile.bundles 里没有 ${NAME}——不会加载。`);
  } else {
    ok = true;
    lines.push(`✓ ${NAME} 已登记到 Desktop 实际加载的 profile（${entry.dep}）`);
    const rec = marketRecord(live.home);
    lines.push(
      rec
        ? `✓ 市场安装记录：${rec.catalogId} · ${rec.version} · ${rec.source}`
        : '! 无市场安装记录：属手工/native 安装，市场里可能不显示「已安装」，也未必支持 app 内卸载。',
    );
  }
}

for (const c of all) {
  if (c === live || !c.entry?.dep) continue;
  lines.push(`! 另在「${c.label}」也装了（${c.entry.dep}）——那是另一份 Harness，不能替 Desktop 验收。`);
}

if (!ok) {
  lines.push('');
  lines.push('装包命令（目标版本明确支持本地 tgz 时才用；先查 `dsh plugin add --help`）：');
  if (live) {
    lines.push(`  export DSH_HOME="${live.home}"`);
    lines.push(`  export PATH="$DSH_HOME/.desktop-bin:$PATH"   # 用 app 自带的 pnpm / node`);
    lines.push(`  NODE_OPTIONS= npx --yes pnpm@10.15.0 --dir "$DSH_HOME/profiles/${live.profile}" add -w ./release/<包名>-<版本>.tgz`);
    lines.push(`  再把 ${NAME} 加进 "$DSH_HOME/profiles/${live.profile}/package.json" 的 dsh.profile.bundles，重启 Harness。`);
  }
  lines.push('不要装到 ~/.dsh/profiles/*——Desktop 不读那里，装上也只是「配置层有了」。');
}

console.log(lines.join('\n'));
process.exit(ok ? 0 : 1);
