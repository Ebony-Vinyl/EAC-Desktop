/**
 * Outbound wire for the co-paid lane.
 *
 * Two lane modes, decided by the credential the sealed store hands over:
 *
 * - `direct` — one bearer credential, straight to the relay.
 * - `worker` — a signing gateway in front of the relay carries the real
 *   credential in its own environment; requests here carry no secret at all,
 *   only an HMAC-SHA256 signature over `timestamp \n METHOD \n path \n
 *   sha256(body)` under the seal's shared signing secret, plus the timestamp
 *   for the gateway's replay window. A seal extracted from this package is
 *   therefore an indirect entry the gateway can revoke (rotate its accepted
 *   secrets), not the credential itself.
 *
 * The credential material arrives per call from `src/vault.js` and lives only
 * inside the call frame that builds the headers; nothing here logs it, caches
 * it, or names it in an error. Every failure is classified into the same
 * harness-neutral codes the free lane uses, with the endpoint and every secret
 * absent from every message.
 *
 * @module src/eac.js
 */

import crypto from 'node:crypto'
import https from 'node:https'
import http from 'node:http'
import { Readable } from 'node:stream'
// Web-stream adapter: http.js's readHead/readSse speak getReader(), so the
// node:http response is converted into a proper WHATWG ReadableStream.
import { ReadableStream } from 'node:stream/web'
import { CODE, UpstreamError, classifyFailure, classifyStreamFailure, readHead, readSse, replayStream, sniffBody, transportCause } from './http.js'
import { readEacUser } from './eac-user.js'

const LISTING_TIMEOUT_MS = 15000
const TURN_TIMEOUT_MS = 300000

/**
 * Test seam: the offline suite drives this lane through a fetch-shaped stub
 * (it must not reach the network). Production code never touches it — the
 * whole point of laneFetch is that nothing else in the process can intercept
 * the signed bytes. Assignment is module-private by convention, exactly like
 * the free lane's upstream override.
 */
export const lane = { fetch: null }

/**
 * Test seam for the per-user authorization token (src/eac-user.js), same
 * convention as `lane`: `undefined` reads the file, any other value —
 * `null` included — is used as-is, so the offline suite never touches a home.
 */
export const laneUser = { token: undefined }

/** The GitHub authorization this install holds, or null. Never logged. */
function laneUserToken() {
  if (laneUser.token !== undefined) return laneUser.token
  try { return readEacUser()?.token ?? null } catch { return null }
}

/**
 * The lane's module-private transport, shared with the pool proxy: plugin
 * backend outbound calls must not ride the swappable global fetch (#50 class
 * of interference — the signed lane already learned this the hard way), and
 * the sealed gateway URL should only ever travel over this module's bytes.
 */
export { laneFetch as directFetch }

/**
 * The lane's own poster over `node:http`/`node:https`, not the global fetch.
 * The signature covers sha256(body), so the body must reach the gateway
 * byte-for-byte as signed. Local proxy plugins (billion-context et al.) work
 * by replacing `globalThis.fetch` and re-serializing the request body on the
 * way out; a re-serialized body breaks the HMAC even though the credential is
 * perfectly valid, and the gateway answers `request signature rejected`
 * (issue #50). The core `node:https` module cannot be swapped by another
 * plugin, so the signed bytes leave this process untouched.
 *
 * Returns a Response-shaped object ({ ok, status, headers: { get }, body,
 * text() }) — just the surface the posters below consume, so the rest of the
 * lane keeps reading like the free lane's fetch-based flow. The body is a
 * WHATWG ReadableStream over the response chunks (via Readable.toWeb), which
 * is what http.js's readHead/readSse consume; nothing is buffered before the
 * sniff window, so first tokens still flow out unheld.
 */
function laneFetch(url, { method = 'GET', headers = {}, body = undefined, signal } = {}) {
  if (signal?.aborted === true) return Promise.reject(new UpstreamError('request aborted', CODE.aborted))
  if (typeof lane.fetch === 'function') return lane.fetch(url, { method, headers, body, signal })
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const transport = target.protocol === 'http:' ? http : https
    const request = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'http:' ? 80 : 443),
      path: target.pathname + target.search,
      method,
      headers: body !== undefined ? { ...headers, 'content-length': Buffer.byteLength(body, 'utf8') } : headers,
    }, response => {
      resolve({
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode,
        headers: { get: name => response.headers[String(name).toLowerCase()] ?? null },
        body: Readable.toWeb(response),
        async text() {
          const chunks = []
          for await (const chunk of response) chunks.push(Buffer.from(chunk))
          return Buffer.concat(chunks).toString('utf8')
        },
        // Response-shaped means Response-complete: the pool proxy is the first
        // caller that reads JSON off this shim, and a missing method here
        // surfaces as an opaque 'unreachable' three layers up.
        async json() { return JSON.parse(await this.text()) },
      })
    })
    request.on('error', reject)
    const abort = () => request.destroy(new Error('The operation was aborted'))
    signal?.addEventListener('abort', abort, { once: true })
    request.on('close', () => signal?.removeEventListener?.('abort', abort))
    if (body !== undefined) request.write(body, 'utf8')
    request.end()
  })
}

/**
 * The signing headers for one gateway request. Exported for the offline suite,
 * which pins the exact wire format the gateway validates.
 *
 * @param {string} signingSecret - shared HMAC key from the seal
 * @param {{ method: string, path: string, body?: string }} parts - uppercase method, URL pathname, raw body ('' when none)
 * @param {number} [now] - wall clock, injectable for tests
 * @returns {{ 'x-ofm-timestamp': string, 'x-ofm-signature': string }}
 */
export function signSealedRequest(signingSecret, { method, path, body = '' }, now = Date.now()) {
  const timestamp = String(Math.trunc(now))
  const bodyHash = crypto.createHash('sha256').update(body, 'utf8').digest('hex')
  const mac = crypto.createHmac('sha256', signingSecret)
    .update(`${timestamp}\n${method.toUpperCase()}\n${path}\n${bodyHash}`, 'utf8')
    .digest('hex')
  return { 'x-ofm-timestamp': timestamp, 'x-ofm-signature': mac }
}

/** Wire headers for one request, per lane mode. The signed path is the full
 * URL pathname — exactly what the gateway recomputes from its own request. */
function headersFor(credential, method, fullUrl, body) {
  const headers = {
    'content-type': 'application/json',
    'accept': method === 'POST' ? 'text/event-stream' : 'application/json',
    'user-agent': 'dsh-our-free-model',
  }
  if (credential.mode === 'worker') {
    const path = new URL(fullUrl).pathname
    const signed = { ...headers, ...signSealedRequest(credential.signingSecret, { method, path, body }) }
    // The per-user authorization the gateway's GitHub gate demands on turns.
    // Absent before login; the gateway then answers 401 AuthorizationRequired,
    // which the settings page turns into a login prompt. Sent on listings too
    // so a gated listing needs no second wire shape.
    // 显式传入 null 也必须隔离：独立应用未登录时不能回退读取 DSH 授权。
    const userToken = Object.hasOwn(credential, 'userToken') ? credential.userToken : laneUserToken()
    return userToken === null ? signed : { ...signed, 'x-ofm-user': userToken }
  }
  return { ...headers, 'authorization': `Bearer ${credential.apiKey}` }
}

/** A proxy in front of the relay answers hard failures with a whole HTML error
 * page — Cloudflare's 524 origin-timeout page being the common one. Pasting it
 * into the harness buries the one useful fact (the status) under markup, so an
 * unparseable body that is HTML reduces to one readable line. */
function errorPageMessage(text, status) {
  const head = String(text ?? '')
  if (/^\s*<(!doctype|html)/i.test(head)) return `the gateway's front proxy answered HTTP ${status} with an HTML error page`
  return head.slice(0, 300) || `HTTP ${status}`
}

/** One listing round: `GET {base}/models`. Returns the parsed JSON document. */
export async function fetchSealedListing(credential, { signal, timeoutMs = LISTING_TIMEOUT_MS } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  let callerAborted = false
  const onCallerAbort = () => { callerAborted = true; controller.abort() }
  signal?.addEventListener('abort', onCallerAbort, { once: true })
  const listingUrl = `${credential.base}/models`
  try {
    const response = await laneFetch(listingUrl, { headers: headersFor(credential, 'GET', listingUrl, ''), redirect: 'error', signal: controller.signal })
    const text = await response.text()
    let payload
    try { payload = JSON.parse(text) } catch { payload = { error: { message: errorPageMessage(text, response.status) } } }
    if (!response.ok) throw classifyFailure(response.status, payload)
    return payload
  } catch (error) {
    if (error instanceof UpstreamError) throw error
    if (callerAborted || signal?.aborted === true) throw new UpstreamError('request aborted', CODE.aborted)
    if (error?.name === 'AbortError') throw new UpstreamError('model listing timed out', CODE.timeout)
    throw new UpstreamError(`model listing failed: ${error?.message ?? error}${transportCause(error)}`, CODE.transport)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', onCallerAbort)
  }
}

/**
 * POST one turn and stream back decoded SSE `data:` payloads.
 *
 * Mirrors the free lane's poster byte-for byte in discipline — body-shape sniff
 * before believing the Content-Type, head replay so no token is buffered — and
 * drops everything the free lane needs that this relay does not: session
 * fingerprints, request ids, the pooled-credential UA.
 */
export async function postSealedStreamed({ credential, body, signal, onData, timeoutMs = TURN_TIMEOUT_MS }) {
  const bodyText = JSON.stringify(body)
  const turnUrl = `${credential.base}/chat/completions`
  let response
  try {
    response = await laneFetch(turnUrl, {
      method: 'POST',
      headers: headersFor(credential, 'POST', turnUrl, bodyText),
      body: bodyText,
      redirect: 'error',
      signal,
    })
  } catch (error) {
    if (signal?.aborted === true || error?.name === 'AbortError') throw new UpstreamError('request aborted', CODE.aborted)
    throw new UpstreamError(`model request failed: ${error?.message ?? error}${transportCause(error)}`, CODE.transport)
  }

  // `Retry-After` is seconds on the wire and milliseconds in the classified
  // failure — the free lane's poster converts before classifying, so does this.
  const retrySeconds = Number(response.headers.get('retry-after'))
  const setRetry = Number.isFinite(retrySeconds) && retrySeconds > 0 ? Math.trunc(retrySeconds * 1000) : undefined
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let payload
    try { payload = JSON.parse(text) } catch { payload = { error: { message: errorPageMessage(text, response.status) } } }
    throw classifyFailure(response.status, payload, setRetry)
  }
  if (response.body === null) throw new UpstreamError('model stream returned no body', CODE.empty)

  const head = await readHead(response.body, 4096, { signal, timeoutMs })
  const shape = sniffBody(head.text)
  if (shape === 'empty') throw new UpstreamError('model stream returned no body', CODE.empty)
  if (shape === 'sse') {
    await readSse(replayStream(head), onData, signal, timeoutMs)
    return { status: response.status }
  }

  // A relay that answered a stream request with one JSON document: fold the
  // whole answer into a single payload for the reader, as the free lane does.
  let text = head.text
  if (!head.done) {
    try {
      while (true) {
        const row = await head.reader.read()
        if (row.done) break
        if (row.value !== undefined) text += head.decoder.decode(row.value, { stream: true })
      }
    } catch (error) {
      await head.reader.cancel().catch(() => {})
      throw classifyStreamFailure(error, signal)
    }
  }
  text += head.decoder.decode()
  let payload
  try { payload = JSON.parse(text) } catch {
    // A 200 whose body is not JSON is a hop speaking for the relay. Markup
    // means a front proxy swallowed the stream (a WAF buffer overflow, a CDN
    // error page — issue #63): the same oversized body would draw the same
    // page again, so this must not land in retryable SERVER. Anything else
    // keeps the retryable server verdict.
    if (/^\s*<(!doctype|html[\s>])/i.test(text)) {
      throw new UpstreamError(errorPageMessage(text, response.status), CODE.client, { status: response.status })
    }
    throw new UpstreamError(`unexpected non-stream response: ${text.slice(0, 200)}`, CODE.server, { status: response.status })
  }
  if (payload.error) throw classifyFailure(response.status, payload)
  onData(JSON.stringify(payload))
  return { status: response.status }
}
