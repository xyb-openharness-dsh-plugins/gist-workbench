/* 面板布局参数。
 *
 * 这里是 DSH 分栏合同的**唯一入参来源**：客户端 register、构建注入与包级检查都读它。
 * 别处不许再写一份 0.65（也别写它的补数 0.35）——以前面板参数散在 client.js 与
 * 构建脚本里，改一处漏一处，最后连"业务区到底多宽"都要靠截图量。
 *
 * ## 本项目用标准分栏（customFrame=false）
 *
 * 与乳腺癌工作台（pinkypal）不同：那一台要自己实现可拖动的 AI 会话分栏，
 * 而标准分栏下宿主 `packages/dsh-desktop-workbenches/client.js` 只把
 * `--workbench-business-width` 写成注册时的静态值：
 *
 *   h('div', { className:'dshWbBody', hidden: customFrame,
 *     style: { '--workbench-business-width': `${entry.layout.businessWidth * 100}%` } })
 *
 * 也就是说：宿主只认 `businessSide` / `businessWidth` 这两个注册参数，
 * 服务侧**没有**拖宽或关闭面板的编程接口——所以这里把 customFrame 记成 false，
 * 是如实记录"这一台走标准分栏"，不是漏接。
 *
 * 取值的两条理由：
 * 1. businessSide=left：业务区在左、宿主原生会话在右，与 v0.2 原型的信息层级一致；
 * 2. businessWidth=0.65：v0.2 原型的 34 个视图是在 1440×65% ≈ 936px 的宽度下
 *    量出来的，0.7 会把会话区压到 30% 以下，0.6 以下则会让原型里的三栏卡片提前换行。
 */

/**
 * 宿主面板参数（写进客户端 register 时逐字使用）。
 * 宿主强校验：businessSide ∈ left/right，businessWidth ∈ 0.25–0.7，越界直接抛错。
 */
export const PANEL = Object.freeze({
  businessSide: 'left',
  businessWidth: 0.65,
  customFrame: false,
});

/** 宿主允许的 businessWidth 区间（源码 client.js 强校验，越界直接抛错） */
export const HOST_LIMITS = Object.freeze({ min: 0.25, max: 0.7 });

/**
 * AI 会话面板的宽度档位（页面内拖动/预设共用这一份，客户端不留第二份数字）。
 *
 * 单位是「占工作区宽度的比例」，区间 25%–45% 取自 20-AGENT-PANE-DESIGN §2 的
 * customFrame 基线：更窄读不了消息，更宽会把业务区压到 55% 以下、三栏卡片提前换行。
 * 注意：**标准分栏（customFrame=false）下宿主不吃这份参数**——宿主只认 businessWidth，
 * 且注册后不再变；这里只驱动页面内自绘的会话栏（开发版 dev-server 与将来的 customFrame）。
 */
export const AGENT_PANE = Object.freeze({
  min: 0.25,
  max: 0.45,
  def: 0.35,
  step: 24,                                   // 键盘 ←/→ 每次步进的像素
  presets: Object.freeze({ narrow: 0.25, std: 0.35, wide: 0.45 }),
});

/** 把比例夹到 AGENT_PANE 区间；非数字一律回默认值。 */
export function clampAgentRatio(ratio) {
  const r = Number(ratio);
  if (!Number.isFinite(r)) return AGENT_PANE.def;
  return Math.min(AGENT_PANE.max, Math.max(AGENT_PANE.min, r));
}

/** 业务区像素宽度：宿主给的比例 × 窗口宽度。1440 → 936，1280 → 832。 */
export function businessPanePx(windowWidth, width = PANEL.businessWidth) {
  if (!Number.isFinite(windowWidth) || windowWidth <= 0) throw new TypeError('windowWidth 必须是正数');
  const ratio = width === undefined ? PANEL.businessWidth : width;
  if (!Number.isFinite(ratio) || ratio <= 0) throw new TypeError('width 必须是正数');
  return Math.round(windowWidth * ratio);
}

/**
 * 自检：返回问题清单，空数组表示合法。参数可注入，便于单测覆盖越界情形。
 * 只查宿主真正会校验的那几项——多查一条，就多一处"代码说不行、宿主说行"的漂移。
 */
export function assertPanelConfig(config = PANEL) {
  const problems = [];
  if (!config || typeof config !== 'object') return ['面板配置必须是对象'];

  if (!['left', 'right'].includes(config.businessSide)) {
    problems.push(`businessSide 只能是 left/right，当前 ${config.businessSide}`);
  }
  if (typeof config.customFrame !== 'boolean') {
    problems.push(`customFrame 必须是布尔值，当前 ${config.customFrame}`);
  }

  const w = config.businessWidth;
  if (!(typeof w === 'number' && Number.isFinite(w) && w >= HOST_LIMITS.min && w <= HOST_LIMITS.max)) {
    problems.push(`businessWidth 必须在 ${HOST_LIMITS.min}–${HOST_LIMITS.max} 之间，当前 ${w}`);
  } else if (w === HOST_LIMITS.max) {
    problems.push(`businessWidth 不得取上限 0.7：贴到上限会把会话区压到 0.3 以下，本项目不这么做`);
  }
  return problems;
}
