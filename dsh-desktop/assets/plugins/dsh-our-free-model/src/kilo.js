/**
 * Outbound wire for the Kilo channel.
 *
 * Kilo AI (https://kilo.ai) publishes an OpenAI-compatible gateway whose free
 * pool answers with no credential at all — no key, no login, no fingerprint
 * gate. That makes this the simplest lane in the plugin: a fixed base URL, a
 * plain POST per turn, and the free lane's own streaming discipline. The trade
 * is stated on the gateway's own model cards and belongs in front of the user:
 * free-pool prompts may be logged by the upstream provider and used to improve
 * its services (the README carries the same warning), so this lane is for
 * throwaway work, not secrets.
 *
 * The roster is the listing's `isFree: true` slice; everything else on this
 * gateway is a paid id that would answer 401 here. Failures classify through
 * the same harness-neutral codes as the other lanes, with the endpoint absent
 * from every message — there is no secret on this lane, but one vocabulary
 * keeps the adapter's handling uniform.
 *
 * @module src/kilo.js
 */

import { CODE, UpstreamError, classifyFailure, classifyStreamFailure, readHead, readSse, replayStream, sniffBody, transportCause } from './http.js'
import { egressFetch } from './egress.js'

const LISTING_TIMEOUT_MS = 15000
const TURN_TIMEOUT_MS = 300000

/** Overridable for the offline suite and the live probes, like the free lane's base. */
export const KILO_BASE = (process.env.OUR_FREE_MODEL_KILO_BASE ?? 'https://api.kilo.ai/api/gateway').replace(/\/+$/, '')

/**
 * The lane's transport is `egressFetch`, exactly like the free lane's: an
 * outlet the user configured carries this traffic too, and a composition whose
 * global fetch is wrapped does not take this lane down with it.
 */
function kiloFetch(url, init) {
  return egressFetch(url, init)
}

/** One listing round: `GET {base}/models`. Returns the parsed JSON document. */
export async function fetchKiloListing({ signal, timeoutMs = LISTING_TIMEOUT_MS } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  let callerAborted = false
  const onCallerAbort = () => { callerAborted = true; controller.abort() }
  signal?.addEventListener('abort', onCallerAbort, { once: true })
  try {
    const response = await kiloFetch(`${KILO_BASE}/models`, {
      headers: { accept: 'application/json', 'user-agent': 'dsh-our-free-model' },
      redirect: 'error',
      signal: controller.signal,
    })
    const text = await response.text()
    let payload
    try { payload = JSON.parse(text) } catch { payload = { error: { message: text.slice(0, 300) || `HTTP ${response.status}` } } }
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
 * Mirrors the other lanes' posters byte-for-byte in discipline — the body shape
 * is sniffed before the Content-Type is believed, the head bytes are replayed so
 * no token is buffered, and an idle stream dies at `timeoutMs` (every chunk
 * resets it; the gateway also sends `: KILO PROCESSING` comment lines while the
 * model is being scheduled, which the SSE reader skips and which keep the idle
 * cutoff honest without tripping it).
 */
export async function postKiloStreamed({ body, signal, onData, timeoutMs = TURN_TIMEOUT_MS }) {
  const bodyText = JSON.stringify(body)
  let response
  try {
    response = await kiloFetch(`${KILO_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', 'user-agent': 'dsh-our-free-model' },
      body: bodyText,
      redirect: 'error',
      signal,
    })
  } catch (error) {
    if (signal?.aborted === true || error?.name === 'AbortError') throw new UpstreamError('request aborted', CODE.aborted)
    throw new UpstreamError(`model request failed: ${error?.message ?? error}${transportCause(error)}`, CODE.transport)
  }

  // `Retry-After` is seconds on the wire and milliseconds in the classified
  // failure — the other lanes' posters convert before classifying, so does this.
  const retrySeconds = Number(response.headers.get('retry-after'))
  const setRetry = Number.isFinite(retrySeconds) && retrySeconds > 0 ? Math.trunc(retrySeconds * 1000) : undefined
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw classifyKilo(response.status, text, setRetry)
  }
  if (response.body === null) throw new UpstreamError('model stream returned no body', CODE.empty)

  const head = await readHead(response.body, 4096, { signal, timeoutMs })
  const shape = sniffBody(head.text)
  if (shape === 'empty') throw new UpstreamError('model stream returned no body', CODE.empty)
  if (shape === 'sse') {
    await readSse(replayStream(head), onData, signal, timeoutMs)
    return { status: response.status }
  }

  // A gateway that answered a stream request with one JSON document: fold the
  // whole answer into a single payload for the reader, as the other lanes do.
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
    throw new UpstreamError(`unexpected non-stream response: ${text.slice(0, 200)}`, CODE.server, { status: response.status })
  }
  if (payload.error) throw classifyKilo(response.status, text, setRetry)
  onData(JSON.stringify(payload))
  return { status: response.status }
}

/**
 * Classify one of this gateway's refusals.
 *
 * The envelope names its class twice — `error.code` inside the error object and
 * `error_type` beside it — while the shared classifier reads `error.type`, so the
 * envelope is reshaped onto that vocabulary first. Two of this lane's own codes
 * deserve better than a bare status: a paid id requested keyless is the caller
 * picking a model this lane does not serve (a request defect, not a broken
 * credential store), and an explicit moderation block is the upstream's answer,
 * not a transport fault.
 */
function classifyKilo(status, text, retryAfterMs) {
  let payload
  try { payload = JSON.parse(text) } catch { payload = { error: { message: text.slice(0, 300) || `HTTP ${status}` } } }
  const type = payload?.error_type ?? payload?.error?.code ?? payload?.error?.type
  const shaped = {
    error: {
      ...payload?.error,
      ...(type === undefined ? {} : { type: String(type) }),
    },
  }
  if (typeof type === 'string' && /PAID_MODEL_AUTH_REQUIRED/i.test(type)) {
    return new UpstreamError('this model is not on the free pool: it needs a Kilo account, so it is not served by this channel', CODE.client, { status })
  }
  const failure = classifyFailure(status, shaped, retryAfterMs)
  if (typeof failure.message === 'string' && /moderation|flagged|filtered/i.test(failure.message)) {
    return new UpstreamError(failure.message, CODE.client, { status })
  }
  return failure
}
