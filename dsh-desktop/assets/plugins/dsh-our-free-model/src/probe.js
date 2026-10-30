/**
 * Availability probing.
 *
 * The gateway does not disclose which models this egress may use: the model
 * listing is a flat id list, and exclusion only appears when a request is
 * refused with a `RegionError`. Availability is therefore established by asking,
 * with the smallest request that can produce a verdict.
 *
 * Egress is watched alongside it because the answer is a property of the
 * network path, not of the account: turning a VPN on changes which models exist
 * for the user, and the picker has to follow without a restart. The cheapest
 * reliable signal is the public address the gateway itself sees.
 *
 * @module src/probe.js
 */

import { applyFingerprint, endpointFor, sessionForConversation, wireFor } from './upstream.js'
import { CODE, postStreamed } from './http.js'
import { egressFetch } from './egress.js'

/** Public-echo sources, tried in order; any one answering is enough. */
const ECHO_SOURCES = [
  { url: 'https://api.ipify.org?format=json', pick: payload => payload?.ip },
  { url: 'https://ipinfo.io/json', pick: payload => payload?.ip, extra: payload => payload?.country },
  { url: 'https://ipapi.co/json/', pick: payload => payload?.ip, extra: payload => payload?.country_code },
]

/** Verdicts the probe can return, and how each maps to picker membership. */
export const STATE = {
  available: 'available',
  regionBlocked: 'region-blocked',
  unavailable: 'unavailable',
  throttled: 'throttled',
  unknown: 'unknown',
}

const PING_PROMPT = 'ping'

/**
 * Ask the gateway for one model, once.
 *
 * @param {object} model - catalog entry
 * @param {object} options
 * @param {string} [options.attributionUserAgent]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{state:string, detail?:string, latencyMs:number, ttftMs?:number}>}
 */
export async function probeModel(model, { attributionUserAgent, signal, timeoutMs = 45000 } = {}) {
  const started = Date.now()
  const session = sessionForConversation('probe:our-free-model')
  const wire = wireFor(model.id)
  const body = buildPing(model.id, wire)
  // 三条线各有自己的工具形状：Responses 是扁平项，Messages 是 Claude 的
  // `input_schema`，Chat 是 `{function:{…}}`。传错形状会让注入的指纹工具不合规。
  applyFingerprint(body, wire === 'responses' ? true : wire === 'messages' ? 'claude' : false)

  let firstDelta
  let streamError
  try {
    await postStreamed({
      path: endpointFor(model.id),
      body,
      session,
      attributionUserAgent,
      signal,
      timeoutMs,
      onData: payload => {
        // The lane answers some refusals inside a 200 stream — a `{"type":
        // "error"}` or `{"error": …}` frame arrives where the deltas were
        // expected (src/stream.js classifies the same frames for real turns).
        // Reading only "did a delta look like a delta" called such a stream
        // available, and a model that fails every honest turn sat in the picker
        // with a green badge.
        if (streamError === undefined && /"(?:type"\s*:\s*"error"|"error"\s*:)/.test(payload)) {
          try {
            const parsed = JSON.parse(payload)
            const failure = parsed?.error ?? (parsed?.type === 'error' ? parsed : undefined)
            if (failure !== undefined && failure !== null) {
              streamError = typeof failure.message === 'string' ? failure.message : 'upstream error'
              return
            }
          } catch { /* not JSON the lane emits; the delta regex below still runs */ }
        }
        if (firstDelta !== undefined) return
        if (/"(delta|content|text|output_item)"|response\.(output_item|output_text|function_call)/.test(payload)) firstDelta = Date.now()
      },
    })
    if (streamError !== undefined) {
      return { state: STATE.unknown, detail: streamError.slice(0, 200), latencyMs: Date.now() - started }
    }
    return { state: STATE.available, latencyMs: Date.now() - started, ttftMs: firstDelta === undefined ? undefined : firstDelta - started }
  } catch (error) {
    return {
      state: stateOf(error),
      detail: typeof error?.message === 'string' ? error.message.slice(0, 200) : String(error),
      latencyMs: Date.now() - started,
    }
  }
}

function buildPing(modelId, wire) {
  if (wire === 'responses') {
    return {
      model: modelId,
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: PING_PROMPT }] }],
      stream: true,
      store: false,
      max_output_tokens: 16,
    }
  }
  if (wire === 'messages') {
    return {
      model: modelId,
      messages: [{ role: 'user', content: PING_PROMPT }],
      stream: true,
      max_tokens: 16,
    }
  }
  return { model: modelId, messages: [{ role: 'user', content: PING_PROMPT }], stream: true, max_tokens: 16 }
}

/**
 * Map one probe failure onto a verdict.
 *
 * The line that matters is whether the gateway *named this model as something it
 * will not route*. Only those readings come from the answer itself: a refusal
 * whose message is about the model (`Model is unavailable`, `not supported`,
 * `no such model`), or a status whose whole meaning is the identifier in the body
 * we sent — 400 for a model it rejects, 404 for one it no longer has, 422 for a
 * route that refuses the pair. Those read as unavailable and the picker drops the
 * model.
 *
 * Everything else says nothing about the model and must not move it:
 * - 5xx, including 503, is the gateway's own trouble. It is the single most
 *   common thing an overloaded pooled account says, and this lane's own history
 *   has it returning 5xx for reasons that had nothing to do with the model
 *   (`src/effort.js` records an upstream 503 from an unknown request field).
 *   Its *words* must not be read as a verdict either: a reverse proxy answers a
 *   503 with the reason phrase "Service Unavailable", and matching that text
 *   took a working model out of the picker.
 * - 401/403/407 is the pooled credential, and 408/425/429 is capacity or
 *   transport — the next window can answer.
 * - no status at all (transport, abort, timeout, a stream that died before any
 *   header) means no answer was received.
 *
 * The asymmetry is deliberate: a stale entry in the picker costs the user one
 * failed turn they can retry, while a model that vanished on a hiccup costs the
 * `reprobe`-then-wait cycle the user has no visibility into.
 */
const ROUTING_REFUSAL_STATUS = new Set([400, 404, 422])

function stateOf(error) {
  switch (error?.code) {
    case CODE.region: return STATE.regionBlocked
    case CODE.quota: return STATE.throttled
    // The free lane's client gate (issue #310) refuses the lane, not the model
    // — but unlike a 5xx it does not clear on its own, so a model that can
    // only fail reads with the same verdict the picker already treats as "the
    // gateway will not route this". The whole-round guard in `computeMembership`
    // still keeps every model visible when the lock takes the entire lane, and
    // the settings page carries the upstream's own words as the reason.
    case CODE.laneLocked: return STATE.unavailable
    default: break
  }
  const message = String(error?.message ?? '')
  // The message match is a fallback for a refusal the classifier did not name
  // ("no such model", "unknown model"), so it may only speak when the status did
  // not already answer on the gateway's behalf: 503 is spelled "Service
  // Unavailable" by every reverse proxy, and reading that reason phrase as the
  // gateway naming this model dropped a working model until the next round.
  const gatewayTrouble = Number.isInteger(error?.status) && error.status >= 500
  const named = error?.unavailable === true
    || (!gatewayTrouble && /unavailable|not supported|no such model|unknown model|invalid model/i.test(message))
  if (named) return STATE.unavailable
  if (Number.isInteger(error?.status) && ROUTING_REFUSAL_STATUS.has(error.status)) return STATE.unavailable
  return STATE.unknown
}

/**
 * Resolve the public address the gateway will see, plus its country when an echo
 * discloses one. Fail-open: an absent answer simply means "no egress signal".
 */
export async function detectEgress({ signal, timeoutMs = 8000 } = {}) {
  for (const source of ECHO_SOURCES) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    timer.unref?.()
    const relayAbort = () => controller.abort()
    signal?.addEventListener('abort', relayAbort, { once: true })
    try {
      const response = await egressFetch(source.url, { signal: controller.signal, redirect: 'error', headers: { accept: 'application/json' } })
      if (!response.ok) continue
      const payload = await response.json()
      const ip = source.pick(payload)
      if (typeof ip !== 'string' || ip === '') continue
      const country = source.extra?.(payload)
      return { ip, ...country === undefined ? {} : { country: String(country) } }
    } catch {
      // try the next echo
    } finally {
      // The deadline has to outlive the response head: response.json() is where
      // a slow echo used to stall past the 8s budget and freeze the probe loop.
      // And the caller's signal only borrowed this listener for this attempt.
      clearTimeout(timer)
      signal?.removeEventListener('abort', relayAbort)
    }
  }
  return undefined
}

/**
 * Probe a whole catalog with a bounded fan-out.
 *
 * Concurrency stays low on purpose: this lane accounts quota per session and
 * answers 429 with growing retry-after, so a wide burst would throttle the very
 * user whose availability we are establishing. A round probes every model —
 * partial rounds leave verdicts stale and the picker half-explained — and the
 * periodic loop holds *whole rounds* off while a quota backoff window is open
 * (the caller's concern, see index.js) instead of truncating this one.
 */
export async function probeCatalog(models, options = {}, onResult = () => {}, concurrency = 2) {
  const results = {}
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, models.length)) }, async () => {
    while (cursor < models.length) {
      const index = cursor++
      const model = models[index]
      const result = await probeModel(model, options)
      results[model.id] = result
      onResult(model.id, result)
    }
  })
  await Promise.all(workers)
  return results
}
