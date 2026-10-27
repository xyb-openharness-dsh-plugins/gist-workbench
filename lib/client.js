/* 客户端入口：DSH Desktop 的面板外壳（customFrame=true，自绘）。
 *
 * 为什么是普通脚本而不是 ESM：宿主 renderer 用 `window.__ModuleLoader__.load({id, factory})`
 * 包一层来拿 React 组件；直接给 `export` 会被拒（Unexpected token 'export'）并把整个包移出 profile。
 *
 * 面板形态（家族 2026-10-27 统一）：
 * - 根节点**首个子元素是语义 <header>**，用 `--dsh-frame-leading-clearance` 避让 macOS 窗口按钮；
 * - 顶栏：品牌 + 版本 + 「AI 对话」按钮；没有会话能力时禁用并给出说明；
 * - 业务界面仍是本包 public/（iframe 指向 `/api/gist/ui/index.html`），只换外壳；
 * - 宿主把原生会话节点作为 `conversation` prop 交给我们，`aside` 常挂载、`display` 控显隐；
 * - 中间 splitter：DOM 顺序 `业务区 → splitter → aside`；1px 视觉线 + 11px 透明热区；
 * - 25%–45%，默认 35%，步进 2%，localStorage 持久化，←/→/Home/End 可调；
 * - 容器窄于 760px 改覆盖式抽屉，splitter 不出现；
 * - 点击「AI 对话」只调起/复用归属会话，不自动发送任何消息。
 *
 * 三个数字（businessSide / businessWidth / customFrame）与 lib/layout.js 的 PANEL 同源；
 * `test/ui-parity.test.mjs` ⑩ 会比对两处，改一处漏一处会红。
 */
;(function () {
  if (!window.__ModuleLoader__) return // 静态检查脚本可能扫到这个文件，那时不该抛错

  window.__ModuleLoader__.load({
    id: "@xyb-community/gist-workbench",
    factory(require) {
      const React = require('react')
      const h = React.createElement

      const VERSION = '0.1.2'
      const BRAND = '小吉宝 GistPal'
      const TITLE = '小吉宝 GistPal · 胃肠间质瘤工作台'
      const SUBTITLE = '本机数据 · 只整理不判定'
      const DESCRIPTION = '本机优先的胃肠间质瘤病理与危险度档案、靶向治疗线序、复查影像与用药副作用记录工作台'
      const UI_URL = '/api/gist/ui/index.html'

      /* 面板参数：与 lib/layout.js 的 AGENT_PANE 同源；这里是宿主侧单文件里的字面量副本。 */
      const AGENT_MIN = 0.25, AGENT_MAX = 0.45, AGENT_DEFAULT = 0.35, AGENT_STEP = 0.02
      const NARROW_BELOW = 760, DRAWER_MAX = 420
      const WIDTH_KEY = 'gistpal.agent-pane.width.v1'
      const UNAVAILABLE_NOTE = '当前 Desktop 版本不支持从面板调起会话；请从左侧会话列表新建会话。'

      const clampWidth = (value) => {
        const n = Number(value)
        if (!Number.isFinite(n)) return AGENT_DEFAULT
        return Math.min(AGENT_MAX, Math.max(AGENT_MIN, n))
      }
      /** 对齐到 2% 步进：鼠标与键盘落在同一组取值上，避免拖出 33.7% 这种数 */
      const snapWidth = (value) => clampWidth(Math.round(value / AGENT_STEP) * AGENT_STEP)
      const round4 = (n) => Math.round(n * 10000) / 10000
      function loadWidth() {
        try { return clampWidth(localStorage.getItem(WIDTH_KEY)) } catch { return AGENT_DEFAULT }
      }
      function saveWidth(width) {
        try { localStorage.setItem(WIDTH_KEY, String(round4(width))) } catch { /* 隐私模式忽略 */ }
      }

      /* 分隔线品牌色（本仓主色 #B5762A 暖琥珀）；悬停/拖动光晕由它派生，不写死蓝色 */
      const SPLITTER_BRAND = '#B5762A'
      const splitterRgba = (hex, alpha) => {
        const n = parseInt(String(hex).replace('#', ''), 16)
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
      }

      const rootStyle = {
        display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0,
        width: '100%', maxWidth: '100%', boxSizing: 'border-box',
        background: '#FBF9F5', color: '#2A241C',
        fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
      }
      const headerStyle = {
        display: 'flex', alignItems: 'center', gap: 10, flex: '0 0 auto', flexWrap: 'wrap',
        padding: '6px 12px', paddingInlineStart: 'calc(12px + var(--dsh-frame-leading-clearance, 0px))',
        borderBottom: '1px solid #ECE4D8', background: '#FFFFFF', fontSize: 12,
      }
      const brandStyle = {
        display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700, color: '#B5762A',
        whiteSpace: 'nowrap', fontSize: 12.5,
      }
      const verStyle = {
        fontWeight: 500, fontSize: 11, color: '#8A5514', background: '#FBF1E3',
        borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap',
      }
      const hintStyle = { flex: 1, minWidth: 200, color: '#6B7A85', fontSize: 11.5 }
      const headerActionsStyle = {
        display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto', marginLeft: 'auto',
      }
      const primaryButtonStyle = {
        border: 0, borderRadius: 999, padding: '5px 14px', whiteSpace: 'nowrap',
        background: '#B5762A', color: '#fff', font: 'inherit', fontWeight: 600, cursor: 'pointer',
      }
      const bodyStyle = { position: 'relative', display: 'flex', flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' }
      const businessStyle = { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }
      const frameStyle = { flex: '1 1 auto', width: '100%', minHeight: 0, border: 0, display: 'block', background: '#FBF9F5' }
      const paneStyle = {
        display: 'flex', flexDirection: 'column', flex: '0 0 auto', minWidth: 0, minHeight: 0,
        borderLeft: '1px solid #ECE4D8', background: '#fff', overflow: 'hidden',
      }
      const drawerStyle = {
        position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 3,
        boxShadow: '-8px 0 24px rgba(181, 118, 42, 0.18)',
      }
      /* 分隔线：1px 常规线条，绝对定位在业务区/会话边界上，不占布局宽度。
         指针热区由内部 11px 透明子元素提供，线条本身不因为“好拖”而变粗。 */
      const splitterStyle = {
        position: 'absolute', top: 0, bottom: 0, width: 1, marginRight: -0.5,
        zIndex: 2, background: '#ECE4D8', cursor: 'col-resize', touchAction: 'none',
        transition: 'background .15s ease, box-shadow .15s ease',
      }
      const splitterHoverStyle = {
        ...splitterStyle, background: SPLITTER_BRAND,
        boxShadow: `0 0 6px ${splitterRgba(SPLITTER_BRAND, 0.55)}`,
      }
      const splitterDragStyle = {
        ...splitterHoverStyle,
        boxShadow: `0 0 10px ${splitterRgba(SPLITTER_BRAND, 0.8)}`,
      }
      const splitterHitStyle = {
        position: 'absolute', top: 0, bottom: 0, left: -5, width: 11,
        background: 'transparent', cursor: 'col-resize',
      }
      const splitterGripStyle = {
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 14, height: 22, borderRadius: 4, background: SPLITTER_BRAND,
        color: '#fff', fontSize: 11, lineHeight: '22px', letterSpacing: '-1px', textAlign: 'center',
        opacity: 0.95, pointerEvents: 'none', userSelect: 'none',
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.18)',
      }
      const dragShieldStyle = {
        position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 4,
        cursor: 'col-resize', background: 'transparent', touchAction: 'none',
      }
      const fallbackStyle = { padding: 24, color: '#2A241C', fontSize: 13, lineHeight: 1.7 }
      const noteStyle = {
        margin: 0, padding: '6px 12px', background: '#FAF2D8', color: '#5A4A1A', fontSize: 12,
      }
      const padStyle = {
        display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center',
        padding: 20, color: '#5B6B73', fontSize: 12.5, lineHeight: 1.75,
      }

      let bridge = null

      function Panel({ conversation }) {
        const [generation, setGeneration] = React.useState(0)
        const [broken, setBroken] = React.useState(false)
        const [note, setNote] = React.useState('')
        const [width, setWidth] = React.useState(loadWidth)
        const [paneOpen, setPaneOpen] = React.useState(true)
        const [connecting, setConnecting] = React.useState(false)
        const [narrow, setNarrow] = React.useState(false)
        const [dragging, setDragging] = React.useState(false)
        const [hovering, setHovering] = React.useState(false)

        const brokenTimer = React.useRef(null)
        const shellRef = React.useRef(null)
        const dragHostRef = React.useRef(null)
        const frameRef = React.useRef(null)

        const hasConversation = Boolean(conversation)
        const canOpenSession = typeof bridge?.desktopWorkbenches?.ensureSession === 'function'

        // 8 秒内没有 onLoad 就当作没起来：宁可给可重试的提示，也不留一块白板。
        React.useEffect(() => {
          setBroken(false)
          brokenTimer.current = setTimeout(() => setBroken(true), 8000)
          return () => clearTimeout(brokenTimer.current)
        }, [generation])

        // 窄屏判定用**容器宽度**而不是窗口宽度：宿主主区宽度不等于窗口宽度（合同基线）。
        React.useEffect(() => {
          const host = shellRef.current
          if (!host || typeof ResizeObserver !== 'function') return undefined
          const observer = new ResizeObserver((entries) => {
            const w = entries[0]?.contentRect?.width ?? 0
            setNarrow(w > 0 && w < NARROW_BELOW)
          })
          observer.observe(host)
          return () => observer.disconnect()
        }, [])

        const applyWidth = React.useCallback((next) => {
          const snapped = round4(snapWidth(next))
          setWidth(snapped)
          saveWidth(snapped)
        }, [])

        /* ---- splitter：鼠标/触控拖动 ---- */

        const stopDrag = React.useCallback(() => {
          dragHostRef.current = null
          setDragging(false)
        }, [])

        React.useEffect(() => {
          if (!dragging) return undefined
          const onMove = (event) => {
            const host = dragHostRef.current
            if (!host) return
            const rect = host.getBoundingClientRect()
            if (!rect.width) return
            // 会话在右侧：指针越靠左，会话越宽
            applyWidth((rect.right - event.clientX) / rect.width)
          }
          document.addEventListener('pointermove', onMove)
          document.addEventListener('pointerup', stopDrag)
          document.addEventListener('pointercancel', stopDrag)
          return () => {
            document.removeEventListener('pointermove', onMove)
            document.removeEventListener('pointerup', stopDrag)
            document.removeEventListener('pointercancel', stopDrag)
          }
        }, [dragging, applyWidth, stopDrag])

        const onSplitterPointerDown = (event) => {
          event.preventDefault()
          try { event.currentTarget.setPointerCapture?.(event.pointerId) } catch { /* 旧宿主无指针捕获：document 监听仍可拖动 */ }
          dragHostRef.current = shellRef.current
          setDragging(true)
        }

        const onSplitterKeyDown = (event) => {
          const delta = { ArrowLeft: AGENT_STEP, ArrowRight: -AGENT_STEP }[event.key] // 会话在右：← 变宽
          if (delta !== undefined) { event.preventDefault(); applyWidth(width + delta); return }
          if (event.key === 'Home') { event.preventDefault(); applyWidth(AGENT_MAX); return }
          if (event.key === 'End') { event.preventDefault(); applyWidth(AGENT_MIN) }
        }

        /* ---- 打开 / 收起 AI 对话（只调起或复用会话，绝不自动发送） ---- */

        async function openAgent() {
          setNote('')
          if (!canOpenSession) { setNote(UNAVAILABLE_NOTE); return }
          setConnecting(true)
          try {
            await bridge.desktopWorkbenches.ensureSession()
            setPaneOpen(true)
            setNote('会话已就绪，可以在右侧继续对话。')
          } catch (error) {
            setNote(`没能调起会话：${error?.message ?? error}`)
          } finally {
            setConnecting(false)
          }
        }

        function onAgentClick() {
          if (!hasConversation) { void openAgent(); return }
          // 收起只是隐藏，不结束、不删除会话：再点一次回到同一个会话。
          setPaneOpen((open) => !open)
          setNote('')
        }

        const agentLabel = !canOpenSession
          ? 'AI 对话暂不可用'
          : connecting ? '正在连接…'
            : !hasConversation ? 'AI 对话'
              : paneOpen ? '收起 AI 对话' : '打开 AI 对话'

        const pct = Math.round(width * 100)
        const paneVisible = paneOpen && (hasConversation || connecting)

        return h('div', { ref: shellRef, style: rootStyle },
          /* 根节点首个子元素：语义 header（合同硬约束） */
          h('header', { style: headerStyle },
            h('span', { style: brandStyle }, BRAND),
            h('span', { style: verStyle }, `v${VERSION}`),
            h('span', { style: hintStyle },
              hasConversation
                ? '右侧是 DSH 原生会话：可拖中间分隔线调整宽度（25%–45%），收起不会结束会话。'
                : '还没有会话。点右侧「AI 对话」调起原生会话；本面板不会自动发送消息。'),
            h('div', { style: headerActionsStyle },
              h('button', {
                type: 'button',
                style: primaryButtonStyle,
                onClick: onAgentClick,
                disabled: connecting || !canOpenSession,
                'aria-label': `AI 对话：${agentLabel}`,
              }, agentLabel),
            ),
          ),
          (!canOpenSession || note) ? h('p', { role: 'status', style: noteStyle },
            !canOpenSession ? UNAVAILABLE_NOTE : note) : null,
          h('div', { style: bodyStyle },
            h('div', { style: businessStyle },
              broken
                ? h('div', { style: fallbackStyle },
                    h('p', null, `界面没有加载出来（v${VERSION} · ${UI_URL}）。`),
                    h('p', null, '本工作台的数据只存在你选择的本机目录里，不会因为这个提示丢失。'),
                    h('button', { type: 'button', style: primaryButtonStyle, onClick: () => setGeneration((n) => n + 1) }, '重新加载'))
                : h('iframe', {
                    key: generation,
                    ref: frameRef,
                    src: UI_URL,
                    title: TITLE,
                    style: frameStyle,
                    /* 只允许同源页面；沙箱不做限制，页面需要 localStorage 记住面板宽度 */
                    referrerPolicy: 'same-origin',
                    onLoad: () => { setBroken(false); clearTimeout(brokenTimer.current) },
                  })),
            // 分隔线必须夹在业务区与会话之间：放到 aside 之后会贴到面板最右缘，
            // 真正的分界线上就既没有悬停高亮也拖不动。
            // splitter 只在宽屏出现：窄屏是覆盖式抽屉，拖宽没有意义。
            !narrow && paneVisible && h('div', {
              role: 'separator',
              'aria-orientation': 'vertical',
              'aria-label': '调整 AI 对话面板宽度',
              'aria-valuemin': Math.round(AGENT_MIN * 100),
              'aria-valuemax': Math.round(AGENT_MAX * 100),
              'aria-valuenow': pct,
              tabIndex: 0,
              style: {
                ...(dragging ? splitterDragStyle : hovering ? splitterHoverStyle : splitterStyle),
                right: `${pct}%`,
              },
              onPointerDown: onSplitterPointerDown,
              onPointerEnter: () => setHovering(true),
              onPointerLeave: () => setHovering(false),
              onKeyDown: onSplitterKeyDown,
            },
              // 1px 线条 + 11px 透明热区：看起来是常规分界线，拖起来仍有足够命中面积
              h('span', { style: splitterHitStyle, 'aria-hidden': 'true' }),
              (hovering || dragging) ? h('span', { style: splitterGripStyle, 'aria-hidden': 'true' }, '⠿') : null),
            // 原生会话**始终挂载**：卸载会丢掉输入框与草稿状态，所以隐藏走 display，不卸载组件。
            h('aside', {
              style: {
                ...paneStyle,
                ...(narrow ? drawerStyle : null),
                width: narrow ? `min(92%, ${DRAWER_MAX}px)` : `${pct}%`,
                display: paneVisible ? 'flex' : 'none',
              },
              'aria-label': 'AI 对话',
              'aria-hidden': paneVisible ? undefined : 'true',
            }, conversation ?? h('div', { style: padStyle },
              h('b', null, 'AI 对话还没开始'),
              h('span', null, '点顶栏「AI 对话」调起 DSH 原生会话后，它会固定出现在这一侧。'),
              h('span', null, '没有会话也不影响记录：左侧的业务视图照常可用。'))),
            // 拖动时铺一层透明遮罩：指针一旦掠到业务 iframe 上，指针事件就归子文档，
            // document 上的监听收不到；遮罩让整个面板都成为我们的命中区。
            dragging && !narrow && h('div', { 'aria-hidden': 'true', style: dragShieldStyle }),
          ),
        )
      }

      function apply(ctx) {
        bridge = ctx
        ctx.effect(() => ctx.desktopWorkbenches.register({
          title: TITLE,
          /* 仓库地址写**字面量**：社区静态检查从描述符里逐字读，用常量会在检查里“看不见”。 */
          repository: "https://github.com/xyb-openharness-dsh-plugins/gist-workbench",
          description: DESCRIPTION,
          businessSide: 'left',
          businessWidth: 0.65,
          customFrame: true,
        }, Panel))
      }

      return { apply, inject: ['desktopWorkbenches'] }
    },
  })
})()