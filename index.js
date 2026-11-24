/**
 * dsh-xmm-ai
 *
 * An OpenAI-compatible HTTP API backed by the WorkBuddy models that
 * `dsh-connect-workbuddy` registers in DeepSeek Harness. This plugin does not
 * speak to WorkBuddy itself: every chat request is dispatched through the
 * Harness LLM service (`ctx.llm.stream`), so it reuses the signed-in accounts,
 * credit pool, model roster and reasoning configuration of the host.
 *
 * Provider routes owned by dsh-connect-workbuddy:
 *   - "workbuddy"         (CN / domestic)
 *   - "workbuddy-global"  (international)
 *
 * The Desktop host passes `--port 0` to its own webserver, so that port changes
 * on every launch. When `fixedPort` is set, this plugin also runs a small
 * standalone `node:http` listener on that exact port, serving the same OpenAI
 * surface. It reuses the host's LLM service through `ctx`, so it still goes
 * through WorkBuddy's signed-in accounts and the shared model catalog.
 */

import { createServer } from 'node:http'

const WORKBUDDY_CN = 'workbuddy'
const WORKBUDDY_GLOBAL = 'workbuddy-global'
const QODER_CN = 'qoder'
const QODER_GLOBAL = 'qoder-global'
/**
 * Every provider route this API may dispatch through, in catalog-priority
 * order. `dsh-connect-workbuddy` registers the first two, `dsh-connect-qoder`
 * the last two; a profile may have only some of them enabled.
 */
const PROVIDERS = [WORKBUDDY_CN, WORKBUDDY_GLOBAL, QODER_CN, QODER_GLOBAL]
/** The id a client may put in `model` to mean "use the configured default". */
const DEFAULT_MODEL_ALIAS = 'default'
/** Fixed prefix this bundle's host rows live under; every route path is derived from it. */
const BASE = '/plugins/dsh-xmm-ai'
const CONFIG_PATH = `${BASE}/__config`
const SAVE_PATH = `${BASE}/__save`
const STATUS_PATH = `${BASE}/__status`
const DIAG_PATH = `${BASE}/__diag`

/**
 * Field defaults and validation, kept dependency-free.
 *
 * The bundle is installed as a link to this directory, so it may only import
 * Node built-ins: bare package specifiers would resolve from here rather than
 * the profile. Validation therefore lives in plain code instead of a schema
 * library, and persistence goes through the host's config editor.
 */
const CONFIG_DEFAULTS = Object.freeze({
  enabled: true,
  apiPath: '/v1',
  defaultModel: '',
  allowRemote: false,
  apiKeys: '',
  fixedPort: 0,
  showSidebar: true,
})

/** Coerce one raw value into the shape this plugin accepts. */
function normalizeField(key, value) {
  switch (key) {
    case 'showSidebar':
      // Absent means a fresh install: show the entry by default. Only an
      // explicitly saved `false` hides it.
      return value === undefined ? CONFIG_DEFAULTS.showSidebar : value === true
    case 'fixedPort': {
      // 0 disables the standalone listener; otherwise a real TCP port.
      const n = typeof value === 'number' ? value : Number(value)
      return Number.isInteger(n) && n >= 0 && n <= 65535 ? n : 0
    }
    case 'enabled':
      // Absent means "the user has not decided yet", which must serve traffic:
      // only an explicit saved `false` turns the API off.
      return value === undefined ? CONFIG_DEFAULTS.enabled : value === true
    case 'apiPath':
      return normalizeApiPath(value)
    case 'defaultModel':
      return normalizeDefaultModel(value)
    case 'allowRemote':
      return value === true
    case 'apiKeys':
      return typeof value === 'string' ? value : CONFIG_DEFAULTS.apiKeys
    default:
      return undefined
  }
}

/** Accept `/v1`, `v1`, `/openai/v1` … and always return one leading slash, no trailing one. */
function normalizeApiPath(value) {
  if (typeof value !== 'string') return CONFIG_DEFAULTS.apiPath
  let path = value.trim()
  if (path === '') return ''
  if (!path.startsWith('/')) path = `/${path}`
  path = path.replace(/\/+$/, '')
  if (path === '') return ''
  // Keep the path inside this bundle's own route namespace.
  if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@/-]*$/.test(path) || path.includes('..')) return CONFIG_DEFAULTS.apiPath
  return path
}

/**
 * Accept `qoder/qfmodel`, `qfmodel`, or an empty value.
 *
 * A bare id is stored as-is: which provider owns it is decided per request from
 * the live catalogs, so the same setting keeps working if a model moves between
 * regions. Only obviously bogus input is rejected.
 */
function normalizeDefaultModel(value, { strict = false } = {}) {
  if (value === undefined || value === null) return CONFIG_DEFAULTS.defaultModel
  if (typeof value !== 'string') return CONFIG_DEFAULTS.defaultModel
  const text = value.trim()
  if (text === '') return ''
  if (!MODEL_REF_PATTERN.test(text) || text.startsWith('/') || text.endsWith('/')) {
    if (strict) throw new Error('defaultModel must look like "qoder/qfmodel" or "qfmodel"')
    return CONFIG_DEFAULTS.defaultModel
  }
  return text
}

/** One optional `provider/` prefix followed by a model id, no whitespace. */
const MODEL_REF_PATTERN = /^[A-Za-z0-9._:-]+(?:\/[A-Za-z0-9._:-]+)?$/

/**
 * Split a request `model` value into `{ provider, model }`.
 *
 * Only the four providers this API serves are treated as prefixes; anything
 * else stays part of the model id, so a model legitimately named `foo/bar`
 * survives. `provider` is undefined when the caller did not name one.
 */
function parseModelRef(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text === '') return { provider: undefined, model: '' }
  const slash = text.indexOf('/')
  if (slash > 0) {
    const head = text.slice(0, slash)
    if (PROVIDERS.includes(head)) {
      return { provider: head, model: text.slice(slash + 1) }
    }
  }
  return { provider: undefined, model: text }
}

/**
 * Parse the multi-key field into usable keys.
 *
 * One key per line; a trailing `# note` and blank lines are ignored, so a user
 * can label which client a key belongs to. Commas also separate, because keys
 * are often pasted from a table.
 */
function parseApiKeys(value) {
  const raw = typeof value === 'string' ? value : ''
  return raw
    .split(/[\n,]/)
    .map((line) => line.split('#')[0].trim())
    .filter((key) => key.length > 0)
}

/** Unwrap a volatile `{get()}` reference into its current value. */
function unwrap(value) {
  return value !== null && typeof value === 'object' && 'get' in value && typeof value.get === 'function'
    ? value.get()
    : value
}

/** Read the current config, unwrapping volatile `{get()}` references when present. */
function readConfig(config) {
  const raw = unwrap(config) ?? {}
  return {
    enabled: normalizeField('enabled', unwrap(raw.enabled)),
    apiPath: normalizeField('apiPath', unwrap(raw.apiPath)),
    defaultModel: normalizeField('defaultModel', unwrap(raw.defaultModel)),
    allowRemote: normalizeField('allowRemote', unwrap(raw.allowRemote)),
    apiKeys: normalizeField('apiKeys', unwrap(raw.apiKeys)),
    fixedPort: normalizeField('fixedPort', unwrap(raw.fixedPort)),
    showSidebar: normalizeField('showSidebar', unwrap(raw.showSidebar)),
  }
}

function json(res, status, value) {
  if (res.headersSent) return
  const body = JSON.stringify(value)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(body))
  res.end(body)
}

function openAiError(res, status, message, code = 'invalid_request_error', type = 'invalid_request_error') {
  json(res, status, { error: { message, type, code } })
}

function isLoopback(address) {
  if (typeof address !== 'string') return false
  const normalized = address.replace(/^::ffff:/, '')
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost'
}

async function readBody(req, maxBytes = 8 * 1024 * 1024) {
  return await new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Short-lived catalog used to decide which provider owns a bare model id.
 *
 * The snapshot is cached briefly because a single chat request may need it
 * once, and bursts from a client would otherwise re-list every provider on
 * every message.
 */
function createCatalogResolver(llm) {
  let cache
  let cachedAt = 0
  const TTL_MS = 10_000
  async function snapshot() {
    const now = Date.now()
    if (cache !== undefined && now - cachedAt < TTL_MS) return cache
    const byModel = new Map()
    const live = new Set((llm.listProviders?.() ?? []).map((p) => p?.id))
    for (const provider of PROVIDERS) {
      if (!live.has(provider)) continue
      let models
      try {
        models = await llm.listModels(provider)
      } catch {
        models = []
      }
      for (const model of models ?? []) {
        if (typeof model?.id !== 'string' || !model.id) continue
        const list = byModel.get(model.id) ?? []
        list.push(provider)
        byModel.set(model.id, list)
      }
    }
    cache = byModel
    cachedAt = now
    return cache
  }
  /**
   * Resolve a bare id to one of `PROVIDERS`.
   *
   * `preferred` is the provider of the configured default model: when two
   * providers both publish the same id, the caller almost certainly means the
   * family they already chose. Returns `undefined` for an id nothing lists — the
   * caller turns that into an actionable error instead of guessing.
   */
  async function resolve(modelId, preferred) {
    const owners = (await snapshot()).get(modelId)
    if (!owners || owners.length === 0) return undefined
    if (owners.length === 1) return owners[0]
    if (preferred && owners.includes(preferred)) return preferred
    return owners[0]
  }
  /** True when the id is published by `provider` right now. */
  async function has(provider, modelId) {
    const owners = (await snapshot()).get(modelId)
    return Array.isArray(owners) && owners.includes(provider)
  }
  resolve.has = has
  resolve.reset = () => { cache = undefined; cachedAt = 0 }
  return resolve
}

/**
 * Parse one OpenAI `image_url` value into DSH attachment admission input.
 *
 * A `data:` URL carries canonical base64 and is used as-is; an http(s) URL is
 * fetched and re-encoded. Anything else is refused so a caller never thinks an
 * image was forwarded when it was not.
 */
async function parseImageUrl(value) {
  if (typeof value !== 'string') throw new Error('image_url.url must be a string')
  const dataMatch = /^data:(image\/(?:png|jpeg|webp|gif));base64,([\s\S]*)$/i.exec(value)
  if (dataMatch) {
    const mediaType = dataMatch[1].toLowerCase()
    const bytes = Buffer.from(dataMatch[2], 'base64')
    return { mediaType, data: bytes.toString('base64') }
  }
  if (/^https?:\/\//i.test(value)) {
    const response = await fetch(value)
    if (!response.ok) throw new Error(`image download failed: HTTP ${response.status}`)
    const type = (response.headers?.get?.('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const mediaType = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type) ? type : 'image/png'
    const bytes = Buffer.from(await response.arrayBuffer())
    return { mediaType, data: bytes.toString('base64') }
  }
  throw new Error('image_url must be a data:image/...;base64 URL or an http(s) URL')
}

/** Build the content for one user message, promoting images to durable refs. */
async function buildUserContent(content, attachments) {
  const admission = []
  const images = []
  for (const part of Array.isArray(content) ? content : []) {
    if (part === null || typeof part !== 'object') continue
    if (part.type === 'text' && typeof part.text === 'string') {
      admission.push({ type: 'text', text: part.text })
    } else if (part.type === 'image_url') {
      const url = part.image_url?.url ?? part.image_url
      const image = await parseImageUrl(url)
      images.push(image)
      admission.push({ type: 'image', mediaType: image.mediaType, data: image.data })
    }
  }
  if (images.length === 0) {
    const text = contentToText(content)
    return text ? [{ type: 'text', text }] : []
  }
  if (!attachments || typeof attachments.admitPromptContent !== 'function') {
    throw new Error('image input requires the Harness attachment service, which is not mounted in this profile')
  }
  // admitPromptContent passes text parts through and replaces encoded images
  // with durable ImageAttachmentRefs in one atomic, validated write.
  const admitted = await attachments.admitPromptContent(admission)
  return admitted.map((part) => {
    if (part.type === 'image') return { type: 'image', attachment: part.attachment }
    return { type: 'text', text: part.text }
  })
}

/** Convert an OpenAI chat request into Harness LLM generate options. */
async function buildGenerateOptions(body, provider, model, attachments) {
  const systemParts = []
  const messages = []
  const rawMessages = Array.isArray(body.messages) ? body.messages : []

  for (const item of rawMessages) {
    if (item === null || typeof item !== 'object') continue
    const role = item.role
    const text = contentToText(item.content)
    if (role === 'system' || role === 'developer') {
      if (text) systemParts.push(text)
      continue
    }
    if (role === 'user') {
      messages.push({ role: 'user', content: await buildUserContent(item.content, attachments) })
      continue
    }
    if (role === 'assistant') {
      const content = []
      if (text) content.push({ type: 'text', text })
      if (Array.isArray(item.tool_calls)) {
        for (const call of item.tool_calls) {
          const fn = call?.function ?? {}
          content.push({
            type: 'tool-call',
            id: typeof call?.id === 'string' && call.id ? call.id : `call_${Math.random().toString(36).slice(2)}`,
            name: typeof fn.name === 'string' ? fn.name : '',
            arguments: typeof fn.arguments === 'string' ? fn.arguments : '{}',
          })
        }
      }
      messages.push({
        role: 'assistant',
        id: `xmm_${Math.random().toString(36).slice(2)}`,
        content,
        source: { kind: 'model', provider, model },
      })
      continue
    }
    if (role === 'tool') {
      messages.push({
        role: 'tool',
        id: `xmm_${Math.random().toString(36).slice(2)}`,
        toolCallId: item.tool_call_id ?? '',
        source: { kind: 'tool', callId: item.tool_call_id ?? '' },
        content: [{ type: 'text', text }],
        isError: false,
      })
    }
  }

  const options = { provider, model, messages }
  if (systemParts.length > 0) options.system = systemParts.join('\n\n')
  if (typeof body.temperature === 'number' && Number.isFinite(body.temperature)) {
    options.temperature = body.temperature
  }
  const maxTokens = body.max_completion_tokens ?? body.max_tokens
  if (typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0) {
    options.maxTokens = Math.floor(maxTokens)
  }
  // The pi-ai adapter rejects GenerateOptions.stop, so stop sequences are
  // applied client-side in handleOnce/handleStream instead of forwarded.
  if (typeof body.reasoning_effort === 'string' && body.reasoning_effort) {
    options.reasoningEffort = body.reasoning_effort
  }
  if (Array.isArray(body.tools)) {
    const tools = []
    for (const tool of body.tools) {
      const fn = tool?.function ?? tool
      if (typeof fn?.name === 'string' && fn.name) {
        tools.push({
          name: fn.name,
          description: typeof fn.description === 'string' ? fn.description : '',
          parameters: fn.parameters && typeof fn.parameters === 'object' ? fn.parameters : { type: 'object', properties: {} },
        })
      }
    }
    if (tools.length > 0) options.tools = tools
  }
  return options
}

/** Flatten OpenAI content into text. Image parts are replaced by a text placeholder. */
function contentToText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const part of content) {
    if (typeof part === 'string') {
      parts.push(part)
      continue
    }
    if (part === null || typeof part !== 'object') continue
    if (part.type === 'text' && typeof part.text === 'string') parts.push(part.text)
    else if (part.type === 'image_url') parts.push('[image input omitted: this API forwards text only]')
  }
  return parts.join('')
}

/**
 * Parse OpenAI `stop` into a list, and apply it to generated text.
 *
 * The WorkBuddy pi-ai adapter rejects `GenerateOptions.stop`, so the field is
 * honoured here: text is cut at the first sequence and the finish reason is
 * still `stop`, which is what an OpenAI client expects.
 */
function parseStop(body) {
  if (Array.isArray(body?.stop)) return body.stop.filter((s) => typeof s === 'string' && s.length > 0)
  if (typeof body?.stop === 'string' && body.stop.length > 0) return [body.stop]
  return []
}

/** Index of the earliest stop sequence in `text`, or -1 when none matches. */
function stopIndex(text, stops) {
  let best = -1
  for (const stop of stops) {
    const at = text.indexOf(stop)
    if (at >= 0 && (best < 0 || at < best)) best = at
  }
  return best
}

function finishReasonOf(reason) {
  switch (reason?.kind) {
    case 'tool-calls': return 'tool_calls'
    case 'max-tokens': return 'length'
    case 'error':
    case 'aborted': return 'error'
    default: return 'stop'
  }
}

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Constant-time comparison so a wrong key cannot be narrowed down by timing. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Whether the request carries one of the configured keys. No keys configured means open access. */
function authorized(req, config) {
  const keys = parseApiKeys(config.apiKeys)
  if (keys.length === 0) return true
  const header = req.headers?.authorization
  if (typeof header !== 'string') return false
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (match === null) return false
  const presented = match[1].trim()
  let ok = false
  for (const key of keys) if (safeEqual(presented, key)) ok = true
  return ok
}

function checkAccess(req, res, config) {
  if (!config.enabled) {
    openAiError(res, 503, 'this API is disabled in the plugin settings', 'api_disabled')
    return false
  }
  if (!config.allowRemote && !isLoopback(req.socket?.remoteAddress)) {
    openAiError(res, 403, 'loopback access only; enable remote clients in the plugin settings', 'forbidden')
    return false
  }
  if (!authorized(req, config)) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="dsh-xmm-ai"')
    openAiError(res, 401, 'invalid or missing API key', 'invalid_api_key')
    return false
  }
  return true
}

/**
 * Start a standalone HTTP listener on a fixed port.
 *
 * Returns a disposer. The handler shares the exact same request path as the
 * host-registered routes, so both surfaces behave identically.
 */
function startFixedServer(ctx, currentConfig, getServices) {
  const initial = currentConfig()
  const port = initial.fixedPort
  if (!port) return () => {}

  let server
  let started = false
  try {
    server = createServer(async (req, res) => {
      try {
        const cfg = currentConfig()
        const services = getServices()
        const url = new URL(req.url ?? '/', 'http://placeholder')
        const prefix = cfg.apiPath || '/v1'
        let path = url.pathname

        // Health is a fixed path, independent of the configurable prefix.
        if (path === '/health') {
          const providers = (services.llm?.listProviders?.() ?? []).map((p) => p?.id).filter((id) => PROVIDERS.includes(id))
          return json(res, 200, { status: 'ok', service: 'dsh-xmm-ai', providers })
        }

        // Accept both the bare prefix and the full plugin path for convenience.
        const bare = path.startsWith(prefix)
          ? path.slice(prefix.length)
          : path.startsWith(`${BASE}${prefix}`)
            ? path.slice(`${BASE}${prefix}`.length)
            : null
        if (bare !== '/models' && bare !== '/chat/completions') {
          return json(res, 404, { error: 'not found' })
        }
        const isModels = bare === '/models'
        if (req.method !== (isModels ? 'GET' : 'POST')) {
          res.setHeader('Allow', isModels ? 'GET' : 'POST')
          return json(res, 405, { error: 'method not allowed' })
        }
        if (!checkAccess(req, res, cfg)) return
        if (isModels) return handleModels(res, services)
        return handleChat(req, res, services, cfg, services.attachments)
      } catch (error) {
        if (!res.writableEnded) {
          json(res, 500, { error: { message: error instanceof Error ? error.message : String(error), type: 'server_error', code: 'server_error' } })
        }
      }
    })

    server.on('error', (error) => {
      ctx.logger?.warn?.(`dsh-xmm-ai: fixed port ${port} failed: ${error.message}`)
    })
    // Bind all interfaces when remote clients are allowed; otherwise loopback.
    // Binding is fixed at listen time, so changing `allowRemote` re-registers
    // this effect (see the key below) and the listener is recreated.
    const bindHost = initial.allowRemote ? '0.0.0.0' : '127.0.0.1'
    server.listen(port, bindHost, () => { started = true })
  } catch (error) {
    ctx.logger?.warn?.(`dsh-xmm-ai: could not start fixed server: ${error.message}`)
    return () => {}
  }

  return () => {
    if (!server) return
    try { server.close() } catch { /* already closed */ }
    try { server.closeAllConnections?.() } catch { /* optional */ }
  }
}

export function apply(ctx, config) {
  /** Volatile config is read live on every request so the settings page takes effect without a reload. */
  const currentConfig = () => readConfig(config)

  /**
   * Browser-side breadcrumbs from the client half.
   *
   * A blank panel leaves no trace a person can see: the host renders an empty
   * anchor and the console lives behind developer tools. The client therefore
   * POSTs what it reached, and this plugin's own endpoint hands the record back
   * so the failure can be inspected without opening anything.
   */
  const diagLog = []
  const recordDiag = (entry) => {
    diagLog.push(entry)
    if (diagLog.length > 40) diagLog.shift()
  }

  ctx.inject(['webServer'], (webCtx) => {
    const route = (entry) => ctx.effect(() => webCtx.webServer.register(entry))

    // Browser breadcrumbs: POST appends, GET returns the collected record.
    route({
      kind: 'exact',
      path: DIAG_PATH,
      handler: async (req, res) => {
        if (req.method === 'GET') {
          if (!isLoopback(req.socket?.remoteAddress)) return json(res, 403, { error: 'loopback access only' })
          return json(res, 200, { entries: diagLog, now: Date.now() })
        }
        if (req.method !== 'POST') {
          res.setHeader('Allow', 'GET, POST')
          return json(res, 405, { error: 'method not allowed' })
        }
        if (!isLoopback(req.socket?.remoteAddress)) return json(res, 403, { error: 'loopback access only' })
        let body
        try {
          body = JSON.parse(await readBody(req, 256 * 1024))
        } catch {
          return json(res, 400, { error: 'invalid JSON' })
        }
        recordDiag({
          at: Date.now(),
          stage: typeof body?.stage === 'string' ? body.stage.slice(0, 200) : 'unknown',
          detail: typeof body?.detail === 'string' ? body.detail.slice(0, 2000) : undefined,
          href: typeof body?.href === 'string' ? body.href.slice(0, 300) : undefined,
        })
        json(res, 200, { ok: true })
      },
    })

    // Read the settings snapshot served for this plugin's namespace.
    route({
      kind: 'exact',
      path: CONFIG_PATH,
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          res.setHeader('Allow', 'GET')
          return json(res, 405, { error: 'method not allowed' })
        }
        if (!isLoopback(req.socket?.remoteAddress)) {
          return json(res, 403, { error: 'loopback access only' })
        }
        json(res, 200, {
          config: currentConfig(),
          namespace: ctx.fiber?.entry?.options?.id ?? 'dsh-xmm-ai',
        })
      },
    })

    // Persist config edits from the sidebar page through the host settings service.
    route({
      kind: 'exact',
      path: SAVE_PATH,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.setHeader('Allow', 'POST')
          return json(res, 405, { error: 'method not allowed' })
        }
        if (!isLoopback(req.socket?.remoteAddress)) {
          return json(res, 403, { error: 'loopback access only' })
        }
        const editor = ctx.get?.('configEditor')
        if (editor === undefined || typeof editor.edit !== 'function' || ctx.fiber?.entry === undefined) {
          return json(res, 503, { error: 'the configuration editor is unavailable in this profile' })
        }
        let body
        try {
          body = JSON.parse(await readBody(req))
        } catch (error) {
          return json(res, 400, { error: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` })
        }
        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
          return json(res, 400, { error: 'body must be an object' })
        }
        const patch = {}
        for (const key of Object.keys(CONFIG_DEFAULTS)) {
          if (!(key in body)) continue
          const value = body[key]
          if (key === 'enabled' && typeof value !== 'boolean') return json(res, 400, { error: 'enabled must be a boolean' })
          if (key === 'showSidebar' && typeof value !== 'boolean') return json(res, 400, { error: 'showSidebar must be a boolean' })
          if (key === 'allowRemote' && typeof value !== 'boolean') {
            return json(res, 400, { error: 'allowRemote must be a boolean' })
          }
          if (key === 'defaultRegion' && value !== 'cn' && value !== 'global') {
            return json(res, 400, { error: 'defaultRegion must be cn or global' })
          }
          if (key === 'apiPath' && normalizeApiPath(value) !== (typeof value === 'string' ? value.trim() : value)) {
            return json(res, 400, { error: 'apiPath must be a plain path such as /v1 (letters, digits and - _ . / only)' })
          }
          if (key === 'apiKeys' && typeof value !== 'string') return json(res, 400, { error: 'apiKeys must be a string' })
          if (key === 'fixedPort') {
            const n = Number(value)
            if (!Number.isInteger(n) || n < 0 || n > 65535) {
              return json(res, 400, { error: 'fixedPort must be 0 or a port from 1 to 65535' })
            }
            patch[key] = n
            continue
          }
          patch[key] = value
        }
        if (Object.keys(patch).length === 0) return json(res, 400, { error: 'no recognized config fields' })
        try {
          await editor.edit(ctx.fiber.entry, (current) => ({ ...current, ...patch }))
          json(res, 200, { ok: true, config: currentConfig(), saved: patch })
        } catch (error) {
          json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    })

    /**
     * Runtime facts the settings page shows: the bound origin (the port belongs
     * to the harness, not to this plugin), the live paths, and provider state.
     */
    route({
      kind: 'exact',
      path: STATUS_PATH,
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          res.setHeader('Allow', 'GET')
          return json(res, 405, { error: 'method not allowed' })
        }
        if (!isLoopback(req.socket?.remoteAddress)) {
          return json(res, 403, { error: 'loopback access only' })
        }
        const cfg = currentConfig()
        let origin
        try {
          origin = webCtx.webServer.getOrigin()
        } catch {
          origin = undefined
        }
        let port
        try {
          port = webCtx.webServer.port
        } catch {
          port = undefined
        }
        let providers = []
        try {
          providers = (webCtx.llm?.listProviders?.() ?? []).map((p) => p?.id).filter((id) => PROVIDERS.includes(id))
        } catch { /* host not ready */ }
        const keys = parseApiKeys(cfg.apiKeys)
        json(res, 200, {
          origin,
          port,
          host: webCtx.webServer.host,
          protocol: webCtx.webServer.protocol,
          endpoints: {
            models: `${BASE}${cfg.apiPath}/models`,
            chat: `${BASE}${cfg.apiPath}/chat/completions`,
            health: `${BASE}/health`,
          },
          providers,
          keyCount: keys.length,
        })
      },
    })

    route({
      kind: 'exact',
      path: `${BASE}/health`,
      handler: async (req, res) => {
        if (!checkAccess(req, res, currentConfig())) return
        let providers = []
        try {
          providers = (webCtx.llm?.listProviders?.() ?? [])
            .map((p) => p?.id)
            .filter((id) => PROVIDERS.includes(id))
        } catch { /* host not ready */ }
        json(res, 200, { status: 'ok', service: 'dsh-xmm-ai', providers })
      },
    })

    /**
     * One prefix route serves the OpenAI surface under any path this bundle
     * owns, so changing `apiPath` needs no route re-registration: `/v1/models`,
     * `/openai/v1/models`, and the configured path all reach the same handler.
     */
    route({
      kind: 'prefix',
      path: BASE,
      handler: async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://placeholder')
        const suffix = url.pathname.slice(BASE.length)
        const isModels = suffix === '/models' || suffix.endsWith('/models')
        const isChat = suffix === '/chat/completions' || suffix.endsWith('/chat/completions')
        if (!isModels && !isChat) return json(res, 404, { error: 'not found' })
        if (req.method !== (isModels ? 'GET' : 'POST')) {
          res.setHeader('Allow', isModels ? 'GET' : 'POST')
          return json(res, 405, { error: 'method not allowed' })
        }
        const cfg = currentConfig()
        if (!checkAccess(req, res, cfg)) return
        if (isModels) return handleModels(res, webCtx)
        return handleChat(req, res, webCtx, cfg, ctx.get?.('attachments'))
      },
    })

  })

  /**
   * Optional standalone listener on a fixed port.
   *
   * The Desktop host always passes `--port 0` to its own webserver, so its port
   * changes on every launch. When the user sets `fixedPort`, this independent
   * listener gives the OpenAI API a stable address. It reads the same services
   * from `ctx` as the host-registered routes, so both surfaces are equivalent.
   */
  const listenerServices = {
    get llm() { return ctx.get?.('llm') },
    get attachments() { return ctx.get?.('attachments') },
  }

  /**
   * The bind address is fixed at `listen()` time. The settings editor restarts
   * the plugin on a config write, which re-runs this effect and recreates the
   * listener with the new port / `allowRemote` binding.
   */
  ctx.effect(() => {
    return startFixedServer(ctx, currentConfig, () => listenerServices)
  }, `${BASE}: fixed-port listener`)
}

async function handleModels(res, webCtxArg, cfg) {
  try {
    const llm = webCtxArg.llm
    if (!llm) return openAiError(res, 503, 'Harness LLM service is not available', 'service_unavailable')
    const live = new Set((llm.listProviders?.() ?? []).map((p) => p?.id))
    const data = []
    const seen = new Set()
    const created = Math.floor(Date.now() / 1000)
    for (const provider of PROVIDERS) {
      if (!live.has(provider)) continue
      let models
      try {
        models = await llm.listModels(provider)
      } catch {
        models = []
      }
      for (const model of models ?? []) {
        if (typeof model?.id !== 'string' || !model.id) continue
        if (!seen.has(model.id)) {
          seen.add(model.id)
          data.push({ id: model.id, object: 'model', created, owned_by: provider })
        }
        const alias = `${provider}/${model.id}`
        if (!seen.has(alias)) {
          seen.add(alias)
          data.push({ id: alias, object: 'model', created, owned_by: provider })
        }
      }
    }
    // Advertise the alias clients may send instead of a real model id. It is
    // listed first so it is the obvious choice in a picker; `owned_by` names the
    // concrete model it resolves to.
    if (cfg?.defaultModel) {
      data.unshift({
        id: DEFAULT_MODEL_ALIAS,
        object: 'model',
        created,
        owned_by: 'dsh-xmm-ai',
        resolved: cfg.defaultModel,
      })
    }
    json(res, 200, { object: 'list', data, defaultModel: cfg?.defaultModel ?? '' })
  } catch (error) {
    openAiError(res, 500, error instanceof Error ? error.message : String(error), 'server_error')
  }
}


async function handleChat(req, res, webCtxArg, cfg, attachments) {
  let body
  try {
    body = JSON.parse(await readBody(req))
  } catch (error) {
    return openAiError(res, 400, `invalid JSON body: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return openAiError(res, 400, 'body must be a JSON object')
  }
  if (typeof body.model !== 'string' || !body.model) {
    return openAiError(res, 400, 'missing required field: model')
  }
  if (!Array.isArray(body.messages)) {
    return openAiError(res, 400, 'missing required field: messages (array)')
  }

  const llm = webCtxArg.llm
  if (!llm) return openAiError(res, 503, 'Harness LLM service is not available', 'service_unavailable')

  let model = body.model
  let provider
  if (model.startsWith(`${CN_PROVIDER}/`)) {
    provider = CN_PROVIDER
    model = model.slice(CN_PROVIDER.length + 1)
  } else if (model.startsWith(`${GLOBAL_PROVIDER}/`)) {
    provider = GLOBAL_PROVIDER
    model = model.slice(GLOBAL_PROVIDER.length + 1)
  } else {
    provider = await createCatalogResolver(llm)(model, cfg.defaultRegion)
  }
  if (!model) return openAiError(res, 400, 'empty model id')

  const live = new Set((llm.listProviders?.() ?? []).map((p) => p?.id))
  if (!live.has(provider)) {
    return openAiError(
      res,
      503,
      `WorkBuddy provider "${provider}" is not registered. Enable and sign in to dsh-connect-workbuddy.`,
      'provider_unavailable',
    )
  }

  let options
  try {
    options = await buildGenerateOptions(body, provider, model, attachments)
  } catch (error) {
    return openAiError(res, 400, error instanceof Error ? error.message : String(error), 'invalid_image_input')
  }
  const streamWanted = body.stream === true
  const controller = new AbortController()
  options.signal = controller.signal
  if (req.on) req.on('close', () => controller.abort())

  const stops = parseStop(body)
  if (streamWanted) await handleStream(req, res, llm, options, provider, model, stops)
  else await handleOnce(res, llm, options, provider, model, stops)
}

async function handleOnce(res, llm, options, provider, model, stops) {
  stops = stops ?? []
  let content = ''
  let reasoning = ''
  const toolCalls = []
  let usage
  let finishReason = 'stop'
  let terminalFailure

  try {
    for await (const chunk of llm.stream(options)) {
      switch (chunk.type) {
        case 'text-delta':
          content += chunk.text ?? ''
          break
        case 'reasoning-delta':
          reasoning += chunk.text ?? ''
          break
        case 'block-end':
          if (chunk.block?.type === 'tool-call') {
            toolCalls.push({
              id: chunk.block.id,
              type: 'function',
              function: { name: chunk.block.name ?? '', arguments: chunk.block.arguments ?? '{}' },
            })
          }
          break
        case 'usage':
          usage = chunk.usage
          break
        case 'finish':
          finishReason = finishReasonOf(chunk.reason)
          if (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted') {
            terminalFailure = chunk.reason.failure
          }
          break
        default:
          break
      }
    }
  } catch (error) {
    return openAiError(res, 502, error instanceof Error ? error.message : String(error), 'upstream_error', 'server_error')
  }

  if (terminalFailure) {
    return openAiError(res, 502, terminalFailure.message ?? 'upstream error', terminalFailure.code ?? 'upstream_error', 'server_error')
  }

  // Apply stop sequences client-side (the adapter rejects the native option).
  const stopAt = stopIndex(content, stops)
  if (stopAt >= 0) {
    content = content.slice(0, stopAt)
    finishReason = 'stop'
  }

  const message = { role: 'assistant', content }
  if (reasoning) message.reasoning_content = reasoning
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls
    message.content = content || null
    finishReason = 'tool_calls'
  }
  const promptTokens = usage?.inputTokens ?? 0
  const completionTokens = usage?.outputTokens ?? 0
  json(res, 200, {
    id: newId('chatcmpl'),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: usage?.totalTokens ?? promptTokens + completionTokens,
    },
  })
}

async function handleStream(req, res, llm, options, provider, model, stops) {
  stops = stops ?? []
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  const chatId = newId('chatcmpl')
  const created = Math.floor(Date.now() / 1000)
  const send = (payload) => {
    if (res.writableEnded) return
    // The OpenAI SSE protocol terminates with the literal token `data: [DONE]`,
    // not a JSON string. Sending JSON.stringify('[DONE]') yields `data: "[DONE]"`
    // which strict SDKs do not recognise as the end-of-stream sentinel.
    const data = payload === '[DONE]' ? '[DONE]' : JSON.stringify(payload)
    res.write(`data: ${data}\n\n`)
  }
  const sendDelta = (delta, finishReason = null, usage) => {
    send({
      id: chatId,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
      ...(usage === undefined ? {} : { usage }),
    })
  }

  sendDelta({ role: 'assistant', content: '' })

  const toolOrdinals = new Map()
  let usage
  let stopped = false
  let pending = '' // tail held back so a stop sequence split across deltas is caught
  const maxStopLen = stops.reduce((n, s) => Math.max(n, s.length), 0)

  try {
    for await (const chunk of llm.stream(options)) {
      if (stopped) break
      switch (chunk.type) {
        case 'text-delta': {
          if (!chunk.text) break
          pending += chunk.text
          // Keep back enough tail that a stop sequence starting near the end of
          // this delta can still be detected once more text arrives.
          const cut = stopIndex(pending, stops)
          if (cut >= 0) {
            const emit = pending.slice(0, cut)
            if (emit) sendDelta({ content: emit })
            stopped = true
            pending = ''
            break
          }
          if (maxStopLen > 0 && pending.length > maxStopLen - 1) {
            const emit = pending.slice(0, pending.length - (maxStopLen - 1))
            if (emit) sendDelta({ content: emit })
            pending = pending.slice(-(maxStopLen - 1))
          } else if (maxStopLen === 0 && pending) {
            sendDelta({ content: pending })
            pending = ''
          }
          break
        }
        case 'reasoning-delta':
          if (chunk.text) sendDelta({ reasoning_content: chunk.text })
          break
        case 'tool-call-delta': {
          let ordinal = toolOrdinals.get(chunk.index)
          if (ordinal === undefined) {
            ordinal = toolOrdinals.size
            toolOrdinals.set(chunk.index, ordinal)
          }
          const fn = {}
          if (chunk.name) fn.name = chunk.name
          if (chunk.argumentsDelta) fn.arguments = chunk.argumentsDelta
          sendDelta({
            tool_calls: [{
              index: ordinal,
              id: chunk.id,
              type: 'function',
              function: fn,
            }],
          })
          break
        }
        case 'usage':
          usage = chunk.usage
          break
        case 'finish': {
          const reason = stopped ? 'stop' : finishReasonOf(chunk.reason)
          if (pending) {
            const cut = stopIndex(pending, stops)
            const emit = cut >= 0 ? pending.slice(0, cut) : pending
            if (emit) sendDelta({ content: emit })
            if (cut >= 0) stopped = true
            pending = ''
          }
          if (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted') {
            const failure = chunk.reason.failure ?? {}
            send({
              error: {
                message: failure.message ?? 'upstream error',
                type: 'server_error',
                code: failure.code ?? 'upstream_error',
              },
            })
          }
          sendDelta({}, reason, usage === undefined ? undefined : {
            prompt_tokens: usage.inputTokens ?? 0,
            completion_tokens: usage.outputTokens ?? 0,
            total_tokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
          })
          break
        }
        default:
          break
      }
    }
  } catch (error) {
    send({
      error: {
        message: error instanceof Error ? error.message : String(error),
        type: 'server_error',
        code: 'upstream_error',
      },
    })
  }
  send('[DONE]')
  res.end()
}

export const inject = ['llm', 'webServer']
