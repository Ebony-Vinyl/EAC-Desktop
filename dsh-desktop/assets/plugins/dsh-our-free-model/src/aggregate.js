/**
 * Outbound wire for the aggregate lane: the user's own keys at third-party
 * providers.
 *
 * The other three lanes are fixed outlets — a pooled anonymous credential, a
 * co-paid relay, a keyless gateway — and each owns its own module. This lane is
 * the orthogonal one: the 76 providers of `src/providers/registry.json`, each
 * reachable only with material the user pastes into the settings page. The
 * module therefore does three things and no more:
 *
 *   1. `buildAggregateCatalog` turns the settings section into catalog rows the
 *      picker and the router already understand — the shape the EAC and Kilo
 *      rows use, `channel: 'aggregate'`, one row per enabled provider/model.
 *   2. `resolveProvider` is the one place a provider's effective credential,
 *      base URL and headers are decided, so the poster and the two probes can
 *      never disagree about which host a key is sent to.
 *   3. `postAggregateStreamed` posts one turn with the discipline every other
 *      lane's poster uses — body shape sniffed before the Content-Type is
 *      believed, head replayed so no token is buffered, the shared readers
 *      owning the deadline — and, when a provider ignores `stream:true` and
 *      answers with one JSON document, synthesises the frame sequence the
 *      wire's decoder needs to see a complete turn.
 *
 * Wire shapes: the registry names a `format`, the plugin names a `wire`
 * (src/stream.js). openai-chat -> chat, openai-responses -> responses, and
 * anthropic-messages -> messages. The last mapping is the judgement worth
 * stating: Anthropic's SSE is a different event vocabulary, and the honest move
 * is not to fold it into OpenAI chunks — the plugin already has a complete
 * native consumer for it (`readStream(..., 'messages')` / `feedClaude` on the
 * response side, `buildPayload('messages', …)` on the request side, both
 * exercised by the free lane's own Messages models). Translating would
 * duplicate that shaper in reverse and lose what it carries: `system`
 * placement, interleaved text/tool_use block indices, `cache_read_input_tokens`
 * accounting, and stop reasons like `refusal` have no faithful chat equivalent.
 * An anthropic-messages row is therefore served on the messages wire end to
 * end, and the poster pushes the provider's own frames through untouched.
 *
 * Reasoning effort: the registry declares no provider-native effort fields, so
 * a row here declares no thinking menu either. The harness's effort ids are the
 * plugin's own ladder (`light`/`balanced`/`deep`, src/effort.js), which the
 * shared budget logic turns into a `max_tokens` ceiling — the one control every
 * provider in this registry accepts.
 *
 * Keys: every string that reaches a message — a classified failure, a body
 * snippet, a probe's answer — passes through `redact`, so a provider that
 * echoes the credential back (a 401 body usually does) still cannot put it in
 * front of the user, a log, or the harness's durable session log.
 *
 * @module src/aggregate.js
 */

import { CODE, UpstreamError, classifyFailure, classifyStreamFailure, readHead, readSse, replayStream, sniffBody, transportCause } from './http.js'
import { egressFetch } from './egress.js'
import { chatEndpoint, defaultHeaders, getProvider, modelsEndpoint, providerModelId } from './providers/index.js'
import { displayModelName } from './catalog.js'

/** The channel tag every aggregate row carries, the way EAC and Kilo rows do. */
export const AGGREGATE_CHANNEL = 'aggregate'

/** Registry `format` -> the plugin's wire vocabulary (src/stream.js). */
const WIRE_BY_FORMAT = Object.freeze({
  'openai-chat': 'chat',
  'openai-responses': 'responses',
  'anthropic-messages': 'messages',
})

/**
 * Wire suffixes, needed only for the one record the registry gives no base URL
 * to (Azure names its endpoint per deployment, so `chatEndpoint` is null there
 * and there is no registry endpoint to read the suffix off). `registry-test`
 * pins the same three suffixes, so a drift here fails a test, not a turn.
 */
const CHAT_SUFFIX = Object.freeze({
  'openai-chat': '/chat/completions',
  'openai-responses': '/responses',
  'anthropic-messages': '/messages',
})

const DEFAULT_CONTEXT_WINDOW = 131072
const DEFAULT_MAX_OUTPUT = 32768
const SNIFF_BYTES = 4096
const LISTING_TIMEOUT_MS = 15000
const TURN_TIMEOUT_MS = 300000
const USER_AGENT = 'dsh-our-free-model'

/** A trimmed non-empty string, or ''. */
function text(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : ''
}

/** A positive finite number, or undefined — the catalog's own reading of one. */
function number(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** The per-provider settings object, or null when the config names none. */
function settingFor(config, providerId) {
  const providers = config?.providers
  if (!isRecord(providers)) return null
  const setting = providers[providerId]
  return isRecord(setting) ? setting : null
}

/** A base URL a request can actually be sent to. */
function hasPlaceholder(baseUrl) {
  return /\{[^}]*\}/.test(baseUrl)
}

/** The user's `baseUrl` override when present, else the registry's own, slash-trimmed. */
function effectiveBaseUrl(provider, setting) {
  const override = text(setting?.baseUrl)
  const base = override !== '' ? override : text(provider.baseUrl)
  return base.replace(/\/+$/, '')
}

/**
 * The provider's model listing URL, moved by a `baseUrl` override when — and
 * only when — the declared listing actually lives under the registry base.
 * Three providers (cohere, deepinfra, ollama_cloud) publish their listing on
 * another path; rewriting a URL that never pointed at the override would invent
 * one, and a guessed listing URL is worse than none.
 */
function effectiveModelsUrl(provider, setting) {
  const declared = modelsEndpoint(provider)
  if (declared === null) return null
  const override = text(setting?.baseUrl).replace(/\/+$/, '')
  const registryBase = text(provider.baseUrl).replace(/\/+$/, '')
  if (override === '' || registryBase === '' || !declared.startsWith(registryBase)) return declared
  return `${override}${declared.slice(registryBase.length)}`
}

/**
 * The full URL a turn is posted to, with the override applied; null when the
 * provider has no dialable endpoint (Azure without a user-supplied base URL, or
 * a base URL still carrying the registry's `{account_id}`-style placeholder).
 */
function effectiveChatUrl(provider, setting) {
  const override = text(setting?.baseUrl).replace(/\/+$/, '')
  const declared = chatEndpoint(provider)
  if (declared !== null) {
    const registryBase = text(provider.baseUrl).replace(/\/+$/, '')
    const url = override === '' || registryBase === '' ? declared : `${override}${declared.slice(registryBase.length)}`
    return hasPlaceholder(url) ? null : url
  }
  const suffix = CHAT_SUFFIX[provider.format]
  if (override === '' || suffix === undefined || hasPlaceholder(override)) return null
  return `${override}${suffix}`
}

/**
 * Can this provider's row exist at all? A key is required exactly where the
 * registry declares one is: keyless and local providers are complete without
 * it, and the two credential flows the registry names but this lane cannot
 * drive — oauth and adc, whose tokens are minted by their own sign-in — are
 * never usable here, key pasted or not (`defaultHeaders` would not even send
 * it, so the row would be a guaranteed 401).
 */
function authUsable(provider, setting) {
  if (provider.auth.kind === 'oauth' || provider.auth.kind === 'adc') return false
  if (provider.auth.kind === 'apiKey') return text(setting?.apiKey) !== ''
  return true
}

/** The ids a provider should be served with, and where that list came from. */
function modelIdsFor(provider, setting) {
  const override = stringList(setting?.models)
  if (override.length > 0) return { ids: override, source: 'static' }
  // `discovered` is the optional cache a listing round writes back (see
  // `fetchProviderModels`): rows built from it are the only ones marked
  // 'discovered', so a picker can tell a live roster from a configured one.
  const discovered = stringList(setting?.discovered)
  if (discovered.length > 0) return { ids: discovered, source: 'discovered' }
  return { ids: provider.models.map(model => model.id), source: 'static' }
}

/** A de-duplicated list of non-empty trimmed strings from an untrusted array. */
function stringList(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const ids = []
  for (const raw of value) {
    const id = text(raw)
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/**
 * One catalog row. Capacities come from the registry's model row where it has
 * them and fall back to the plugin's own defaults where it does not (most rows
 * carry no context window, and none carries an output ceiling — the registry
 * records ids and published capacities, not a serving contract).
 */
function entryOf(provider, modelId, source) {
  const row = provider.models.find(model => model.id === modelId) ?? null
  const contextWindow = number(row?.contextWindow) ?? DEFAULT_CONTEXT_WINDOW
  const label = text(row?.name) !== '' ? text(row.name) : displayModelName(modelId)
  return {
    id: providerModelId(provider.id, modelId),
    name: `${provider.name} ${label}`,
    channel: AGGREGATE_CHANNEL,
    providerId: provider.id,
    modelId,
    format: provider.format,
    vision: row?.vision === true,
    reasoning: row?.reasoning !== false,
    contextWindow,
    maxOutput: Math.min(DEFAULT_MAX_OUTPUT, contextWindow),
    wire: WIRE_BY_FORMAT[provider.format],
    source,
    // No declared menu, so the free lane's token ladder is the control and the
    // answer owns the whole window: nothing here doubles a ceiling for
    // thinking the provider never promised to stream.
    canDisableThinking: true,
    regionSensitive: false,
  }
}

/**
 * Build catalog entries for every enabled provider/model in the user's config.
 *
 * @param {object} config - the plugin settings' `aggregate` section:
 *   { enabled: boolean, providers: { [providerId]: { enabled, apiKey, baseUrl?, models?: string[], discovered?: string[], addedAt? } } }
 * @returns {Array<object>} entries shaped like other lanes' rows, plus:
 *   { id: 'provider/model', name, channel:'aggregate', providerId, modelId, format, vision, reasoning, contextWindow, maxOutput, wire: 'chat'|'messages'|'responses', source: 'static'|'discovered' }
 */
export function buildAggregateCatalog(config) {
  // The section's own switch: a lane the user turned off contributes no rows at
  // all, whatever the per-provider flags say.
  if (config?.enabled === false) return []
  const providers = config?.providers
  if (!isRecord(providers)) return []
  const entries = []
  for (const [key, setting] of Object.entries(providers)) {
    if (!isRecord(setting) || setting.enabled !== true) continue
    const provider = getProvider(key)
    if (provider === null) continue
    if (!authUsable(provider, setting)) continue
    // A row whose endpoint cannot be composed is a picker entry that can never
    // answer; the registry's placeholder hosts and Azure-without-a-deployment
    // stay out until the user supplies a real base URL.
    if (effectiveChatUrl(provider, setting) === null) continue
    const { ids, source } = modelIdsFor(provider, setting)
    for (const modelId of ids) entries.push(entryOf(provider, modelId, source))
  }
  return entries
}

/** Is this catalog entry an aggregate-lane row? */
export function isAggregateEntry(entry) {
  return entry?.channel === AGGREGATE_CHANNEL
}

/**
 * Resolve one provider's effective settings.
 *
 * Throws an `UpstreamError` whose code is outside the retryable set — the
 * aggregate lane's `LANE_LOCKED` shape: an unknown id, a switched-off provider,
 * an unusable credential flow or a missing key are states the user fixes in the
 * settings page, not transport faults to retry.
 *
 * @param {object} config - the plugin settings' `aggregate` section
 * @param {string} providerId - a registry provider id
 * @returns {{providerId:string, provider:object, apiKey:string, baseUrl:string, format:string, wire:string, chatUrl:string, modelsUrl:string|null, headers:Record<string,string>}}
 */
export function resolveProvider(config, providerId) {
  const id = text(providerId)
  const provider = id === '' ? null : getProvider(id)
  if (provider === null) {
    throw new UpstreamError(`the aggregate lane has no provider "${id === '' ? String(providerId ?? '') : id}"`, CODE.client)
  }
  const setting = settingFor(config, provider.id)
  if (setting?.enabled === false) {
    throw new UpstreamError(`"${provider.name}" is switched off in the aggregate settings`, CODE.client)
  }
  if (provider.auth.kind === 'oauth' || provider.auth.kind === 'adc') {
    throw new UpstreamError(`"${provider.name}" signs in with ${provider.auth.kind}, not with an API key, so the aggregate lane does not serve it`, CODE.credential)
  }
  const apiKey = text(setting?.apiKey)
  if (provider.auth.kind === 'apiKey' && apiKey === '') {
    throw new UpstreamError(`"${provider.name}" needs an API key: paste one in the aggregate settings (the provider issues them at ${provider.auth.url})`, CODE.credential)
  }
  const baseUrl = effectiveBaseUrl(provider, setting)
  if (baseUrl === '') {
    throw new UpstreamError(`"${provider.name}" has no base URL of its own — set one in the aggregate settings`, CODE.client)
  }
  if (hasPlaceholder(baseUrl)) {
    throw new UpstreamError(`"${provider.name}"'s base URL still carries a registry placeholder — set the real URL in the aggregate settings`, CODE.client)
  }
  const chatUrl = effectiveChatUrl(provider, setting)
  if (chatUrl === null) {
    throw new UpstreamError(`"${provider.name}" has no usable ${provider.format} endpoint`, CODE.client)
  }
  // The provider's own declared headers first, credential last: a provider that
  // ships a `user-agent` (kimchi) or an `anthropic-beta` (minimax-cn) keeps it.
  const headers = defaultHeaders(provider, apiKey)
  if (headers['user-agent'] === undefined) headers['user-agent'] = USER_AGENT
  return {
    providerId: provider.id,
    provider,
    apiKey,
    baseUrl,
    format: provider.format,
    wire: WIRE_BY_FORMAT[provider.format],
    chatUrl,
    modelsUrl: effectiveModelsUrl(provider, setting),
    headers,
  }
}

/**
 * Remove a credential from anything that may reach a message.
 *
 * Providers echo credentials back — a 401 body routinely repeats the rejected
 * key — and this text is folded into failure messages the harness writes to its
 * durable session log. The comparison is a plain substring search because the
 * secret is known verbatim; there is nothing to normalise.
 */
function redact(value, apiKey) {
  let source = String(value ?? '')
  const key = text(apiKey)
  if (key === '') return source
  // Two spellings, because the text may already be JSON-encoded when it is
  // redacted: a key containing a quote or a backslash appears escaped there and
  // a raw-substring search would walk past it.
  const escaped = JSON.stringify(key).slice(1, -1)
  for (const needle of escaped === key ? [key] : [key, escaped]) {
    if (source.includes(needle)) source = source.split(needle).join('[redacted]')
  }
  return source
}

/**
 * Classify an upstream refusal, with the credential scrubbed out of whatever
 * the provider's body said about it.
 *
 * The body is redacted before it is truncated: slicing first could cut a key in
 * half and leave the front of it in the snippet.
 */
function classifyUpstream(status, bodyText, retryAfterMs, apiKey) {
  const safe = redact(bodyText, apiKey)
  let payload
  try { payload = JSON.parse(safe) } catch { payload = { error: { message: safe.slice(0, 300) || `HTTP ${status}` } } }
  const failure = classifyFailure(status, payload, retryAfterMs)
  // The classifier copies the envelope's own strings onto the error (`message`,
  // and the machine-readable `type`), so both are scrubbed: a hostile or merely
  // clumsy provider could echo the credential in either.
  for (const field of ['message', 'type']) {
    if (typeof failure[field] === 'string') failure[field] = redact(failure[field], apiKey)
  }
  return failure
}

/** `Retry-After` seconds -> milliseconds, the conversion every poster applies. */
function retryAfterMs(response) {
  const seconds = Number(response.headers.get('retry-after'))
  return Number.isFinite(seconds) && seconds > 0 ? Math.trunc(seconds * 1000) : undefined
}

/**
 * Fetch a provider's live model list when it declares a models endpoint;
 * returns ids, or null when the provider is unknown/unconfigured, declares no
 * listing, or the listing cannot be read.
 *
 * An authoritative empty listing returns `[]`, not null: the caller can then
 * clear a persisted roster, while a failed round keeps it — the same discipline
 * the Kilo channel's roster already follows.
 */
export async function fetchProviderModels(config, providerId, { signal, timeoutMs = LISTING_TIMEOUT_MS } = {}) {
  let resolved
  try { resolved = resolveProvider(config, providerId) } catch { return null }
  if (resolved.modelsUrl === null) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  let callerAborted = false
  const onCallerAbort = () => { callerAborted = true; controller.abort() }
  signal?.addEventListener('abort', onCallerAbort, { once: true })
  try {
    const response = await egressFetch(resolved.modelsUrl, {
      headers: { ...resolved.headers, accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok) return null
    const body = await response.text()
    let payload
    try { payload = JSON.parse(body) } catch { return null }
    return modelIdsFrom(payload)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', onCallerAbort)
  }
}

/**
 * Verify a key with a cheap non-generating call: the provider's model listing.
 * Never throws — the settings page shows the answer, and a probe that throws is
 * a probe the page has to guard.
 *
 * A provider that declares no listing (Anthropic, OpenAI, …) cannot be verified
 * without spending a generation, and this lane does not spend the user's money
 * behind their back: the answer says so instead of guessing at a URL.
 *
 * @returns {Promise<{ok:boolean, status:number, message:string, modelCount?:number}>}
 */
export async function testProvider(config, providerId, { signal, timeoutMs = LISTING_TIMEOUT_MS } = {}) {
  let resolved
  try {
    resolved = resolveProvider(config, providerId)
  } catch (error) {
    return { ok: false, status: 0, message: String(error?.message ?? error) }
  }
  if (resolved.modelsUrl === null) {
    return {
      ok: false,
      status: 0,
      message: `"${resolved.provider.name}" declares no model listing, so its key cannot be verified without spending a generation`,
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  let callerAborted = false
  const onCallerAbort = () => { callerAborted = true; controller.abort() }
  signal?.addEventListener('abort', onCallerAbort, { once: true })
  try {
    const response = await egressFetch(resolved.modelsUrl, {
      headers: { ...resolved.headers, accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    })
    const body = await response.text().catch(() => '')
    if (!response.ok) {
      const failure = classifyUpstream(response.status, body, retryAfterMs(response), resolved.apiKey)
      return { ok: false, status: response.status, message: failure.message }
    }
    let payload
    try { payload = JSON.parse(redact(body, resolved.apiKey)) } catch { payload = null }
    const ids = modelIdsFrom(payload)
    if (ids === null) {
      return { ok: false, status: response.status, message: `the listing answered HTTP ${response.status} but its shape was not recognised` }
    }
    return { ok: true, status: response.status, message: `the key is accepted; ${ids.length} model(s) listed`, modelCount: ids.length }
  } catch (error) {
    if (callerAborted || signal?.aborted === true) return { ok: false, status: 0, message: 'request aborted' }
    if (error?.name === 'AbortError') return { ok: false, status: 0, message: `the provider did not answer within ${timeoutMs}ms` }
    return { ok: false, status: 0, message: redact(`the provider could not be reached: ${error?.message ?? error}${transportCause(error)}`, resolved.apiKey) }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', onCallerAbort)
  }
}

/**
 * Read a model-listing document into ids, or null when the shape is not a
 * listing at all.
 *
 * Tolerant on purpose: the registry's endpoints speak several dialects — the
 * OpenAI `{data:[{id}]}`, Cohere's `{models:[{name}]}`, Ollama's
 * `{models:[{name}]}`, DeepInfra's `[{model_name}]` — and a row's id is the
 * first of those fields it actually carries.
 */
function modelIdsFrom(payload) {
  const rows = Array.isArray(payload) ? payload
    : Array.isArray(payload?.data) ? payload.data
      : Array.isArray(payload?.models) ? payload.models
        : null
  if (rows === null) return null
  const seen = new Set()
  const ids = []
  for (const row of rows) {
    let id = ''
    if (typeof row === 'string') id = text(row)
    else if (isRecord(row)) {
      for (const field of ['id', 'name', 'model', 'model_name']) {
        id = text(row[field])
        if (id !== '') break
      }
    }
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/**
 * POST one streaming completion to the provider and push raw SSE `data:`
 * payloads to `onData`.
 *
 * Catalog ids include the provider namespace; the provider only accepts its
 * own bare model id. When modelId is supplied it overrides body.model for
 * object and serialized JSON bodies alike. Routed bodies get `stream:true`;
 * a serialized body without modelId is posted as given. The response's shape,
 * not its Content-Type, decides how it is read, and the caller's signal is
 * the only deadline owner besides the shared readers' idle budget.
 *
 * A JSON answer to a streamed request is normalised into the frame sequence
 * the row's wire decodes: chat chunks for `chat`, Anthropic events for
 * `messages`, Responses events for `responses`.
 *
 * @param {object} options
 * @param {object} options.config - the plugin settings' `aggregate` section
 * @param {string} options.providerId - registry provider id
 * @param {string} [options.modelId] - the bare outbound model id and label for synthesised frames
 * @param {object|string} options.body - the request body the caller built for this wire
 * @param {AbortSignal} [options.signal]
 * @param {(payload: string) => void} options.onData - one `data:` payload, in order
 * @param {number} [options.timeoutMs] - idle budget handed to the shared readers
 * @returns {Promise<{status:number}>}
 */
export async function postAggregateStreamed({ config, providerId, modelId, body, signal, onData, timeoutMs = TURN_TIMEOUT_MS }) {
  const resolved = resolveProvider(config, providerId)
  const model = text(modelId)
  let outbound = body
  if (typeof outbound === 'string' && model !== '') {
    try { outbound = JSON.parse(outbound) }
    catch { throw new UpstreamError('aggregate request body is not valid JSON', CODE.client) }
    if (!isRecord(outbound)) throw new UpstreamError('aggregate request body must be a JSON object', CODE.client)
  }
  const bodyText = typeof outbound === 'string' ? outbound
    : JSON.stringify({ ...outbound, ...(model === '' ? {} : { model }), stream: true })
  let response
  try {
    response = await egressFetch(resolved.chatUrl, {
      method: 'POST',
      headers: { ...resolved.headers, accept: 'text/event-stream' },
      body: bodyText,
      redirect: 'error',
      signal,
    })
  } catch (error) {
    if (signal?.aborted === true || error?.name === 'AbortError') throw new UpstreamError('request aborted', CODE.aborted)
    throw new UpstreamError(
      `model request to ${resolved.provider.name} failed: ${redact(error?.message ?? error, resolved.apiKey)}${transportCause(error)}`,
      CODE.transport)
  }

  const setRetry = retryAfterMs(response)
  if (!response.ok) {
    const refusal = await response.text().catch(() => '')
    throw classifyUpstream(response.status, refusal, setRetry, resolved.apiKey)
  }
  if (response.body === null) throw new UpstreamError('model stream returned no body', CODE.empty)

  const head = await readHead(response.body, SNIFF_BYTES, { signal, timeoutMs })
  const shape = sniffBody(head.text)
  if (shape === 'empty') throw new UpstreamError('model stream returned no body', CODE.empty)
  if (shape === 'sse') {
    // Raw payloads, straight through: the wire's own decoder reads them, so
    // nothing is rewritten between the provider and the harness.
    await readSse(replayStream(head), onData, signal, timeoutMs)
    return { status: response.status }
  }

  // A provider that answered a stream request with one JSON document. Fold the
  // whole answer in, then emit the frame sequence its wire's decoder expects.
  let rawText = head.text
  if (!head.done) {
    try {
      while (true) {
        const row = await head.reader.read()
        if (row.done) break
        if (row.value !== undefined) rawText += head.decoder.decode(row.value, { stream: true })
      }
    } catch (error) {
      await head.reader.cancel().catch(() => {})
      throw classifyStreamFailure(error, signal)
    }
  }
  rawText += head.decoder.decode()
  let payload
  try {
    payload = JSON.parse(redact(rawText, resolved.apiKey))
  } catch {
    // A 200 body that is not JSON is a hop speaking for the provider. Markup is
    // a front proxy (a WAF page, a CDN error), and replaying the identical body
    // draws it again — so it is not retryable SERVER.
    if (/^\s*<(!doctype|html[\s>])/i.test(rawText)) {
      throw new UpstreamError(
        `the provider's front proxy answered HTTP ${response.status} with an HTML error page`,
        CODE.client, { status: response.status })
    }
    throw new UpstreamError(`unexpected non-stream response: ${redact(rawText, resolved.apiKey).slice(0, 200)}`, CODE.server, { status: response.status })
  }
  if (payload?.error !== undefined || payload?.type === 'error') {
    throw classifyUpstream(response.status, rawText, setRetry, resolved.apiKey)
  }
  for (const frame of synthesisedFrames(resolved.wire, payload, model)) onData(frame)
  return { status: response.status }
}

/**
 * The frames one JSON answer turns into, in the vocabulary of the row's wire.
 *
 * Each wire gets a terminal frame, always: a decoder that sees no terminal
 * event reads a finished turn as a stream the provider cut, which the harness
 * answers with a retry.
 */
function synthesisedFrames(wire, payload, model) {
  if (wire === 'messages') return anthropicFrames(payload, model)
  if (wire === 'responses') return responsesFrames(payload, model)
  return chatFrames(payload, model)
}

/** One `chat.completion.chunk` per field the chat decoder reads. */
function chatFrames(payload, model) {
  const choice = payload?.choices?.[0] ?? {}
  const message = choice.message ?? {}
  const frames = []
  const head = { id: text(payload?.id) || 'aggregate', object: 'chat.completion.chunk', created: number(payload?.created) ?? Math.floor(Date.now() / 1000), model }
  const reasoning = typeof message.reasoning_content === 'string' ? message.reasoning_content
    : typeof message.reasoning === 'string' ? message.reasoning : ''
  if (reasoning !== '') {
    frames.push(JSON.stringify({ ...head, choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: reasoning }, finish_reason: null }] }))
  }
  const content = typeof message.content === 'string' ? message.content
    : Array.isArray(message.content) ? message.content.map(part => (typeof part?.text === 'string' ? part.text : '')).join('') : ''
  if (content !== '') {
    frames.push(JSON.stringify({ ...head, choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] }))
  }
  let index = 0
  for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
    frames.push(JSON.stringify({
      ...head,
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index,
            id: text(call?.id) || `call_${index}`,
            type: 'function',
            function: { name: text(call?.function?.name), arguments: typeof call?.function?.arguments === 'string' ? call.function.arguments : '' },
          }],
        },
        finish_reason: null,
      }],
    }))
    index += 1
  }
  frames.push(JSON.stringify({
    ...head,
    choices: [{ index: 0, delta: {}, finish_reason: text(choice.finish_reason) || 'stop' }],
    ...payload?.usage === undefined ? {} : { usage: payload.usage },
  }))
  return frames
}

/** One Anthropic event sequence per block, plus the terminal pair. */
function anthropicFrames(payload, model) {
  const usage = isRecord(payload?.usage) ? payload.usage : undefined
  const frames = [JSON.stringify({
    type: 'message_start',
    message: {
      id: text(payload?.id) || 'aggregate',
      type: 'message',
      role: 'assistant',
      model,
      ...usage === undefined ? {} : { usage },
    },
  })]
  const blocks = Array.isArray(payload?.content) ? payload.content : []
  blocks.forEach((block, index) => {
    const type = text(block?.type)
    if (type === 'tool_use') {
      frames.push(JSON.stringify({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: text(block?.id) || `toolu_${index}`, name: text(block?.name) } }))
      frames.push(JSON.stringify({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block?.input ?? {}) } }))
    } else if (type === 'thinking' || type === 'redacted_thinking') {
      frames.push(JSON.stringify({ type: 'content_block_start', index, content_block: { type } }))
      const thinking = typeof block?.thinking === 'string' ? block.thinking : ''
      if (thinking !== '') frames.push(JSON.stringify({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking } }))
    } else {
      frames.push(JSON.stringify({ type: 'content_block_start', index, content_block: { type: type === '' ? 'text' : type } }))
      const value = typeof block?.text === 'string' ? block.text : ''
      if (value !== '') frames.push(JSON.stringify({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: value } }))
    }
    frames.push(JSON.stringify({ type: 'content_block_stop', index }))
  })
  frames.push(JSON.stringify({
    type: 'message_delta',
    delta: { stop_reason: text(payload?.stop_reason) || 'end_turn', stop_sequence: payload?.stop_sequence ?? null },
    ...usage === undefined ? {} : { usage: { output_tokens: number(usage.output_tokens) ?? 0 } },
  }))
  frames.push(JSON.stringify({ type: 'message_stop' }))
  return frames
}

/** One Responses event sequence per output item, then the terminal frame. */
function responsesFrames(payload, model) {
  const frames = []
  const output = Array.isArray(payload?.output) ? payload.output : []
  output.forEach((item, outputIndex) => {
    const type = text(item?.type)
    if (type === 'reasoning') {
      const summary = Array.isArray(item?.summary) ? item.summary : []
      const delta = summary.map(part => (typeof part?.text === 'string' ? part.text : '')).join('')
      if (delta !== '') frames.push(JSON.stringify({ type: 'response.reasoning_summary_text.delta', item_id: text(item?.id), output_index: outputIndex, delta }))
      return
    }
    if (type === 'message') {
      const content = Array.isArray(item?.content) ? item.content : []
      const delta = content.map(part => (typeof part?.text === 'string' ? part.text : '')).join('')
      if (delta !== '') frames.push(JSON.stringify({ type: 'response.output_text.delta', item_id: text(item?.id), output_index: outputIndex, delta }))
      return
    }
    if (type === 'function_call') {
      frames.push(JSON.stringify({ type: 'response.output_item.added', output_index: outputIndex, item }))
      frames.push(JSON.stringify({
        type: 'response.function_call_arguments.delta',
        item_id: text(item?.id),
        output_index: outputIndex,
        delta: typeof item?.arguments === 'string' ? item.arguments : '',
      }))
    }
  })
  frames.push(JSON.stringify({ type: 'response.completed', response: { ...payload, model: text(payload?.model) || model } }))
  return frames
}
