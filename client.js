/**
 * dsh-xmm-ai — browser half.
 *
 * Registers one sidebar entry and the full configuration page behind it. The
 * page is registered into the keyed `main` slot under the same id the sidebar
 * row uses, which is how the host wires a nav row to a panel.
 *
 * Deliberately defensive, because a slot component that throws leaves the host
 * rendering an empty anchor with no message:
 *   - no `t` prop is required (labels fall back to the plugin's own dictionary),
 *   - the form skeleton renders on the first frame, before any fetch resolves,
 *   - a class error boundary keeps a later failure visible instead of blank.
 */
window.__ModuleLoader__.load({
  id: 'dsh-xmm-ai',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const useState = React.useState
    const useEffect = React.useEffect
    const useCallback = React.useCallback

    const NAMESPACE = 'settings.dsh-xmm-ai'
    const PANEL_ID = 'dsh-xmm-ai'
    const CONFIG_PATH = '/plugins/dsh-xmm-ai/__config'
    const SAVE_PATH = '/plugins/dsh-xmm-ai/__save'
    const STATUS_PATH = '/plugins/dsh-xmm-ai/__status'
    const MODELS_PATH = '/plugins/dsh-xmm-ai/__models'
    const DIAG_PATH = '/plugins/dsh-xmm-ai/__diag'

    /**
     * Report one breadcrumb to the host half.
     *
     * A blank panel is invisible from the outside: the host draws an empty
     * anchor and the browser console is not available to the person debugging
     * it. Posting what the client reached lets the failure be read back through
     * this plugin's own `__diag` endpoint. Never throws and never awaited.
     */
    function report(stage, detail) {
      try {
        const payload = { stage, detail: detail === undefined ? undefined : String(detail).slice(0, 2000) }
        if (typeof location !== 'undefined' && location.href) payload.href = location.href
        fetch(DIAG_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch(() => {})
      } catch { /* diagnostics must never break the page */ }
    }

    // Probe the module table once: which React entry points this host exposes is
    // the difference between "hooks registered" and "hooks silently ignored".
    try {
      const keys = React && typeof React === 'object' ? Object.keys(React).sort() : []
      report('react-shape', [
        `type=${typeof React}`,
        `keys=${keys.join('|')}`,
        `createElement=${typeof React.createElement}`,
        `useState=${typeof React.useState}`,
        `useEffect=${typeof React.useEffect}`,
        `useCallback=${typeof React.useCallback}`,
        `useRef=${typeof React.useRef}`,
        `useMemo=${typeof React.useMemo}`,
        `Component=${typeof React.Component}`,
        `default=${typeof React.default}`,
      ].join(' '))
    } catch (error) {
      report('react-shape-failed', error && error.message ? error.message : String(error))
    }

    report('module-evaluated', 'client half started')

    const copy = {
      en: {
        'nav.label': '小咪AI兼容接口',
        'page.title': '小咪AI兼容接口',
        'page.subtitle': '配置由dsh系列插件提供服务的 OpenAI 兼容接口',
        'page.back': 'Back to chat',
        'server.title': 'How to call it',
        'server.port': 'Listening port',
        'server.portNote': 'Owned by the Harness web server; this plugin adds routes on it.',
        'server.models': 'Model list',
        'server.chat': 'Chat completions',
        'server.copy': 'Copy',
        'server.copied': 'Copied',
        'field.enabled': 'Enable the API',
        'field.enabled.hint': 'Off: every API route answers 503 while this page keeps working.',
        'field.apiPath': 'Path prefix',
        'field.apiPath.hint': 'Where the OpenAI routes live (default /v1). /models and /chat/completions are appended.',
        'field.apiKeys': 'API keys',
        'field.apiKeys.hint': 'One key per line (or comma-separated). Each is accepted as Authorization: Bearer <key>. Empty means no authentication. A trailing # note is ignored.',
        'field.apiKeys.count': 'configured: {count}',
        'field.defaultModel': 'Default model',
        'field.defaultModel.hint': 'Used when a request omits model or sends "default". Click "Refresh models" to read what the enabled dsh-connect-* plugins offer.',
        'field.defaultModel.refresh': 'Refresh models',
        'field.allowRemote': 'Allow remote clients',
        'field.allowRemote.hint': 'Off: loopback only. On: accept clients from the network. Only on a trusted network.',
        'field.fixedPort': 'Fixed port (standalone API)',
        'field.fixedPort.hint': 'The Desktop host changes its own port on every launch. Set a port here (e.g. 8080) to give this API a stable address via an independent listener. 0 disables it and uses the host port.',
        'field.showSidebar': 'Show entry in left sidebar',
        'field.showSidebar.hint': 'Off hides this plugin\'s row from the left sidebar. The settings entry and the fixed-port API keep working.',
        'button.save': 'Save',
        'button.saving': 'Saving…',
        'button.refresh': 'Reload',
        'button.generate': 'Add a random key',
        'status.loadError': 'Could not load configuration: {error}',
        'status.saved': 'Saved. Changes take effect immediately.',
        'status.saveError': 'Save failed: {error}',
        'status.loading': 'Loading configuration…',
        'status.crashed': 'This page failed to render: {error}',
      },
      zh: {
        'nav.label': '小咪AI兼容接口',
        'page.title': '小咪AI兼容接口',
        'page.subtitle': '配置由dsh系列插件提供服务的 OpenAI 兼容接口',
        'page.back': '返回对话',
        'server.title': '调用方式',
        'server.port': '监听端口',
        'server.portNote': '端口属于 Harness Web 服务，本插件在其上注册路由。',
        'server.models': '模型列表',
        'server.chat': '聊天补全',
        'server.copy': '复制',
        'server.copied': '已复制',
        'field.enabled': '启用接口',
        'field.enabled.hint': '关闭后所有接口返回 503，本页仍可正常使用。',
        'field.apiPath': '路径前缀',
        'field.apiPath.hint': 'OpenAI 路由所在前缀，默认 /v1；其后自动接 /models 与 /chat/completions。',
        'field.apiKeys': 'API Key 列表',
        'field.apiKeys.hint': '可自由增减多行：每行一个 Key，并可为每个 Key 填备注。每个 Key 都能用 Authorization: Bearer <key> 调用，留空全部则关闭鉴权。',
        'field.apiKeys.count': '已配置：{count}',
        'field.defaultModel': '默认模型',
        'field.defaultModel.hint': '请求未指定 model 或填 default 时使用该模型。点「刷新模型」读取已启用的 dsh-connect-* 插件提供的模型。',
        'field.defaultModel.refresh': '刷新模型',
        'field.allowRemote': '允许远程客户端',
        'field.allowRemote.hint': '关闭：仅本机访问。开启：接受来自网络的请求。请仅在可信网络开启。',
        'field.fixedPort': '固定端口（独立接口）',
        'field.fixedPort.hint': '桌面端每次启动都会改变自身端口。这里填一个端口（如 8080），插件会另外监听该端口，让接口地址固定不变。填 0 则关闭，继续用宿主端口。',
        'field.showSidebar': '在左侧菜单显示入口',
        'field.showSidebar.hint': '关闭后左侧菜单不再显示本插件入口；设置入口和固定端口接口不受影响。',
        'button.save': '保存',
        'button.saving': '保存中…',
        'button.refresh': '重新加载',
        'button.generate': '生成随机 Key',
        'status.loadError': '加载配置失败：{error}',
        'status.saved': '已保存，立即生效。',
        'status.saveError': '保存失败：{error}',
        'status.loading': '正在加载配置…',
        'status.crashed': '页面渲染失败：{error}',
      },
    }

    /** Fill `{name}` placeholders without depending on the locale service. */
    function format(text, vars) {
      if (vars === undefined) return text
      return String(text).replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole))
    }

    const FALLBACK_LOCALE = (typeof navigator !== 'undefined' && /^zh/i.test(navigator.language ?? '')) ? 'zh' : 'en'

    /** Resolve a label from the injected `t` when present, else from the local dictionary. */
    function makeT(props) {
      const injected = props && props.t
      return (key, vars) => {
        if (typeof injected === 'function') {
          const viaHost = injected(key, vars)
          // An unresolved key comes back as the key itself; fall back to our copy.
          if (typeof viaHost === 'string' && viaHost !== key) return viaHost
        }
        const dict = copy[FALLBACK_LOCALE] ?? copy.en
        const text = dict[key] ?? copy.en[key] ?? key
        return format(text, vars)
      }
    }

    /**
     * React-side styles for the page chrome.
     *
     * Every colour is a real DSH token with `inherit` as the fallback: the first
     * version fell back to light literal colours, which vanish on a light theme.
     * `inherit` keeps the host's own text colour when a token is absent, so the
     * chrome is readable under either theme.
     */
    const styles = {
      root: {
        maxWidth: 760,
        margin: '0 auto',
        padding: '24px 20px 48px',
        color: 'var(--dsw-alias-label-primary, inherit)',
        fontFamily: 'inherit',
        boxSizing: 'border-box',
        // The centre column clips overflow, so the page owns its own scroller.
        height: '100%',
        overflowY: 'auto',
      },
      header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 },
      h1: { fontSize: 20, fontWeight: 600, margin: 0 },
      subtitle: { fontSize: 13, color: 'var(--dsw-alias-label-secondary, inherit)', margin: '0 0 20px' },
      card: {
        border: '1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.28))',
        borderRadius: 10,
        background: 'var(--dsw-alias-bg-layer-1, rgba(127,127,127,0.06))',
        padding: 18,
        marginBottom: 18,
      },
      cardTitle: { fontSize: 15, fontWeight: 600, margin: '0 0 14px' },
      row: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 },
      label: { fontSize: 13, fontWeight: 500 },
      hint: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, inherit)', lineHeight: 1.5 },
      input: {
        background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.10))',
        color: 'var(--dsw-alias-label-primary, inherit)',
        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
        borderRadius: 6,
        padding: '8px 10px',
        fontSize: 13,
        outline: 'none',
        fontFamily: 'inherit',
        boxSizing: 'border-box',
        width: '100%',
      },
      select: {
        background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.10))',
        color: 'var(--dsw-alias-label-primary, inherit)',
        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
        borderRadius: 6,
        padding: '8px 10px',
        fontSize: 13,
        fontFamily: 'inherit',
        maxWidth: 320,
      },
      checkRow: { display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 18 },
      checkbox: { margin: '3px 0 0', width: 15, height: 15, accentColor: 'var(--dsw-alias-brand-primary, #3b82f6)' },
      actions: { display: 'flex', gap: 10, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' },
      button: {
        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
        background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.12))',
        color: 'var(--dsw-alias-label-primary, inherit)',
        borderRadius: 6,
        padding: '7px 16px',
        fontSize: 13,
        cursor: 'pointer',
        fontFamily: 'inherit',
      },
      primary: {
        border: '1px solid transparent',
        background: 'var(--dsw-alias-brand-primary, #3b82f6)',
        color: '#ffffff',
        borderRadius: 6,
        padding: '7px 16px',
        fontSize: 13,
        cursor: 'pointer',
        fontFamily: 'inherit',
      },
      smallButton: {
        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35))',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary, inherit)',
        borderRadius: 6,
        padding: '3px 10px',
        fontSize: 12,
        cursor: 'pointer',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        flexShrink: 0,
      },
      status: { fontSize: 12 },
      ok: { color: 'var(--dsw-alias-label-success, #15803d)' },
      err: { color: 'var(--dsw-alias-label-error, #dc2626)' },
      code: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        color: 'var(--dsw-alias-label-secondary, inherit)',
        display: 'block',
        overflowWrap: 'anywhere',
      },
      back: {
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-brand-primary, #3b82f6)',
        fontSize: 12,
        cursor: 'pointer',
        padding: 0,
        fontFamily: 'inherit',
      },
    }

    function Icon(props) {
      const size = typeof props?.size === 'number' ? props.size : 16
      return h('svg', {
        width: size, height: size, viewBox: '0 0 36 36', 'aria-hidden': true,
        style: { display: 'block', color: 'currentColor' },
      },
        h('path', {
          d: 'M13 8.5H8.5a2 2 0 0 0-2 2V15a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4.5a2 2 0 0 0 2 2H13',
          fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M23 8.5h4.5a2 2 0 0 1 2 2V15a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4.5a2 2 0 0 1-2 2H23',
          fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
        h('circle', { cx: 18, cy: 18, r: 3.1, fill: 'none', stroke: 'currentColor', strokeWidth: 2.2 }),
      )
    }

    function randomKey() {
      const bytes = new Uint8Array(24)
      if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
      else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
      return 'xmm-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    }

    const BLANK_DRAFT = { enabled: true, apiPath: '/v1', apiKeys: '', defaultModel: '', allowRemote: false, fixedPort: 0, showSidebar: true }

    /** Notify the host page that the sidebar-entry preference changed. */
    function notifySidebarChange(show) {
      try {
        globalThis.dispatchEvent?.(new CustomEvent('xmm-ai-sidebar-change', { detail: { show } }))
      } catch { /* best effort */ }
      try {
        if (globalThis.__xmmWorkbuddySidebarChanged) globalThis.__xmmWorkbuddySidebarChanged(show)
      } catch { /* best effort */ }
    }

    /**
     * Whether the render-triggered first load already fired.
     *
     * Module-level rather than a ref because the render path must not depend on
     * a hook this host may not expose; one page instance per client makes the
     * shared flag correct here.
     */
    let firstLoadStarted = false

    function EndpointRow(props) {
      return h('div', { style: { marginBottom: 10 } },
        h('div', { style: styles.label }, props.label),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('code', { style: styles.code }, props.value),
          h('button', {
            style: styles.smallButton,
            type: 'button',
            onClick: () => {
              try {
                if (globalThis.navigator?.clipboard?.writeText) globalThis.navigator.clipboard.writeText(props.value)
              } catch { /* clipboard is best-effort */ }
              props.onCopied()
            },
          }, props.copied ? props.copiedLabel : props.copyLabel),
        ),
      )
    }

    function Page(props) {
      const passed = props ?? {}
      try {
        report('page-rendered', `props=${Object.keys(passed).join(',') || '(none)'}`)
      } catch { /* reporting must never break rendering */ }

      // Fallback for a host that never invokes the ref callback: retry the lookup
      // a few times after the tree has been attached to the document.
      try {
        if (typeof document !== 'undefined' && !document.getElementById(PANEL_HOST_ID + '-pending')) {
          const marker = document.createElement('span')
          marker.id = PANEL_HOST_ID + '-pending'
          marker.style.display = 'none'
          ;(document.body ?? document.documentElement)?.appendChild(marker)
          let tries = 0
          const retry = () => {
            tries += 1
            if (mountPanelForm(null)) {
              marker.remove()
              return
            }
            if (tries < 40) setTimeout(retry, 100)
            else marker.remove()
          }
          setTimeout(retry, 0)
        }
      } catch { /* the ref path may still work */ }

      // The form is native DOM mounted into this container, so the page shows the
      // configuration directly. React only supplies the scroll container.
      return h('div', { style: styles.root },
        h('div', { style: styles.header },
          h(Icon, { size: 28 }),
          h('h1', { style: styles.h1 }, '小咪AI兼容接口'),
        ),
        h('div', { style: styles.subtitle }, '配置由dsh系列插件提供服务的 OpenAI 兼容接口'),
        h('div', {
          id: PANEL_HOST_ID,
          ref: mainPanelRef,
          style: { minHeight: 1 },
        }),
      )
    }

    /**
     * The configuration UI, built with native DOM instead of React.
     *
     * Every React-based attempt at this page rendered blank on this host: the
     * functions were invoked (the diagnostics prove `page-rendered` fired) but no
     * effect or lifecycle ever ran, so the form never received data. A plain
     * `<button>` rendered and its click handler worked, though — so this builds
     * the whole form with `document.createElement`, which cannot be affected by
     * the renderer's component semantics at all.
     */

    /** Small helper: element with attributes, children, and inline style. */
    function el(tag, props, children) {
      const node = document.createElement(tag)
      if (props) {
        for (const key of Object.keys(props)) {
          const value = props[key]
          if (value === undefined || value === null) continue
          if (key === 'style') node.style.cssText = value
          else if (key === 'text') node.textContent = value
          else if (key.startsWith('on') && typeof value === 'function') {
            node.addEventListener(key.slice(2).toLowerCase(), value)
          } else if (key === 'checked') node.checked = value === true
          else if (key === 'value') node.value = value
          else node.setAttribute(key, value)
        }
      }
      for (const child of children ?? []) {
        if (child === null || child === undefined) continue
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
      }
      return node
    }

    /**
     * Inline styles for the native form.
     *
     * Every colour is a DSH theme token, never a literal. The first version
     * hard-coded light text (`#e5e7eb`), which is invisible on this user's light
     * theme — tokens follow the active theme in both directions, so light text
     * gets a dark surface and dark text a light one. Each declaration carries a
     * literal fallback only for a host that omits the token.
     */
    const DLG = {
      card: 'border:1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.28));border-radius:10px;background:var(--dsw-alias-bg-layer-1, rgba(127,127,127,0.06));padding:18px;margin-bottom:18px;color:var(--dsw-alias-label-primary, inherit)',
      title: 'font-size:15px;font-weight:600;margin:0 0 14px;color:var(--dsw-alias-label-primary, inherit)',
      row: 'display:flex;flex-direction:column;gap:6px;margin-bottom:16px',
      label: 'font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary, inherit)',
      hint: 'font-size:12px;color:var(--dsw-alias-label-secondary, rgba(127,127,127,0.9));line-height:1.5',
      input: 'background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.10));color:var(--dsw-alias-label-primary, inherit);border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35));border-radius:6px;padding:8px 10px;font-size:13px;width:100%;box-sizing:border-box;font-family:inherit',
      select: 'background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.10));color:var(--dsw-alias-label-primary, inherit);border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35));border-radius:6px;padding:8px 10px;font-size:13px;max-width:320px;font-family:inherit',
      checkRow: 'display:flex;align-items:flex-start;gap:10px;margin-bottom:16px',
      check: 'margin:3px 0 0;width:15px;height:15px',
      button: 'border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35));background:var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.12));color:var(--dsw-alias-label-primary, inherit);border-radius:6px;padding:7px 16px;font-size:13px;cursor:pointer;font-family:inherit',
      primary: 'border:1px solid transparent;background:var(--dsw-alias-brand-primary, #3b82f6);color:#fff;border-radius:6px;padding:7px 16px;font-size:13px;cursor:pointer;font-family:inherit',
      small: 'border:1px solid var(--dsw-alias-border-l2, rgba(127,127,127,0.35));background:transparent;color:var(--dsw-alias-label-primary, inherit);border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer;font-family:inherit',
      code: 'font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--dsw-alias-label-secondary, rgba(127,127,127,0.9));display:block;overflow-wrap:anywhere',
      status: 'font-size:12px;color:var(--dsw-alias-label-secondary, rgba(127,127,127,0.9))',
    }

    /**
     * Build the configuration form as a detached DOM tree.
     *
     * Returns the node plus a `reload` function. The form is embedded directly
     * in the sidebar page, so it needs no dialog chrome of its own.
     */
    function buildConfigForm() {
      const statusLine = el('div', { style: DLG.status })
      const setStatus = (text, isError) => {
        statusLine.textContent = text
        statusLine.style.color = isError
          ? 'var(--dsw-alias-label-error, #dc2626)'
          : 'var(--dsw-alias-label-success, #15803d)'
      }

      // The form is always embedded in the page; the host supplies the heading.

      const header = el('div', null, [])
      const subtitle = el('div', null, [])

      // --- endpoints card ---------------------------------------------------
      const portLine = el('div', { style: 'font-size:13px' }, ['—'])
      const baseUrlLine = el('code', { style: DLG.code }, ['—'])
      const modelsLine = el('code', { style: DLG.code })
      const chatLine = el('code', { style: DLG.code })
      const copyBaseBtn = el('button', { style: DLG.small, type: 'button', text: '复制' })
      const copyModelsBtn = el('button', { style: DLG.small, type: 'button', text: '复制' })
      const copyChatBtn = el('button', { style: DLG.small, type: 'button', text: '复制' })
      const endpointsCard = el('div', { style: DLG.card }, [
        el('div', { style: DLG.title }, ['调用方式']),
        el('div', { style: DLG.row }, [
          el('div', { style: DLG.label }, ['接口地址（复制到 SDK 的 base_url）']),
          el('div', { style: 'display:flex;align-items:center;gap:8px' }, [baseUrlLine, copyBaseBtn]),
          el('div', { style: DLG.hint }, ['这是包含 v1 路径前缀的完整地址，OpenAI SDK 的 base_url 直接填它即可。']),
        ]),
        el('div', { style: DLG.row }, [
          el('div', { style: DLG.label }, ['监听端口']),
          portLine,
          el('div', { style: DLG.hint }, ['端口属于 Harness Web 服务，本插件在其上注册路由。']),
        ]),
        el('div', { style: DLG.row }, [
          el('div', { style: DLG.label }, ['模型列表']),
          el('div', { style: 'display:flex;align-items:center;gap:8px' }, [modelsLine, copyModelsBtn]),
        ]),
        el('div', { style: DLG.row }, [
          el('div', { style: DLG.label }, ['聊天补全']),
          el('div', { style: 'display:flex;align-items:center;gap:8px' }, [chatLine, copyChatBtn]),
        ]),
      ])

      // --- form fields ------------------------------------------------------
      const enabledInput = el('input', { type: 'checkbox', style: DLG.check, id: 'xmm-dlg-enabled' })
      const pathInput = el('input', { type: 'text', style: DLG.input, id: 'xmm-dlg-path', value: '/v1' })
      /**
       * Default model picker.
       *
       * A text field plus a `<datalist>` populated by the "refresh" button: the
       * value may be typed by hand (`qoder/qfmodel`) or picked from the live
       * catalog, and refreshing never clobbers a hand-typed value.
       */
      const modelInput = el('input', {
        type: 'text',
        style: DLG.input,
        id: 'xmm-dlg-model',
        value: '',
        placeholder: '例如 qoder/qfmodel；留空则要求客户端必须指定 model',
        list: 'xmm-dlg-model-options',
        autocomplete: 'off',
      })
      const modelOptions = el('datalist', { id: 'xmm-dlg-model-options' })
      const refreshModelsBtn = el('button', { style: DLG.button, type: 'button', text: '刷新模型' })
      const modelStatus = el('span', { style: DLG.hint }, [''])
      const remoteInput = el('input', { type: 'checkbox', style: DLG.check, id: 'xmm-dlg-remote' })
      const portInput = el('input', { type: 'number', min: '0', max: '65535', style: DLG.input, id: 'xmm-dlg-port', value: '0' })
      const sidebarInput = el('input', { type: 'checkbox', style: DLG.check, id: 'xmm-dlg-sidebar' })

      /**
       * Editable API-key rows.
       *
       * Each row is an independent key plus a free-text note. The serialised
       * form is `key # note` per line, which the Host already parses: the key is
       * everything before the first `#`, the note everything after. Keys
       * themselves never contain `#`, so the split is unambiguous.
       */
      const keyRows = el('div', { style: 'display:flex;flex-direction:column;gap:10px' })
      const keyCountLabel = el('span', { style: DLG.hint }, ['已配置：0'])
      const keyInputs = [] // { key: HTMLInputElement, note: HTMLInputElement, row: HTMLElement }

      const refreshKeyCount = () => {
        const n = keyInputs.filter((entry) => entry.key.value.trim() !== '').length
        keyCountLabel.textContent = `已配置：${n}`
      }

      const makeKeyRow = (keyValue, noteValue) => {
        const keyField = el('input', {
          type: 'text',
          value: keyValue || '',
          placeholder: 'API Key（留空则该行不保存）',
          style: DLG.input + ';font-family:ui-monospace,Menlo,monospace',
        })
        const noteField = el('input', {
          type: 'text',
          value: noteValue || '',
          placeholder: '备注，例如：手机 / 服务器 A',
          style: DLG.input,
        })
        const genBtn = el('button', {
          style: DLG.small,
          type: 'button',
          text: '🎲 生成',
          title: '为这一行生成随机 Key',
          onClick: () => { keyField.value = randomKey(); refreshKeyCount() },
        })
        const delBtn = el('button', {
          style: DLG.small,
          type: 'button',
          text: '✕ 删除',
          title: '删除这一行',
          onClick: () => {
            const idx = keyInputs.findIndex((entry) => entry.row === row)
            if (idx >= 0) keyInputs.splice(idx, 1)
            row.remove()
            refreshKeyCount()
          },
        })
        const row = el('div', {
          style: 'display:grid;grid-template-columns:1fr 1fr auto auto;gap:8px;align-items:center',
        }, [keyField, noteField, genBtn, delBtn])
        keyField.addEventListener('input', refreshKeyCount)
        keyInputs.push({ key: keyField, note: noteField, row })
        keyRows.appendChild(row)
        return row
      }

      const addKeyBtn = el('button', {
        style: DLG.small,
        type: 'button',
        text: '＋ 添加 Key',
        onClick: () => { makeKeyRow('', ''); refreshKeyCount() },
      })

      const generateBtn = el('button', {
        style: DLG.small,
        type: 'button',
        text: '生成随机 Key',
        onClick: () => {
          const blank = keyInputs.find((entry) => entry.key.value.trim() === '')
          if (blank) blank.key.value = randomKey()
          else makeKeyRow(randomKey(), '')
          refreshKeyCount()
        },
      })

      /** Serialise rows into the Host's `key # note` per-line format. */
      const serialiseKeys = () => keyInputs
        .map((entry) => {
          const key = entry.key.value.trim()
          if (!key) return ''
          const note = entry.note.value.trim()
          return note ? `${key} # ${note}` : key
        })
        .filter((line) => line !== '')
        .join('\n')

      /** Parse the Host's string back into editable rows. */
      const parseKeys = (raw) => {
        const lines = typeof raw === 'string'
          ? raw.split(/\n+/).map((s) => s.trim()).filter(Boolean)
          : []
        return lines.map((line) => {
          const hash = line.indexOf('#')
          const key = (hash >= 0 ? line.slice(0, hash) : line).trim()
          const note = (hash >= 0 ? line.slice(hash + 1) : '').trim()
          return { key, note }
        })
      }

      const saveBtn = el('button', { style: DLG.primary, type: 'button', text: '保存' })
      const reloadBtn = el('button', { style: DLG.button, type: 'button', text: '重新加载' })

      const formCard = el('div', { style: DLG.card }, [
        el('div', { style: DLG.title }, ['配置项']),

        el('div', { style: DLG.checkRow }, [
          enabledInput,
          el('div', null, [
            el('label', { style: DLG.label, for: 'xmm-dlg-enabled' }, ['启用接口']),
            el('div', { style: DLG.hint }, ['关闭后所有接口返回 503，本页仍可正常使用。']),
          ]),
        ]),

        el('div', { style: DLG.row }, [
          el('label', { style: DLG.label, for: 'xmm-dlg-path' }, ['路径前缀']),
          pathInput,
          el('div', { style: DLG.hint }, ['OpenAI 路由所在前缀，默认 /v1；其后自动接 /models 与 /chat/completions。']),
        ]),

        el('div', { style: DLG.row }, [
          el('div', { style: DLG.label }, ['API Key 列表']),
          keyRows,
          el('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:2px' }, [
            addKeyBtn,
            generateBtn,
            keyCountLabel,
          ]),
          el('div', { style: DLG.hint }, ['可自由增减多行：每行一个 Key，并可为每个 Key 填备注。每个 Key 都能用 Authorization: Bearer <key> 调用。留空全部则关闭鉴权。']),
        ]),

        el('div', { style: DLG.row }, [
          el('label', { style: DLG.label, for: 'xmm-dlg-model' }, ['默认模型']),
          el('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' }, [
            modelInput,
            refreshModelsBtn,
            modelStatus,
          ]),
          modelOptions,
          el('div', { style: DLG.hint }, ['请求未指定 model 或填 default 时使用该模型。点「刷新模型」从当前已启用的 dsh-connect-* 插件读取可用模型。']),
        ]),

        el('div', { style: DLG.checkRow }, [
          remoteInput,
          el('div', null, [
            el('label', { style: DLG.label, for: 'xmm-dlg-remote' }, ['允许远程客户端']),
            el('div', { style: DLG.hint }, ['关闭：仅本机访问。开启：接受来自网络的请求。请仅在可信网络开启。']),
          ]),
        ]),

        el('div', { style: DLG.row }, [
          el('label', { style: DLG.label, for: 'xmm-dlg-port' }, ['固定端口（独立接口）']),
          portInput,
          el('div', { style: DLG.hint }, ['桌面端每次启动都会改变自身端口。填一个端口（如 8080）让接口地址固定；填 0 则用宿主端口。保存后可能需要重启应用才会监听新端口。']),
        ]),

        el('div', { style: DLG.checkRow }, [
          sidebarInput,
          el('div', null, [
            el('label', { style: DLG.label, for: 'xmm-dlg-sidebar' }, ['在左侧菜单显示入口']),
            el('div', { style: DLG.hint }, ['关闭后左侧菜单不再显示本插件入口；设置入口和固定端口接口不受影响。']),
          ]),
        ]),

        el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:4px' }, [
          saveBtn,
          reloadBtn,
          statusLine,
        ]),
      ])

      // --- behaviour --------------------------------------------------------
      const applyConfig = (cfg) => {
        enabledInput.checked = cfg.enabled !== false
        pathInput.value = typeof cfg.apiPath === 'string' && cfg.apiPath !== '' ? cfg.apiPath : '/v1'
        // Rebuild the key rows from the stored `key # note` lines.
        keyInputs.length = 0
        keyRows.textContent = ''
        const parsed = parseKeys(cfg.apiKeys)
        if (parsed.length === 0) makeKeyRow('', '')
        else for (const item of parsed) makeKeyRow(item.key, item.note)
        refreshKeyCount()
        modelInput.value = typeof cfg.defaultModel === 'string' ? cfg.defaultModel : ''
        remoteInput.checked = cfg.allowRemote === true
        portInput.value = String(Number(cfg.fixedPort) || 0)
        sidebarInput.checked = cfg.showSidebar !== false
        refreshUrls()
      }

      /** The Harness origin, read from the status route; addresses derive from it. */
      let origin = ''

      /**
       * Recompute every displayed endpoint.
       *
       * When a fixed port is set, the standalone listener serves the API
       * directly under the prefix (`http://127.0.0.1:<port><prefix>`), so the
       * address stays stable across Desktop restarts. Otherwise fall back to
       * the host's changing origin and the plugin route prefix.
       */
      const refreshUrls = () => {
        const prefix = pathInput.value || '/v1'
        const port = Number(portInput.value) || 0
        const base = port > 0
          ? `http://127.0.0.1:${port}${prefix}`
          : `${origin}/plugins/dsh-xmm-ai${prefix}`
        baseUrlLine.textContent = base
        modelsLine.textContent = `${base}/models`
        chatLine.textContent = `${base}/chat/completions`
      }

      const loadConfig = async () => {
        setStatus('正在加载…', false)
        try {
          const response = await fetch(CONFIG_PATH, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const data = await response.json()
          applyConfig(data.config ?? {})
          setStatus('已加载', false)
          // Populate the picker eagerly so the field is usable without a click.
          refreshModels()
          report('dialog-loaded', JSON.stringify(Object.keys(data.config ?? {})))
        } catch (error) {
          setStatus(`加载失败：${error && error.message ? error.message : error}`, true)
          report('dialog-load-failed', String(error && error.message ? error.message : error))
        }
        try {
          const factsResponse = await fetch(STATUS_PATH, { headers: { accept: 'application/json' } })
          if (factsResponse.ok) {
            const facts = await factsResponse.json()
            portLine.textContent = facts && facts.port !== undefined ? String(facts.port) : '—'
            if (facts && facts.origin) {
              origin = String(facts.origin).replace(/\/+$/, '')
              refreshUrls()
            }
          }
        } catch { /* the port line stays empty */ }
      }

      pathInput.addEventListener('input', refreshUrls)
      portInput.addEventListener('input', refreshUrls)

      /**
       * Fill the `<datalist>` from the live catalogs.
       *
       * Deliberately non-destructive: the typed value is left alone, so a user
       * who already knows the id they want is never overridden by a refresh.
       */
      const refreshModels = async () => {
        refreshModelsBtn.disabled = true
        modelStatus.textContent = '读取中…'
        modelStatus.style.color = ''
        try {
          const response = await fetch(MODELS_PATH, { headers: { accept: 'application/json' } })
          const data = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
          const options = Array.isArray(data.options) ? data.options : []
          modelOptions.textContent = ''
          for (const option of options) {
            modelOptions.appendChild(el('option', { value: option.value, label: option.value }))
          }
          const groups = Array.isArray(data.groups) ? data.groups : []
          if (options.length === 0) {
            modelStatus.textContent = '没有可用模型，请先在 dsh-connect-* 插件里登录'
            modelStatus.style.color = '#b45309'
          } else {
            const summary = groups.map((g) => `${g.provider} ${g.count}`).join(' · ')
            modelStatus.textContent = `${options.length} 个（${summary}）`
            modelStatus.style.color = ''
          }
          report('dialog-models-refreshed', String(options.length))
        } catch (error) {
          modelStatus.textContent = `读取失败：${error && error.message ? error.message : error}`
          modelStatus.style.color = '#b91c1c'
          report('dialog-models-failed', String(error && error.message ? error.message : error))
        } finally {
          refreshModelsBtn.disabled = false
        }
      }

      refreshModelsBtn.addEventListener('click', () => { refreshModels() })

      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true
        setStatus('保存中…', false)
        try {
          const body = {
            enabled: enabledInput.checked,
            apiPath: pathInput.value,
            apiKeys: serialiseKeys(),
            defaultModel: modelInput.value.trim(),
            allowRemote: remoteInput.checked,
            fixedPort: Math.max(0, Math.min(65535, Number(portInput.value) || 0)),
            showSidebar: sidebarInput.checked,
          }
          const response = await fetch(SAVE_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(body),
          })
          const data = await response.json().catch(() => ({}))
          if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`)
          setStatus('已保存，立即生效。', false)
          report('dialog-saved', '')
          notifySidebarChange(body.showSidebar)
        } catch (error) {
          setStatus(`保存失败：${error && error.message ? error.message : error}`, true)
          report('dialog-save-failed', String(error && error.message ? error.message : error))
        } finally {
          saveBtn.disabled = false
        }
      })

      reloadBtn.addEventListener('click', () => { loadConfig() })

      const copyValue = (getValue) => {
        try {
          const text = getValue()
          if (globalThis.navigator?.clipboard?.writeText) globalThis.navigator.clipboard.writeText(text)
        } catch { /* clipboard is best-effort */ }
      }
      copyBaseBtn.addEventListener('click', () => copyValue(() => baseUrlLine.textContent))
      copyModelsBtn.addEventListener('click', () => copyValue(() => modelsLine.textContent))
      copyChatBtn.addEventListener('click', () => copyValue(() => chatLine.textContent))

      // --- assemble ---------------------------------------------------------
      const root = el('div', { style: 'box-sizing:border-box;color:var(--dsw-alias-label-primary, inherit);font-family:inherit' }, [
        header,
        subtitle,
        endpointsCard,
        formCard,
      ])

      return { node: root, reload: loadConfig }
    }

    /**
     * Mount the same form directly inside the `main` panel.
     *
     * The sidebar entry lands here, so the configuration is the page rather than
     * something behind another click. The host renders this page's React tree
     * reliably, but it never ran this page's effects, so the form is built with
     * native DOM and attached to the returned container by a `ref`.
     */
    /** Container id the form mounts into; the lookup fallback needs a stable handle. */
    const PANEL_HOST_ID = 'xmm-workbuddy-panel-host'

    /**
     * Attach the form to its container, or find the container and attach it.
     *
     * Called from the React `ref` and, as a fallback, on a short timer: this host
     * has been unreliable about React callbacks, so the page also looks its own
     * container up by id and mounts there. The `data-xmm-mounted` guard makes
     * both paths idempotent.
     */
    function mountPanelForm(container) {
      try {
        const host = container || (typeof document !== 'undefined' ? document.getElementById(PANEL_HOST_ID) : null)
        if (!host) return false
        if (host.dataset.xmmMounted === '1') return true
        host.dataset.xmmMounted = '1'
        const built = buildConfigForm()
        host.appendChild(built.node)
        built.reload()
        report('panel-mounted', 'native form inside main panel')
        return true
      } catch (error) {
        report('panel-mount-failed', String(error && error.message ? error.message : error))
        return false
      }
    }

    function mainPanelRef(container) {
      if (!container) return
      mountPanelForm(container)
    }

    function apply(ctx) {
      try {
        /**
         * The locale service refuses a namespace/locale pair it already holds.
         * After a plugin reload the previous dictionaries can still be live, so
         * a refusal here means "the copy is already installed" — not a failure.
         * Swallowing it keeps `apply` from being interrupted, which would cost
         * the panel registrations below.
         */
        ctx.effect(() => {
          try {
            return ctx.locale.register(NAMESPACE, copy)
          } catch {
            return () => {}
          }
        }, `${PANEL_ID}: copy`)
      } catch (error) {
        console.error('[dsh-xmm-ai] locale registration failed (labels fall back to built-in copy):', error)
      }

      /** Ask the host to select this plugin's panel; soft, so a bare host still renders. */
      const openPanel = () => {
        try {
          const layout = ctx.get ? ctx.get('layout') : undefined
          if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(PANEL_ID)
        } catch (error) {
          console.error('[dsh-xmm-ai] could not select the panel:', error)
        }
      }

      try {
        // The page. `inject` supplies only optional extras; the component works without them.
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NAMESPACE,
          inject: () => ({
            backToConversation: () => {
              try {
                const layout = ctx.get ? ctx.get('layout') : undefined
                if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(null)
              } catch { /* closing is best-effort */ }
            },
          }),
        }, Page))
        report('main-registered', `key=${PANEL_ID}`)
      } catch (error) {
        report('main-register-failed', error && error.message ? error.message : String(error))
        console.error('[dsh-xmm-ai] main panel registration failed:', error)
      }

      /**
       * Sidebar row, controlled by the `showSidebar` setting.
       *
       * The host's pin/unpin is in-memory only (lost on restart), so a durable
       * switch must register or withdraw the row itself. The `main` panel above
       * stays registered unconditionally: the settings entry and the fixed-port
       * API can still reach it when the sidebar row is hidden.
       */
      let sidebarRowDisposer = null
      const syncSidebarRow = (show) => {
        // Dispose first: a live key/id cannot be registered twice, and the
        // renderer caches inject results by object identity, so a changed
        // decision must re-register rather than reuse the old entry.
        if (sidebarRowDisposer) {
          try { sidebarRowDisposer() } catch { /* already disposed */ }
          sidebarRowDisposer = null
        }
        if (!show) { report('sidebar-row-hidden', ''); return }
        try {
          sidebarRowDisposer = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 3,
            label: () => {
              const dict = copy[FALLBACK_LOCALE] ?? copy.en
              return dict['nav.label']
            },
            locale: NAMESPACE,
          }, Icon))
          report('sidebar-row-registered', '')
        } catch (error) {
          report('sidebar-register-failed', error && error.message ? error.message : String(error))
          console.error('[dsh-xmm-ai] sidebar entry registration failed:', error)
        }
      }

      // Start visible, then reconcile with the persisted setting.
      syncSidebarRow(true)
      try {
        fetch(CONFIG_PATH, { headers: { accept: 'application/json' } })
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => { if (data && data.config) syncSidebarRow(data.config.showSidebar !== false) })
          .catch(() => {})
      } catch { /* default visible is fine */ }

      // Immediate feedback when the form saves a new value.
      try {
        globalThis.addEventListener?.('xmm-ai-sidebar-change', (event) => {
          const show = event && event.detail && typeof event.detail.show === 'boolean' ? event.detail.show : true
          syncSidebarRow(show)
        })
      } catch { /* best effort */ }

      /**
       * Settings-page entry.
       *
       * A full `settings.section` (not a `settings.plugins.tab`) so the whole
       * configuration form lives in Settings → this section, exactly like the
       * sibling workbuddy plugin. The section icon shares the same id.
       */
      try {
        ctx.slots.inject('settings.section', () => {
          const disposers = []
          disposers.push(ctx.slots.register({
            name: 'settings.section',
            id: PANEL_ID,
            order: 35,
            label: () => {
              const dict = copy[FALLBACK_LOCALE] ?? copy.en
              return dict['nav.label']
            },
            locale: NAMESPACE,
            inject: () => ({ t: makeT({}) }),
          }, Page))
          try {
            disposers.push(ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
              name: 'settings.section.icon',
              id: PANEL_ID,
              locale: NAMESPACE,
            }, (props) => h(Icon, { size: props && typeof props.size === 'number' ? props.size : 16 }))))
          } catch { /* icon is optional */ }
          report('settings-registered', `id=${PANEL_ID}`)
          return () => disposers.forEach((d) => { try { d() } catch { /* noop */ } })
        })
      } catch (error) {
        report('settings-register-failed', error && error.message ? error.message : String(error))
        console.error('[dsh-xmm-ai] settings entry registration failed:', error)
      }

      return { openPanel }
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    }
  },
})
