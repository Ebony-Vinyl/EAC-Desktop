/**
 * Outbound HTTP for the free lane: request posting, SSE line extraction, and the
 * classification of gateway failures into the harness's provider-neutral codes.
 *
 * The gateway reports a refusal as a JSON error envelope whose `type` is the
 * machine-readable discriminator. Three of them matter operationally and are
 * distinguished here because they need different handling:
 *
 * - `RegionError`  — the model exists but this egress country is excluded. Not a
 *   credential or capacity problem, and it clears the moment the user's egress
 *   changes, so it feeds the availability probe rather than a retry.
 * - `FreeUsageLimitError` / 429 — the per-session quota is spent; retrying with
 *   a fresh session makes it worse, which is why the session id is stable.
 * - `ModelError` / "Model is unavailable" — the pooled account no longer routes
 *   that id at all.
 *
 * How a 2xx body is read is decided by the body, not by `Content-Type`: this
 * gateway is observed answering 200 with a JSON content type over an SSE frame
 * stream, and believing the header cost the whole turn (issue #6). The head is
 * sniffed and then replayed into the stream reader, so no token is buffered.
 *
 * @module src/http.js
 */

import { CLIENT_UA, UPSTREAM_BASE, gatewayHeaders, truncateSession } from './upstream.js'
import { egressFetch } from './egress.js'

/** Harness-neutral failure codes (packages/llm/llm/src/error.ts vocabulary; CLIENT_ERROR extends it like CONFIG_DISABLED does). */
export const CODE = {
  region: 'REGION_BLOCKED',
  quota: 'RATE_LIMIT',
  credential: 'INVALID_CREDENTIAL',
  // The co-paid lane's per-user gate (GitHub login + star): the credential
  // store is fine and the endpoint is reachable — this install just has not
  // been authorized yet. Its own code keeps it out of INVALID_CREDENTIAL, so
  // a refusal neither wipes the cached roster nor sends anyone chasing a
  // re-install; the settings page answers it with a login prompt instead.
  authorization: 'AUTHORIZATION_REQUIRED',
  // The free lane's client gate: the gateway judged *this client* and refused
  // the whole lane (403 FreeTierError). Not a credential, not a model, not
  // retryable — a refusal this install cannot retry away.
  laneLocked: 'LANE_LOCKED',
  permission: 'PERMISSION_DENIED',
  exhausted: 'QUOTA_EXHAUSTED',
  transport: 'TRANSPORT',
  timeout: 'TIMEOUT',
  server: 'SERVER',
  client: 'CLIENT_ERROR',
  empty: 'EMPTY_RESPONSE',
  aborted: 'ABORTED',
}

export class UpstreamError extends Error {
  constructor(message, code, details = {}) {
    super(message)
    this.name = 'UpstreamError'
    this.code = code
    Object.assign(this, details)
  }
}

/**
 * The socket-level facts behind a transport failure, walked off the error's
 * `cause` chain.
 *
 * Node's fetch collapses every DNS, TCP and TLS refusal into `TypeError: fetch
 * failed`; the reason a user could act on — the ENOTFOUND, the ECONNRESET, the
 * certificate alert — lives one or two `cause` links deeper and used to be
 * dropped, leaving the settings page's probe reporting an unexplainable "fetch
 * failed" (issue #79). The chain is walked at most three links deep, the codes
 * and first lines are deduplicated, and anything found is appended by the
 * transport wrap sites so "fetch failed" reads "fetch failed — getaddrinfo
 * ENOTFOUND opencode.ai (ENOTFOUND)" instead.
 */
export function transportCause(error) {
  const parts = []
  let node = error
  for (let depth = 0; depth < 3 && node?.cause !== undefined; depth += 1) {
    node = node.cause
    if (node === null || typeof node !== 'object') break
    const code = typeof node.code === 'string' && node.code !== '' ? node.code : ''
    const line = typeof node.message === 'string' ? node.message.split('\n')[0].trim() : ''
    if (line === '' && code === '') continue
    const fact = line === '' || line.includes(code) ? (line === '' ? code : line) : `${line} (${code})`
    if (!parts.includes(fact)) parts.push(fact)
  }
  return parts.length > 0 ? ` — ${parts.join('; ')}` : ''
}

/** Turn a gateway JSON error envelope into a classified failure. */
export function classifyFailure(status, payload, retryAfterMs) {
  const error = payload?.error ?? payload ?? {}
  const type = typeof error.type === 'string' ? error.type : ''
  const raw = typeof error.message === 'string' ? error.message : `upstream HTTP ${status}`
  // A front proxy (the free lane's CDN, the co-paid lane's WAF) answers hard
  // failures with a whole HTML error page. The status alone misfiles it — a
  // WAF's 403 is not a bad credential, its 413 is not a request the user can
  // fix by re-sending — and the markup buries the one useful fact. Callers may
  // hand over the raw page (the free lane's fold) or the one-line reduction
  // (errorPageMessage); both name the hop instead of the credential (issue #63).
  const rawHtml = /^\s*<(!doctype|html[\s>])/i.test(raw)
  const isHtmlPage = rawHtml || raw.includes('with an HTML error page')
  const message = rawHtml
    ? `the gateway's front proxy answered HTTP ${status} with an HTML error page — usually a WAF or body-size limit in front of the gateway, not your credentials; if this hit a long conversation, its request size is the likely trigger`
    : raw
  const flat = message.toLowerCase()
  if (type === 'RegionError' || /not available in your country|region/i.test(flat)) {
    return new UpstreamError(message, CODE.region, { status, type })
  }
  if (type !== 'permission_error' && (type === 'insufficient_quota' || error.code === 'insufficient_quota')) {
    return new UpstreamError(message, CODE.exhausted, { status, type })
  }
  if (type !== 'permission_error' && (status === 429 || type === 'FreeUsageLimitError' || /usage limit|rate limit/i.test(flat))) {
    return new UpstreamError(message, CODE.quota, { status, type, providerRetryAfterMs: retryAfterMs })
  }
  // The gateway rejects a signature only when the bytes it received differ from
  // the bytes that were signed — the credential itself is fine. On this lane
  // the usual cause is a local proxy plugin rewriting the body after signing
  // (issue #50), so it is neither INVALID_CREDENTIAL (users chase re-login and
  // re-installs for nothing) nor retryable-4xx territory: same body, same
  // rewrite, same refusal. TRANSPORT names the hop that mangled the request.
  if ((status === 401 || status === 403) && /signature rejected|signature mismatch/i.test(flat)) {
    return new UpstreamError(
      'the gateway rejected the request signature — the request body was modified in transit; if a local proxy plugin (e.g. billion-context) is installed, disable it for this lane or enable its passthrough for signed requests',
      CODE.transport, { status, type, signatureRejected: true })
  }
  // The co-paid lane's per-user gate speaks before any credential is judged:
  // the gateway refuses a turn because this install has not completed GitHub
  // login + star (or the star is gone), not because the lane's own material
  // is wrong. Reading it as INVALID_CREDENTIAL would wipe the cached roster
  // and send users chasing a re-install; it is a user-actionable state, so it
  // gets its own code and the settings page answers with a login prompt.
  if (type === 'AuthorizationRequired' || /需要 GitHub 授权|GitHub 授权无效/.test(raw)) {
    return new UpstreamError(message, CODE.authorization, { status, type, reason: typeof error.reason === 'string' ? error.reason : '' })
  }
  // The free lane's client gate (issue #310): 403 FreeTierError — "OpenCode's
  // free tier can only be used from within OpenCode" — names the client, not
  // the credential or the model. The stock classifier filed it as
  // INVALID_CREDENTIAL, which wiped the cached roster and sent users chasing
  // a re-login that cannot help: the upstream refuses this client's fingerprint
  // and no credential change alters that. Its own code keeps it out of both
  // the credential branch and the generic 4xx fallthrough, and the availability
  // probe reads it as a lane-level lock (src/probe.js) instead of leaving the
  // model in the picker as "unknown".
  if (type === 'FreeTierError' || /free tier can only be used from within/i.test(flat)) {
    return new UpstreamError(message, CODE.laneLocked, { status, type })
  }
  if (type === 'permission_error') return new UpstreamError(message, CODE.permission, { status, type })
  // An HTML page at 401/403 is the front proxy speaking, not the credential
  // store: fall through to the 4xx branch so users are not sent re-logging for
  // a WAF refusal.
  if (status === 401 || status === 403) return new UpstreamError(message, isHtmlPage ? CODE.client : CODE.credential, { status, type })
  if (type === 'ModelError' || /model is unavailable|not supported/.test(flat)) {
    return new UpstreamError(message, CODE.server, { status, type, unavailable: true })
  }
  // 4xx is the request's own fault: replaying the identical body reproduces the
  // identical refusal, so it stays outside the harness's retryable set — which
  // is why SERVER (retryable) must not be the fallback for it. 408 and 425 are
  // the carve-out: they name the gateway's own timing trouble, and a re-send
  // can answer differently. Out-of-band callers pass no status at all, so they
  // keep falling through to SERVER below.
  if (status >= 400 && status < 500 && status !== 408 && status !== 425) {
    return new UpstreamError(message, CODE.client, { status, type })
  }
  return new UpstreamError(message, CODE.server, { status, type })
}

/** Parse `Retry-After` into milliseconds, when the header carries a number. */
function retryAfter(header) {
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds > 0 ? Math.trunc(seconds * 1000) : undefined
}

/**
 * How many bytes to look at before deciding what the body is.
 *
 * The gateway is known to answer 200 with a `Content-Type` that is not
 * `text/event-stream` while the body underneath is a perfectly normal SSE
 * stream (issue #6, most visible on the chat wire under load). Trusting the
 * header threw the whole turn away, so the body's own shape decides — and the
 * bytes that were spent looking at it are replayed into the reader, never
 * swallowed by a `response.text()`, which would buffer a live stream to the end
 * before yielding a single token.
 */
const SNIFF_BYTES = 4096

/**
 * Classify the beginning of a response body by shape.
 *
 * @param {string} text - the decoded head, possibly a partial stream
 * @returns {'sse'|'json'|'empty'|'unknown'}
 */
export function sniffBody(text) {
  const head = String(text ?? '').replace(/^﻿/, '').trimStart()
  if (head === '') return 'empty'
  if (head.startsWith(':') || /^(?:data|event|id|retry)[ \t]*:/m.test(head.slice(0, 64))) return 'sse'
  if (head.startsWith('{') || head.startsWith('[')) return 'json'
  return 'unknown'
}

/**
 * Take the first `limit` bytes of a body without losing the rest of it.
 *
 * Stops as soon as the head has said it is a stream: a short answer whose server
 * keeps the connection open would otherwise sit here until the deadline, and the
 * cancel on the way out discards everything already read — a complete turn,
 * reported as a retryable timeout. Frames arrive as they are read, so the first
 * token is not held back for the rest of the sniff window either.
 *
 * Exported for the co-paid lane's poster (`src/eac.js`), which shares the sniff
 * discipline but not the headers.
 *
 * @param {ReadableStream} stream
 * @param {number} limit
 * @param {object} options
 * @param {AbortSignal} [options.signal]
 * @param {number} options.timeoutMs - how long to wait for anything at all
 * @returns {Promise<{reader:object, chunks:Uint8Array[], done:boolean, text:string, decoder:TextDecoder}>}
 */
export async function readHead(stream, limit, { signal, timeoutMs }) {
  const reader = stream.getReader()
  const chunks = []
  // One decoder for the whole body: flushing here would corrupt a multi-byte
  // character whose tail arrives in the next chunk.
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  let done = false
  try {
    while (size < limit) {
      const row = await headRead(reader, signal, deadlineFor(timeoutMs))
      if (row.done) { done = true; break }
      if (row.value === undefined) continue
      chunks.push(row.value)
      size += row.value.byteLength ?? 0
      text += decoder.decode(row.value, { stream: true })
      if (sniffBody(text) === 'sse') break
    }
  } catch (error) {
    // Abandoning the body: cancel it so the connection is not held, and do not
    // let a lock-release complaint replace the failure the caller has to
    // classify (a raw TypeError here would reach the harness unclassified).
    await reader.cancel().catch(() => {})
    try { reader.releaseLock?.() } catch { /* mid-teardown */ }
    throw classifyStreamFailure(error, signal)
  }
  return { reader, chunks, done, text, decoder }
}

/**
 * Normalize anything the body reads can throw into an `UpstreamError`.
 *
 * This matters beyond tidiness: aborting a request rejects the pending
 * `reader.read()` with the signal's own `DOMException`, whose `code` is the
 * *numeric* legacy `20`. The adapter's `toFailure` only carries a string code, so
 * anything it does not recognize is reported as `TRANSPORT` — and `TRANSPORT` is
 * in the retryable set, which would have the harness retry a turn the user
 * deliberately cancelled.
 */
export function classifyStreamFailure(error, signal) {
  if (error instanceof UpstreamError) return error
  if (signal?.aborted === true || error?.name === 'AbortError') return new UpstreamError('request aborted', CODE.aborted)
  return new UpstreamError(`our-free-model: upstream stream read failed: ${error?.message ?? error}${transportCause(error)}`, CODE.transport)
}

/** The head is the one read with no line-level deadline behind it, so it needs its own. */
function deadlineFor(timeoutMs) {
  return Date.now() + timeoutMs
}

/**
 * One read off the body while deciding what it is, bounded by the same deadline
 * and abort signal `readSse` would have honoured. Without this a connection that
 * accepts the request and then never sends a byte would hang the turn here, in
 * the few lines of code that run before any watchdog exists.
 */
async function headRead(reader, signal, deadline) {
  if (signal?.aborted) throw new UpstreamError('request aborted', CODE.aborted)
  let timer
  let onAbort
  const pending = reader.read()
  const halted = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new UpstreamError('our-free-model: upstream sent no bytes before its deadline', CODE.timeout)),
      Math.max(0, deadline - Date.now()))
    timer.unref?.()
    onAbort = () => {
      void reader.cancel().catch(() => {})
      reject(new UpstreamError('request aborted', CODE.aborted))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([pending, halted])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    // The losing read settles on its own once the reader is cancelled or closed;
    // nothing is waiting on it, so its outcome must not surface as a rejection.
    pending.catch(() => {})
  }
}

/**
 * Turn a head that was already read, plus the reader that follows it, back into
 * one byte stream. Shared with the co-paid lane's poster (`src/eac.js`).
 */
export function replayStream(head) {
  const stream = (async function* () {
    try {
      for (const chunk of head.chunks) yield chunk
      if (head.done) return
      while (true) {
        const row = await head.reader.read()
        if (row.done) return
        if (row.value !== undefined) yield row.value
      }
    } finally {
      if (!head.done) await head.reader.cancel().catch(() => {})
      head.reader.releaseLock?.()
    }
  })()
  // Async-generator return() waits behind an already pending next(). Expose a
  // direct cancel so readSse can close the underlying response immediately.
  stream.cancel = () => head.done ? undefined : head.reader.cancel()
  return stream
}

/**
 * Read the rest of a body that is not a stream, as text.
 *
 * Continues on the decoder the head used, so a character split across the sniff
 * boundary still decodes.
 */
async function readRemainder(head, signal) {
  let text = head.text
  try {
    if (!head.done) {
      while (true) {
        const row = await head.reader.read()
        if (row.done) break
        if (row.value !== undefined) text += head.decoder.decode(row.value, { stream: true })
      }
    }
  } catch (error) {
    await head.reader.cancel().catch(() => {})
    throw classifyStreamFailure(error, signal)
  }
  return text + head.decoder.decode()
}

/**
 * POST one request and stream back decoded SSE `data:` payloads.
 *
 * @param {object} options
 * @param {string} options.path - gateway path
 * @param {object} options.body - JSON request body
 * @param {string} options.session - canonical upstream session id
 * @param {string} [options.attributionUserAgent] - kept for the host API; this lane sends the v2 fingerprint UA instead
 * @param {AbortSignal} [options.signal]
 * @param {(payload: string) => void} options.onData - one `data:` payload, in order
 * @returns {Promise<{status:number, headers:Headers}>}
 */
/**
 * The User-Agent this lane sends.
 *
 * ⚠️ v2 指纹（2026-10-14 起）要求这一串**原样单独**出现：形状
 * `opencode/<channel>/<version>/<client>`、major ≥ 2，且按整串匹配。旧实现
 * 「归属 UA + `opencode/1.18.x`」的拼接方式现在两处都会踩雷 —— v1 版本号被按名字
 * 拒掉，任何前后缀又会让整串不再是 v2 客户端形状。
 *
 * ⇒ 本车道的 UA 就是官方那一串，归属信息不再随行；归属仍保留在其余车道
 * （channel pack / EAC / Kilo 各自带自己的 UA）。`attributionUserAgent` 因此在本
 * 车道上不再影响线上字节，参数保留是为了不动宿主 API 与调用方签名。
 */
function userAgentWith(_attribution) {
  return CLIENT_UA
}

export async function postStreamed({ path, body, session, attributionUserAgent, signal, onData, timeoutMs = 300000 }) {
  const headers = gatewayHeaders({ session: truncateSession(session), stream: true })
  headers['user-agent'] = userAgentWith(attributionUserAgent)
  let response
  try {
    response = await egressFetch(`${UPSTREAM_BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal })
  } catch (error) {
    // The signal's own reason is what fetch rejects with, and Node's is a
    // `TimeoutError`/user Error rather than `AbortError` — testing the name alone
    // reported a cancelled turn as `TRANSPORT`, which is retryable.
    if (signal?.aborted === true || error?.name === 'AbortError') throw new UpstreamError('request aborted', CODE.aborted)
    throw new UpstreamError(`our-free-model: upstream request failed: ${error?.message ?? error}${transportCause(error)}`, CODE.transport)
  }

  const setRetry = retryAfter(response.headers.get('retry-after'))
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let payload
    try { payload = JSON.parse(text) } catch { payload = { error: { message: text.slice(0, 300) || `HTTP ${response.status}` } } }
    throw classifyFailure(response.status, payload, setRetry)
  }
  if (response.body === null) throw new UpstreamError('our-free-model: upstream returned no body', CODE.empty)

  // `Content-Type` is a hint, not a verdict: take the first bytes and let the body
  // say what it is. Whatever was spent reading them is replayed in front of the
  // stream, so nothing is buffered away and no frame is dropped.
  const head = await readHead(response.body, SNIFF_BYTES, { signal, timeoutMs })
  const shape = sniffBody(head.text)
  if (shape === 'empty') throw new UpstreamError('our-free-model: upstream returned no body', CODE.empty)
  if (shape === 'sse') {
    await readSse(replayStream(head), onData, signal, timeoutMs)
    return { status: response.status, headers: response.headers }
  }

  const text = head.done ? head.text : await readRemainder(head, signal)
  if (shape !== 'json') {
    // Same front-proxy trap as the co-paid lane's poster (issue #63): a 200
    // body of markup is a WAF/CDN page, and replaying the identical request
    // draws it again — one readable line, outside the retryable set.
    if (/^\s*<(!doctype|html[\s>])/i.test(text)) {
      throw new UpstreamError(`the gateway's front proxy answered HTTP ${response.status} with an HTML error page — usually a WAF or body-size limit in front of the gateway`, CODE.client, { status: response.status })
    }
    throw new UpstreamError(`our-free-model: unexpected non-SSE response: ${text.slice(0, 200)}`, CODE.server, { status: response.status })
  }
  let payload
  try { payload = JSON.parse(text) } catch {
    throw new UpstreamError(`our-free-model: unexpected non-SSE response: ${text.slice(0, 200)}`, CODE.server, { status: response.status })
  }
  if (payload.error) throw classifyFailure(response.status, payload, setRetry)
  onData(JSON.stringify(payload))
  return { status: response.status, headers: response.headers }
}

/**
 * Split an SSE byte stream into `data:` payload strings; comment lines ignored.
 *
 * The source is anything that yields byte chunks: a `ReadableStream` (Node's own
 * response body) or an async iterable, which is what lets a head that was already
 * sniffed be replayed in front of the live reader.
 */
export async function readSse(source, onData, signal, timeoutMs = 300000) {
  const reader = typeof source?.getReader === 'function' ? source.getReader() : null
  const iterator = reader === null ? (typeof source?.[Symbol.asyncIterator] === 'function' ? source[Symbol.asyncIterator]() : source) : null
  const decoder = new TextDecoder()
  let buffer = ''
  let data = []
  let rawJson = ''
  let deadline = Date.now() + timeoutMs
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    try {
      const pending = reader !== null ? reader.cancel() : iterator?.cancel?.()
      void Promise.resolve(pending).catch(() => {})
      if (reader === null) void Promise.resolve(iterator?.return?.()).catch(() => {})
    } catch { /* already closed */ }
  }
  // Cancelling a reader is best effort: undici can leave an already pending
  // `next()` unresolved until the peer closes. Race that read with the caller's
  // abort so a held response cannot keep the adapter waiting.
  const next = async () => {
    if (signal?.aborted) throw new UpstreamError('request aborted', CODE.aborted)
    let onAbort, timer
    const halted = new Promise((_, reject) => {
      onAbort = () => {
        stop()
        reject(new UpstreamError('request aborted', CODE.aborted))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(() => {
        stop()
        reject(new UpstreamError('our-free-model: upstream stream idle past its deadline', CODE.timeout))
      }, Math.max(0, deadline - Date.now()))
    })
    const pending = Promise.resolve().then(() => reader !== null ? reader.read() : iterator.next())
    try {
      return await Promise.race([pending, halted])
    } finally {
      signal?.removeEventListener('abort', onAbort)
      clearTimeout(timer)
      // The losing read settles after the source is cancelled; do not let its
      // rejection become an unhandled promise after the caller has returned.
      pending.catch(() => {})
    }
  }
  const dispatch = () => {
    const payload = data.join('\n')
    data = []
    if (payload.trim() === '[DONE]') return true
    if (payload !== '') onData(payload)
    return false
  }
  const completeData = () => {
    if (!data.length) return false
    if (data.join('\n').trim() === '[DONE]') return true
    try { JSON.parse(data.join('\n')); return true } catch { return false }
  }
  const line = value => {
    const text = value.replace(/\r$/, '').replace(/^\uFEFF/, '')
    if (rawJson || text.trimStart().startsWith('{')) {
      if (!rawJson && dispatch()) return true
      rawJson += (rawJson ? '\n' : '') + text
      let payload
      try { payload = JSON.parse(rawJson) } catch { return false }
      rawJson = ''
      if (payload?.error || payload?.type === 'error') throw classifyFailure(undefined, payload)
      onData(JSON.stringify(payload))
      return false
    }
    if (text === '') return dispatch()
    if (text.startsWith(':')) return false
    const colon = text.indexOf(':')
    const field = colon < 0 ? text : text.slice(0, colon)
    const valueText = colon < 0 ? '' : text.slice(colon + 1).replace(/^ /, '')
    if (field === 'data') {
      // Compatible endpoints may omit blank separators between complete JSON events.
      if (completeData() && dispatch()) return true
      if (valueText.trim() === '[DONE]') { dispatch(); return true }
      data.push(valueText)
    }
    return false
  }
  try {
    while (true) {
      const { value, done } = await next()
      if (done) break
      if (Date.now() > deadline) throw new UpstreamError('our-free-model: upstream stream idle past its deadline', CODE.timeout)
      if (value !== undefined) buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const row = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line(row)) return
        newline = buffer.indexOf('\n')
      }
      deadline = Date.now() + timeoutMs
    }
    // Flush the decoder so a multi-byte character split over the last two chunks
    // is not silently dropped from the final payload.
    buffer += decoder.decode()
    if (buffer && line(buffer)) return
    if (rawJson) throw new UpstreamError('upstream returned an incomplete JSON document inside its event stream', CODE.transport)
    dispatch()
  } catch (error) {
    throw classifyStreamFailure(error, signal)
  } finally {
    stop()
    if (reader !== null) {
      try { reader.releaseLock?.() } catch { /* pending read is still unwinding */ }
    }
  }
}

/** Fetch a small JSON document from the gateway with the fingerprint headers. */
export async function getJson(path, { session, attributionUserAgent, signal, timeoutMs = 15000 } = {}) {
  const headers = gatewayHeaders({ session: truncateSession(session ?? ''), stream: false, accept: 'application/json' })
  headers['user-agent'] = userAgentWith(attributionUserAgent)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  // Which of the two aborted decides the code: this call's own deadline is a
  // retryable timeout, the caller ending the request is not a failure at all.
  let callerAborted = false
  const onCallerAbort = () => { callerAborted = true; controller.abort() }
  signal?.addEventListener('abort', onCallerAbort, { once: true })
  try {
    const response = await egressFetch(`${UPSTREAM_BASE}${path}`, { headers, redirect: 'error', signal: controller.signal })
    const text = await response.text()
    let payload
    try { payload = JSON.parse(text) } catch { payload = { error: { message: text.slice(0, 200) } } }
    if (!response.ok) throw classifyFailure(response.status, payload)
    return payload
  } catch (error) {
    if (error instanceof UpstreamError) throw error
    if (callerAborted || signal?.aborted === true) throw new UpstreamError('request aborted', CODE.aborted)
    if (error?.name === 'AbortError') throw new UpstreamError('our-free-model: upstream GET timed out', CODE.timeout)
    throw new UpstreamError(`our-free-model: upstream GET failed: ${error?.message ?? error}${transportCause(error)}`, CODE.transport)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', onCallerAbort)
  }
}
