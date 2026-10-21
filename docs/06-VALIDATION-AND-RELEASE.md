# 检查、安装和发布

## 分层验证与节奏

| 改动 | 最小合理检查 | 不能替代 |
| --- | --- | --- |
| 文案/样式/翻面 | 语法、相关页面真实渲染、窄容器与大字 | 全站功能验收 |
| 共享组件 | 多实例/键盘/reduce motion/异常值 | 真实 Desktop 容器 |
| 完整 Tab | 相关 Store/API、组件行为、输入到回顾 | 其它 Tab 未做完项 |
| 数据迁移/主体切换 | 旧库迁移、事务、隔离、跨页一致性 | 单一 happy path |
| 解析/导出 | 真实合成文件、失败路径、内容格式、结果登记 | 请求返回 200 |
| 包/宿主接入 | 实际 tgz 清单、安装/profile、重启后界面 | 源码预览页 |

每页批次结束验该页，每 2–3 个关联页回归，里程碑跑全套。单元测试不镜像实现；字符串包含标题/transform 只能做烟雾检查，不证明图表/翻转正常。初期最先验证“目标宿主真的能加载”和一条真实数据链路，不等七页都写完才试装。

## 打包前

1. 记录 commit/工作区、版本、Node、OS/架构和 Desktop 版本。版本来自 package 元数据/健康接口，UI 不复制写死常量。
2. 按仓库锁文件选择 npm/pnpm，不混用重建锁；跑相关检查，再 pack。若宿主仓库存在 `scripts/check-workbench-package.mjs`，按它的帮助再执行官方检查。本脚手架同名工具是社区静态检查器，不冒充官方。
3. 查看 `npm pack --dry-run` 与实际 tgz 清单，包中必须有 patch、server/client 和运行 assets/迁移。检查无真实数据、密钥、临时文件与虚假已构建入口。
4. 记录 tarball 的 SHA-256；本地包也递增版本，不重复同版号试图绕缓存。

## 安装到正确 Desktop

发布目标必须由用户和项目明确。若目标为 **DSH Desktop app**，不可把 `dsh web`、通用 `--profile web`、全局 CLI 安装或“官方版”视为等价目标。先从正在运行/待验收的 Desktop app 核对版本、RC 标记、安装入口和活动 profile/generation；包 peer 范围须含目标 RC，构建/Node runtime/包管理器要与实际安装环境一致。若应用版本信息暂时不可见，记录“未核实”，先查 app 的关于/插件管理或受支持诊断入口，不推测版本。不要为了发现版本改写活动 profile。

**本机更新必须交付到已安装版本，而不止推送代码。** 用户要求“更新到 Desktop”“部署新版”“让我在本机看到修改”时，Agent应连续完成构建版本化安装包、通过目标宿主支持的入口更新、核对实际安装版本，并由用户或Agent打开确认。只有用户明确要求Git推送时，交付范围才止于Git。

**明确区分 DSH Desktop app 与通用 DSH CLI profile。** `dsh plugin --profile desktop add` 成功、`~/.dsh/profiles/desktop` 中依赖/bundle 已登记，只证明通用 CLI profile 被修改；不能推断它是 `/Applications/DSH Desktop.app` 使用的内部 profile，也不能把重启后仍未出现的工作台归因于缓存。要交付到 Desktop app，先从该 app 当版开发指南、已安装工作台管理页或受支持的诊断/CLI 确认本地 `.tgz` 安装入口和目标内部 profile/generation。安装后核验 app 自己的 workbench 注册状态、已安装列表与切换器条目，再重启验证加载；不得直接改 app 的状态 JSON、lockfile、活动链接或插件投影来绕过安装器。若找不到 app 明确支持的入口，保留 tarball 与 hash，报告“CLI profile 已安装、Desktop app 未安装”，不得声称已部署。

macOS 上若当前 Desktop 随附的 CLI 明确支持本地 tarball，且该 app 的 `.desktop-bin/pnpm` 是其 profile package runner，先从 app 帮助确认 profile 名，再显式设置 app 自己的 DSH_HOME 与 runner。示意：

```bash
export DSH_HOME='<DSH Desktop app 的 Harness 数据目录>'
export PATH="$DSH_HOME/.desktop-bin:$PATH"
dsh plugin --profile '<app 内部 profile>' add -w --save-exact 'file:/absolute/path/workbench-version.tgz'
```

此处 app 内部 profile 即使叫 `web`，也必须确认 `DSH_HOME` 指向 DSH Desktop app 的 Harness；不要运行 `dsh web`，也不要省略 DSH_HOME。安装后核对 app profile 的 `package.json` dependency 与 `dsh.profile.bundles`、node_modules 版本、`desktop-workbenches/state.json` 注册及 tarball hash；在另一 profile 核实没有意外安装。CLI 的 `--dump-config` 若无法加载 app 提供的私有 bundle，不应作为错误 profile 的证据，也不代表 Desktop UI 已加载。

**本机实证（2026-10-18，breast-cancer-workbench 首装踩坑实录，同日两轮修正）——装错 profile 是最容易犯的错：**

- **DSH Desktop app 实际读的 profile 是 `~/Library/Application Support/dsh-desktop/harness/profiles/web`**（name 叫 "dsh-profile-web"，pnpm 10.34.5，带 generationProjection）。**两个都不对**：`~/.dsh/profiles/web`（全局 CLI 用）和 `~/.dsh/profiles/desktop`（CLI 的另一个 profile，名字带 desktop 但 Desktop 不读它）——两次都装错过，重启后列表里没有就是没装对地方。
- 判定法（唯一可靠）：看 `harness/profiles/web/package.json` 里已正常显示的工作台的 `file:` tgz 登记，照抄同款装法；`harness/` 下每个工作台还有同名数据目录可交叉印证。不要凭 profile 目录名猜。
- 安装约定 = 机器既有：该 profile `package.json` 加 `file:` tgz 依赖 + `dsh.profile.bundles` 数组登记包名（两处都改，缺一不可）；改完校验 JSON 合法性。
- **用 profile 自己声明的 pnpm**：在 `harness/profiles/web` 里 `corepack pnpm add -w <tgz>` 自动遵循 `packageManager` 字段（10.34.5）。装完 `grep -c <新代码特征>` 核对安装副本真的是新版。
- **pnpm 同版本号不替换内容**：改包重装若版本号没变，`added 0`，装进去的还是旧文件。改包后要么升版本号，要么 `pnpm remove -w <pkg> && pnpm add -w <tgz>`。
- 本机 WorkBuddy 环境的 `NODE_OPTIONS` 注入 shim 会拦 pnpm 的 symlink 写入（`ERR_PNPM_CODEBUDDY_BROKER_DENY`）：`NODE_OPTIONS= corepack pnpm …` 且需关 bash 沙箱。
- CLI 短启验证 profile 时，错误列表里**没有自己包的名字**才算通过；存量包报错（版本倾斜、凭据格式）先对照实验（摘掉自己的包再启一次）排除，不要顺手改用户凭据文件。
- cordis 对宿主 `apply` 的返回值严格检查：**必须非 async、返回 undefined**，实例走模块级单例 + 导出 getter 给测试；async resolve 普通对象直接 `Invalid effect`。

若 CUA 看不到 Desktop 窗口，先用 app 自身受支持方式打开/检查；macOS 上可只读核验 `Contents/MacOS/<CFBundleExecutable>` 是否存在，并运行 `codesign --verify --deep --strict '<目标 Desktop.app>'`。如 Launch Services 返回启动错误或签名无效，记录原始结果和 app 版本，暂停宿主 UI 验收并交由 app 维护方恢复。不要通过改二进制、移除 quarantine、重签、重装覆盖或直接编辑 app bundle 来绕过；也不要把该宿主故障误判为工作台加载失败或工作台兼容证据。

正常更新按最短路径执行：

1. 按项目真实脚本构建并打包，生成带版本的安装包，运行本次改动需要的检查。
2. 使用已核验的目标Desktop安装入口/Profile更新；保留必要回滚材料和用户数据。
3. 读取安装后的版本，打开确认界面版本及本次修改；已有用户手工确认直接记录复用。
4. 报告“已安装/已加载”的实际状态；不能操作宿主时保留包，准确说明尚缺的安装步骤。

**只有安装后仍是旧版或出现加载异常，才启动完整排查链。** 依次核对源码版本、构建产物、tarball、实际Profile、安装副本和运行界面，定位第一个不一致点；按需比较hash与入口。正常更新不每次全量扫描或重复实机验收。重启只重新加载已安装内容，不自动安装Git里的新版本。

先从应用“关于”和安装入口确认版本、平台、架构，再查看当前可用 CLI 的 `plugin add --help`。只采用明确支持本地 tgz 的入口，不猜一条通用命令。

项目实际案例曾在确认的 web profile 中用 Desktop 自带 pnpm 安装包：

```bash
# 这是历史修复例子，只有目标版本明确采用同样 workspace/profile 布局时才用。
cd '<经核验的目标 profile>'
node '<Desktop 内置 pnpm.cjs>' add -w --save-exact 'file:/absolute/path/package-version.tgz'
```

`-w` 只适用 pnpm workspace 根目录。不要在业务仓库执行并把依赖装进错地方；系统 pnpm store 格式与内置 pnpm 也可能不一致。不要把本人的 macOS Library 路径写进通用安装脚本；新版本可能采用 isolated generation，须遵从当版安装器，不手工编辑活动链接、锁文件或插件树。

peer warning 不是加载结论；查宿主实际提供服务与日志。不能为消 warning 随手塞入第二份 Cordis/React/runtime。

## 用户侧入口与三层验收（2026-10-21 实测，Desktop 0.12.0）

**不要把「`dsh web` 起网页版 → 浏览器 Settings → Plugins 开关插件」写成 Desktop 的用法。** 那是 CLI / Web 载体：它读的是 `~/.dsh` 那份 Harness，与 Desktop app 自己的 Harness 不是同一个安装位置，装上去 Desktop 不加载。给 Desktop 装的包只能在 Desktop 里验。

用户在 app 内的正规路径：

1. **设置 → 通用**，打开「启用工作台功能」（关掉后所有工作台都不加载，已有会话与数据不受影响）。
2. 左侧 **工作台市场** 搜索并安装；或按当版提供的本地 `.tgz` 入口安装（有没有这个入口要在「工作台市场／已安装」里实地确认，没有就走命令行，不硬找）。
3. 出现「工作台安装变更需要重启 Harness 后生效」时点 **立即重启**；没有提示时用菜单 **Harness → 重启 Harness**。
4. 市场切到 **已安装** 核对条目，再从左侧固定入口打开业务面板。

验收分三层，缺一层不算"装机通过"：

| 层 | 证据 | 只能证明 |
| --- | --- | --- |
| 配置层 | `dump-config` 里出现本包插件层 | patch 生效 |
| 列表层 | 市场「已安装」出现条目 / `desktop-workbenches/market-installs.json` 有记录 | 包被识别、注册成功 |
| 界面层 | 左侧入口打开，核心流程能点通 | **唯一算"装机通过"的证据** |

只拿到前两层时写"配置已加载、UI 未验证"，不写"装机通过"。

机器可复核：新项目模板自带 `scripts/check-install.mjs`（只读），它自动探测 Desktop Harness（app 自带 → `DSH_HOME` → `~/.dsh`），打印判定依据与"市场安装 / 手工 native 安装"的区别。换机器、换 Desktop 版本或用户改过 Harness 位置时先跑它看基准目录，不要照抄命令里的路径。

## 重启与真实验收

Agent 在目标 Desktop 内时，安装后不自动重启或杀进程，让用户完整退出重开；返回后检查列表、左侧入口、版本号、业务页面和会话。外部 Agent 可按已授权且受支持的流程完成重启。

首次接入/上架里程碑记录：目标profile/安装方式、包hash/版本、已安装列表、入口、选主体后页面、原生Agent、主要Tab/子页及适用业务链；按官方第8节逐项记录，不适用写原因。日常增量更新复用已有清单，只确认实际安装版本及本次改动影响的分支；宿主/平台变化或新故障再补对应项目。截图不展示真实凭据；用户已提供与版本对应的合规截图时直接复用。

## 发布与回滚

本地安装、Git push、GitHub Release、npm 发布、市场 PR、市场上架分别记录；互不等同。用户说“推送 Git”只授权当前相关提交推送，不自动上市场。确认 README、变更记录、license/作者/鸣谢、运行依赖、未支持项和 Demo 清理策略。

回滚先保留当前包和用户资料，再核验旧代码是否支持已升级数据库。切回旧 tgz 不等于数据库可降级；不兼容时用已验证备份/迁移路径，不删数据。市场以当期官方验收流程为准，本脚手架不自动投稿。

推荐报告格式：修改文件/包版本；代码检查；包检查；安装与实际加载；业务自测；外部依赖；未验证项；下一步。

## 选择上架时的额外闸门

官方市场规范 O03（2026-09-29 快照）要求：作者公开 GitHub 仓库和有效许可证；一个仓库根目录一个工作台；真实可用代码而非本骨架占位；打包不超过 8 MiB；包不含数据库、客户数据、有效凭据、本机绝对路径或无权公开素材。模板的 private/UNLICENSED 和未确认 Logo 授权需在正式公开前处理。临床离线数据库不要照本地私用方案直接随市场包发布。

npm→GitHub Release→源码的来源选择由市场合同决定，锁定版本/commit；失败不应自动换来源。源码路径也要带已构建客户端，市场不代执行 build。收录条目中英文简介、分类、作者自己仓库的 1–5 张真实最终版本截图（每张不超过 2 MiB）都需真实。新条目不写 register id/workbenchId；metadata/version 以当期目录 schema 为准。

投稿 PR 必须给出实际 URL；合并且公开 catalog 可见才能说已上架。完整条款见 [官方市场快照](../reference/official/market-acceptance-2026-09-29.md)，发布前再次核对官网。

## 工作台市场投稿操作指南

明确要进入 DSH Desktop 工作台市场时，按 [市场发布流程](10-MARKET-PUBLISHING.md) 执行：官方依据、来源选择、人工验收单、YAML、gh命令、最新PR检查与上架判断集中在该文档。指定版本的手工确认直接复用；Computer Use仅按需补充。代码推送、包发布与市场收录分别记录。
