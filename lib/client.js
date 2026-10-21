/* 客户端入口（宿主侧，由 ModuleLoader 加载的单文件）。
 *
 * 为什么是普通脚本而不是 ESM：宿主 renderer 用 `window.__ModuleLoader__.load({id, factory})`
 * 包一层来拿 React 组件；直接给 `export` 会被拒（Unexpected token 'export'）并把整个包移出 profile。
 *
 * 面板形态：**标准分栏**（customFrame=false）——右侧原生会话由宿主管，业务区只放一个页面。
 * 所以这里不自己画会话栏，也不 import 宿主的会话 API：注册一个占满可用空间的 iframe，
 * 指向本包自己的 UI 前缀 `/api/gist/ui/index.html`（见 dsh/index.js 的 UI_PREFIX）。
 *
 * 三个数字（businessSide / businessWidth / customFrame）的唯一来源是 `lib/layout.js`，
 * 这里是宿主要求写死的字面量副本；`test/ui-parity.test.mjs` 会比对两处，改一处漏一处会红。
 */
window.__ModuleLoader__.load({
  id: "@xyb-community/gist-workbench",
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const metadata = {
      title: "小吉宝 GistPal 胃肠间质瘤工作台",
      description: "本机优先的胃肠间质瘤病理与危险度档案、靶向治疗线序、复查影像与用药副作用记录工作台",
    }

    /* 业务界面就是 public/ 那一份（dev-server 与 Desktop 同源，不维护第二套 UI）。 */
    const UI_URL = "/api/gist/ui/index.html"

    function Panel() {
      return h('iframe', {
        src: UI_URL,
        title: metadata.title,
        style: { flex: 1, width: '100%', minWidth: 0, border: 0, background: '#fbf9f5', display: 'block' },
        /* 只允许同源页面；沙箱不做限制，页面需要 localStorage 记住面板宽度 */
        referrerPolicy: 'same-origin',
      })
    }

    function apply(ctx) {
      ctx.effect(() => ctx.desktopWorkbenches.register({
        title: metadata.title,
        repository: "https://github.com/xyb-openharness-dsh-plugins/gist-workbench",
        description: metadata.description,
        businessSide: 'left',
        businessWidth: 0.65,
        customFrame: false,
      }, Panel))
    }

    return { apply, inject: ['desktopWorkbenches'] }
  }
})
