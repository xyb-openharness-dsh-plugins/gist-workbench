// 本文件由 scripts/build-version.mjs 生成，请勿手改。
// 唯一来源：仓库根目录的 VERSION。改版本先改 VERSION，再跑 npm run build:version。
export const version = '0.1.0'
export const build = '2026-10-20'
export const channel = 'prototype'
export const commit = 'a0f9370'

export const displayVersion = `v${version}`
export const channelLabel = '交互原型 · 未接入 DSH'

export const APP_INFO = Object.freeze({
  version,
  displayVersion,
  build,
  channel,
  channelLabel,
  commit,
})
