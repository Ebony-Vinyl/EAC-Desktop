import Schema from '@deepseek-ai/schemastery'
// 0.1.3：dsh-settings 移除 settingsNamespace 独立导出 —— 改走共享兼容垫片
//（lib/settings-compat.js 随插件自包含分发，行为与 0.1.2 逐行一致）。
import { settingsNamespace, createSettingsScope } from './settings-compat.js'
import {
  DEFAULT_CONFIG,
  compactStatus,
  resolvePolicy,
  routedTargetOf,
  sanitizeConfig,
  setSharedConfig,
} from './policy.js'

export const name = 'dsh-compact'
export const inject = ['settings']
export const STATUS_ENDPOINT = '/plugins/dsh-compact/status'
export const COMPACT_ENDPOINT = '/plugins/dsh-compact/compact-now'
export const NS = settingsNamespace('dsh-compact')

const ModelPolicy = Schema.object({
  provider: Schema.string().description('精确匹配 provider'),
  model: Schema.string().description('精确匹配 model'),
  enabled: Schema.boolean(),
  thresholdRatio: Schema.number().min(0.5).max(0.95).step(0.01),
  retainRatio: Schema.number().min(0.05).max(0.5).step(0.01),
  recoverOnOverflow: Schema.boolean(),
  maxOverflowRetries: Schema.union([Schema.const(0), Schema.const(1)]),
  retryTransientBadRequest: Schema.boolean(),
})

const BaseConfig = Schema.object({
  enabled: Schema.boolean().default(DEFAULT_CONFIG.enabled).description('启用请求前自动压缩'),
  thresholdRatio: Schema.number().min(0.5).max(0.95).step(0.01)
    .default(DEFAULT_CONFIG.thresholdRatio).role('slider').description('自动压缩触发比例'),
  retainRatio: Schema.number().min(0.05).max(0.5).step(0.01)
    .default(DEFAULT_CONFIG.retainRatio).role('slider').description('压缩后保留近期上下文比例'),
  recoverOnOverflow: Schema.boolean().default(DEFAULT_CONFIG.recoverOnOverflow)
    .description('上下文溢出后压缩并重试原请求'),
  maxOverflowRetries: Schema.union([Schema.const(0), Schema.const(1)])
    .default(DEFAULT_CONFIG.maxOverflowRetries).description('单轮溢出恢复次数'),
  retryTransientBadRequest: Schema.boolean().default(DEFAULT_CONFIG.retryTransientBadRequest)
    .description('非溢出的 400 瞬态错误（会话此前成功过）自动重试一次'),
  modelPolicies: Schema.array(ModelPolicy).default([]).description('provider/model 专属策略'),
}).description('DSH 请求路径上下文压缩')

// 0.2.x：根 schema 标 volatile()。volatileForm() 的第一行就是
//   if (schema.meta.volatile) return plainSchema(schema)
// 所以根标记直接返回整张表单；不标则投影为 undefined、表单不生成，
// 客户端 configForms 只能回 unavailable（设置卡永远空白）。
// 用 typeof 探测，避免 schemastery 无此方法时在导入期就抛。
export const Config = typeof BaseConfig.volatile === 'function' ? BaseConfig.volatile() : BaseConfig

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function authorize(req, res) {
  if (!isLoopback(req.socket?.remoteAddress)) {
    jsonResponse(res, 403, { error: 'local access only' })
    return false
  }
  const origin = req.headers?.origin
  if (origin) {
    let originHost
    try { originHost = new URL(origin).host } catch {}
    if (!originHost || originHost !== req.headers.host) {
      jsonResponse(res, 403, { error: 'origin mismatch' })
      return false
    }
  }
  return true
}

async function readJson(req) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > 4096) throw new Error('request body is too large')
    chunks.push(chunk)
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('body must be an object')
  return value
}

export function createStatusHandler(ctx, settings = ctx.__dshCompactSettings) {
  return async (req, res) => {
    if (!authorize(req, res)) return
    if (req.method !== 'GET') {
      jsonResponse(res, 405, { error: 'method not allowed' })
      return
    }
    const url = new URL(req.url ?? STATUS_ENDPOINT, `http://${req.headers.host ?? '127.0.0.1'}`)
    const sessionId = url.searchParams.get('sessionId') ?? ''
    const agent = sessionId ? ctx.agents?.get?.(sessionId) : undefined
    const service = agent ? ctx.agentPresets?.serviceFor?.(agent, 'compaction') : undefined
    const policy = agent ? resolvePolicy(setSharedConfig(settings.get()), routedTargetOf(agent)) : undefined
    jsonResponse(res, 200, {
      ...compactStatus.get(sessionId),
      engineActive: service?.dshCompact === true,
      ...(policy ? { policy } : {}),
    })
  }
}

export function createCompactNowHandler(ctx) {
  return async (req, res) => {
    if (!authorize(req, res)) return
    if (req.method !== 'POST') {
      jsonResponse(res, 405, { error: 'method not allowed' })
      return
    }
    let body
    try { body = await readJson(req) } catch (error) {
      jsonResponse(res, 400, { error: error instanceof Error ? error.message : String(error) })
      return
    }
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const agent = sessionId ? ctx.agents?.get?.(sessionId) : undefined
    if (!agent) {
      jsonResponse(res, 404, { error: 'session is not active' })
      return
    }
    const service = ctx.agentPresets?.serviceFor?.(agent, 'compaction')
    if (!service || service.dshCompact !== true || typeof service.compactNow !== 'function') {
      jsonResponse(res, 409, { error: 'current preset does not use dsh-compact' })
      return
    }
    try {
      const result = await service.compactNow(agent, AbortSignal.timeout(120000))
      jsonResponse(res, 200, {
        ok: true,
        compacted: result !== null,
        status: compactStatus.get(sessionId),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const busy = error?.code === 'busy' || /\bbusy\b|requires an idle agent/i.test(message)
      jsonResponse(res, busy ? 409 : 500, { error: message, code: busy ? 'busy' : 'failed' })
    }
  }
}

export function apply(ctx, config = {}) {
  let scope
  try {
    // 0.2.x 没有 ctx.settings.register（命名空间注册模型已退役，表单改由
    // Config schema 派生）；用垫片在 describe()/update() 之上重建同形 scope。
    scope = createSettingsScope(ctx, NS, Config, sanitizeConfig(config))
    if (scope === null) throw new Error('no settings transport on this kernel')
  } catch (error) {
    ctx.logger?.warn?.(
      `dsh-compact settings unavailable: ${error instanceof Error ? error.message : String(error)}; using defaults`,
    )
    setSharedConfig(DEFAULT_CONFIG)
    return
  }
  ctx.__dshCompactSettings = scope
  setSharedConfig(scope.get())
  const unwatch = scope.watch((next) => setSharedConfig(next))
  ctx.inject?.(['webServer', 'agents', 'agentPresets'], (httpCtx) => {
    httpCtx.effect(
      () => httpCtx.webServer.register({
        kind: 'exact',
        path: STATUS_ENDPOINT,
        handler: createStatusHandler(httpCtx, scope),
      }),
      'dsh-compact: status endpoint',
    )
    httpCtx.effect(
      () => httpCtx.webServer.register({
        kind: 'exact',
        path: COMPACT_ENDPOINT,
        handler: createCompactNowHandler(httpCtx),
      }),
      'dsh-compact: compact-now endpoint',
    )
  })
  ctx.effect?.(() => () => unwatch(), 'dsh-compact: settings watcher')
}

export { DshCompactEngine } from './engine.js'
export { DEFAULT_CONFIG, compactStatus, resolvePolicy, sanitizeConfig } from './policy.js'
