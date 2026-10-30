/**
 * One failure vocabulary for every lane the router can walk.
 *
 * A failed turn has to answer two different questions, and neither source this
 * module ports from answers both:
 *
 * - *What went wrong?* — so the caller can choose between replaying, rotating to
 *   the next candidate, or telling the user something they can act on. The FCC
 *   `failure_policy` owns this vocabulary: `FailureKind` plus a `retryable`
 *   flag, derived from the HTTP status and from structured markers in the body.
 * - *Should the account that answered be benched, and for how long?* — so one
 *   bad credential cannot eat every later request. 9router's `ERROR_RULES`
 *   owns this: a small ordered policy table whose text rules win over its status
 *   rules, with exponential backoff for rate-limit wording and a 30 s default
 *   for everything unmatched.
 *
 * This module merges them with one authority each: the fired rule decides the
 * cooldown (`cooldownMs`/`cooldownLevel` — the legacy names, kept so a caller
 * ported from 9router needs no translation), while `kind`/`retryable`/`scope`
 * describe the failure itself. Where the two sources disagree the rule table
 * wins on duration and FCC wins on meaning, because a cooldown is an
 * operational policy (how long to leave a connection out of rotation) and a
 * kind is a fact about the failure. The concrete disagreements and their
 * resolution are recorded next to each rule below.
 *
 * `scope` is the router-facing summary of *where* the fault lives:
 *
 * - `request`   — replaying the same body reproduces the refusal; do not bench
 *                 anything. An unmatched 4xx lands here (9router's explicit
 *                 carve-out, and the reason it exists: cooling a healthy
 *                 account for a bad parameter hides the real cause and makes
 *                 every later request in the window fail with a copy of it).
 * - `account`   — this credential/connection is at fault; bench it and rotate.
 * - `provider`  — the endpoint or the model on it is at fault, not the request.
 * - `transient` — a short-lived upstream wobble; retry soon.
 *
 * Pure by construction: no timers, no I/O, no clock, no randomness. The only
 * time-shaped input a caller may supply is a provider-reported reset duration
 * (`retryAfterMs`), which is clamped here to 30 minutes — providers do report
 * multi-hour resets and honouring one would silently empty a chain.
 *
 * @module src/route/classify.js
 */

/** Failure categories shared by the router, the recovery assessment and logs. */
export const FAILURE_KIND = Object.freeze({
  INVALID_REQUEST: 'invalid_request',
  CONTEXT_WINDOW: 'context_window',
  AUTH: 'auth',
  PERMISSION: 'permission',
  BILLING: 'billing',
  RATE_LIMIT: 'rate_limit',
  OVERLOADED: 'overloaded',
  TIMEOUT: 'timeout',
  UPSTREAM: 'upstream',
  UNAVAILABLE: 'unavailable',
  ABORTED: 'aborted',
  UNKNOWN: 'unknown',
})

/** Where the fault lives; see the module docblock for the meaning of each. */
export const FAILURE_SCOPE = Object.freeze({
  REQUEST: 'request',
  ACCOUNT: 'account',
  PROVIDER: 'provider',
  TRANSIENT: 'transient',
})

/** Long cooldown: a credential-level refusal that will not clear on its own. */
export const COOLDOWN_LONG_MS = 2 * 60 * 1000
/**
 * Short cooldown: a refusal the upstream source expects to clear by itself
 * (a token refresh, a routing decision), so the account is benched just long
 * enough for the next request to land on a different one.
 */
export const COOLDOWN_SHORT_MS = 5 * 1000
/** Default cooldown for any unmatched error: 9router's TRANSIENT_COOLDOWN_MS. */
export const TRANSIENT_COOLDOWN_MS = 30 * 1000
/** Hard cap for a provider-reported reset (e.g. codex `resets_at` can be hours). */
export const MAX_PROVIDER_COOLDOWN_MS = 30 * 60 * 1000
/** Exponential backoff for rate limits: 2000 * 2^(level-1). */
export const BACKOFF_BASE_MS = 2000
/** Backoff ceiling: 5 minutes, reached at level 9 and held through level 15. */
export const BACKOFF_MAX_MS = 300 * 1000
/** Backoff level ceiling; level > 15 clamps so the level can never run away. */
export const BACKOFF_MAX_LEVEL = 15

/**
 * Cooldown for one backoff level, in milliseconds.
 *
 * Ported from 9router's `getQuotaCooldown`, including its `Math.max(0, level-1)`
 * guard: level 0 and level 1 both yield the 2 s base. The guard matters because
 * a fresh account carries level 0 and the first rate-limit hit must not produce
 * a sub-second cooldown that immediately re-enters rotation. Levels above
 * `BACKOFF_MAX_LEVEL` clamp to it, and the millisecond value is capped at
 * `BACKOFF_MAX_MS` independently of the level.
 *
 * @param {number} level - backoff level (1 is the first hit)
 * @returns {number} cooldown in milliseconds
 */
export function backoffFor(level) {
  const numeric = typeof level === 'number' && Number.isFinite(level) ? Math.floor(level) : 0
  const clamped = Math.min(Math.max(numeric, 1), BACKOFF_MAX_LEVEL)
  return Math.min(BACKOFF_BASE_MS * 2 ** (clamped - 1), BACKOFF_MAX_MS)
}

/**
 * The ported ERROR_RULES table, in evaluation order.
 *
 * Text rules come first and are matched as case-insensitive substrings, so
 * wording in the body beats the status code: a 400 whose message says "rate
 * limit" is a rate limit, and a 429 whose message says "no credentials" is a
 * credential refusal. The status rules only run when no text rule matched.
 * `kind`/`scope`/`retryable` are this module's merge of the FCC vocabulary onto
 * each rule; `cooldownMs`/`backoff` are 9router's values unchanged.
 */
const ERROR_RULES = Object.freeze([
  // The credential for this account is gone: every later request fails the same
  // way, so the whole account is benched rather than the model. FCC's
  // `invalid_api_key`/`unauthorized` codes map here too.
  Object.freeze({ text: 'no credentials', cooldownMs: COOLDOWN_LONG_MS, kind: FAILURE_KIND.AUTH, scope: FAILURE_SCOPE.ACCOUNT, retryable: false }),
  // Codex-style refusal that clears on a token refresh. 9router gives it 5 s,
  // not the 2 min of the other credential rules, precisely because waiting is
  // enough — so the cooldown (not `retryable`) is what moves the router on.
  Object.freeze({ text: 'request not allowed', cooldownMs: COOLDOWN_SHORT_MS, kind: FAILURE_KIND.PERMISSION, scope: FAILURE_SCOPE.ACCOUNT, retryable: false }),
  // The provider rejected the payload it built itself; the account's route is
  // broken, not the user's request, which is why this 400 still benches. It is
  // the one place where "improperly formed" must not be read as request-scoped.
  Object.freeze({ text: 'improperly formed request', cooldownMs: COOLDOWN_LONG_MS, kind: FAILURE_KIND.INVALID_REQUEST, scope: FAILURE_SCOPE.ACCOUNT, retryable: false }),
  Object.freeze({ text: 'rate limit', backoff: true, kind: FAILURE_KIND.RATE_LIMIT, scope: FAILURE_SCOPE.ACCOUNT, retryable: true }),
  Object.freeze({ text: 'too many requests', backoff: true, kind: FAILURE_KIND.RATE_LIMIT, scope: FAILURE_SCOPE.ACCOUNT, retryable: true }),
  Object.freeze({ text: 'quota exceeded', backoff: true, kind: FAILURE_KIND.RATE_LIMIT, scope: FAILURE_SCOPE.ACCOUNT, retryable: true }),
  // Capacity wording is provider-wide pressure, not a spent credential, so it
  // cools the provider scope. FCC folds these into OVERLOADED (retryable).
  Object.freeze({ text: 'capacity', backoff: true, kind: FAILURE_KIND.OVERLOADED, scope: FAILURE_SCOPE.PROVIDER, retryable: true }),
  Object.freeze({ text: 'overloaded', backoff: true, kind: FAILURE_KIND.OVERLOADED, scope: FAILURE_SCOPE.PROVIDER, retryable: true }),

  // Status rules: the credential/model-level statuses 9router benches for 2 min.
  // 402 is BILLING here (FCC calls it PERMISSION with a billing message, but the
  // kind list has BILLING and "add credits" is the actionable answer); 404 is
  // UNAVAILABLE because the account no longer routes that model at all.
  Object.freeze({ status: 401, cooldownMs: COOLDOWN_LONG_MS, kind: FAILURE_KIND.AUTH, scope: FAILURE_SCOPE.ACCOUNT, retryable: false }),
  Object.freeze({ status: 402, cooldownMs: COOLDOWN_LONG_MS, kind: FAILURE_KIND.BILLING, scope: FAILURE_SCOPE.ACCOUNT, retryable: false }),
  Object.freeze({ status: 403, cooldownMs: COOLDOWN_LONG_MS, kind: FAILURE_KIND.PERMISSION, scope: FAILURE_SCOPE.ACCOUNT, retryable: false }),
  Object.freeze({ status: 404, cooldownMs: COOLDOWN_LONG_MS, kind: FAILURE_KIND.UNAVAILABLE, scope: FAILURE_SCOPE.ACCOUNT, retryable: false }),
  Object.freeze({ status: 429, backoff: true, kind: FAILURE_KIND.RATE_LIMIT, scope: FAILURE_SCOPE.ACCOUNT, retryable: true }),
])

/**
 * Structured discriminators the target project's own `http.js` mints, plus the
 * provider codes FCC recognizes. A caller that already classified the failure
 * (`UpstreamError.code`) is more specific than the raw status: the project
 * separates a WAF's 403 from a credential 403 (`CLIENT_ERROR` vs
 * `INVALID_CREDENTIAL`), a region refusal from auth (`REGION_BLOCKED`), and the
 * co-paid lane's per-user gate from both (`AUTHORIZATION_REQUIRED`). Flattening
 * those back onto the status rules would re-merge exactly what http.js took
 * care to distinguish, and would bench accounts for a front-proxy refusal.
 *
 * Keys are lowercase; the code is lowercased before lookup so the project's
 * `RATE_LIMIT` and a provider's `rate_limit` land on the same row.
 */
const CODE_VERDICTS = Object.freeze({
  aborted: Object.freeze({ kind: FAILURE_KIND.ABORTED, scope: FAILURE_SCOPE.REQUEST, retryable: false, cooldownMs: 0 }),
  timeout: Object.freeze({ kind: FAILURE_KIND.TIMEOUT, scope: FAILURE_SCOPE.TRANSIENT, retryable: true, cooldownMs: TRANSIENT_COOLDOWN_MS }),
  transport: Object.freeze({ kind: FAILURE_KIND.UNAVAILABLE, scope: FAILURE_SCOPE.TRANSIENT, retryable: true, cooldownMs: TRANSIENT_COOLDOWN_MS }),
  server: Object.freeze({ kind: FAILURE_KIND.UPSTREAM, scope: FAILURE_SCOPE.TRANSIENT, retryable: true, cooldownMs: TRANSIENT_COOLDOWN_MS }),
  stream_cut: Object.freeze({ kind: FAILURE_KIND.UPSTREAM, scope: FAILURE_SCOPE.TRANSIENT, retryable: true, cooldownMs: TRANSIENT_COOLDOWN_MS }),
  empty_response: Object.freeze({ kind: FAILURE_KIND.UPSTREAM, scope: FAILURE_SCOPE.TRANSIENT, retryable: true, cooldownMs: TRANSIENT_COOLDOWN_MS }),
  client_error: Object.freeze({ kind: FAILURE_KIND.INVALID_REQUEST, scope: FAILURE_SCOPE.REQUEST, retryable: false, cooldownMs: 0 }),
  invalid_credential: Object.freeze({ kind: FAILURE_KIND.AUTH, scope: FAILURE_SCOPE.ACCOUNT, retryable: false, cooldownMs: COOLDOWN_LONG_MS }),
  invalid_api_key: Object.freeze({ kind: FAILURE_KIND.AUTH, scope: FAILURE_SCOPE.ACCOUNT, retryable: false, cooldownMs: COOLDOWN_LONG_MS }),
  unauthorized: Object.freeze({ kind: FAILURE_KIND.AUTH, scope: FAILURE_SCOPE.ACCOUNT, retryable: false, cooldownMs: COOLDOWN_LONG_MS }),
  permission_denied: Object.freeze({ kind: FAILURE_KIND.PERMISSION, scope: FAILURE_SCOPE.ACCOUNT, retryable: false, cooldownMs: COOLDOWN_LONG_MS }),
  forbidden: Object.freeze({ kind: FAILURE_KIND.PERMISSION, scope: FAILURE_SCOPE.ACCOUNT, retryable: false, cooldownMs: COOLDOWN_LONG_MS }),
  rate_limit: Object.freeze({ kind: FAILURE_KIND.RATE_LIMIT, scope: FAILURE_SCOPE.ACCOUNT, retryable: true, backoff: true }),
  // A refusal this install cannot retry away: the gate clears on a login, not
  // on another candidate, so nothing is benched and the router must not rotate.
  region_blocked: Object.freeze({ kind: FAILURE_KIND.UNAVAILABLE, scope: FAILURE_SCOPE.PROVIDER, retryable: false, cooldownMs: 0 }),
  authorization_required: Object.freeze({ kind: FAILURE_KIND.AUTH, scope: FAILURE_SCOPE.PROVIDER, retryable: false, cooldownMs: 0 }),
  lane_locked: Object.freeze({ kind: FAILURE_KIND.UNAVAILABLE, scope: FAILURE_SCOPE.PROVIDER, retryable: false, cooldownMs: 0 }),
})

/**
 * Structured context-overflow discriminators. FCC treats context exhaustion as
 * its own non-retryable kind and checks it before everything else, because the
 * provider may dress it up as a plain 400 and the caller must not shrink-wrap
 * it into INVALID_REQUEST: the fix is a smaller request or a bigger window, and
 * no retry of the same bytes can help.
 */
const CONTEXT_WINDOW_CODES = Object.freeze(['context_length_exceeded', 'model_context_window_exceeded'])
/** Prose spellings the same condition arrives under when no code is present. */
const CONTEXT_WINDOW_MARKERS = Object.freeze([
  'context_length_exceeded',
  'maximum context length',
  'context window exceeded',
  'exceeds the context window',
  'prompt is too long',
])

/**
 * FCC's marker table for bodies that carry no usable status: the same condition
 * named in the message or in a structured `type`/`code` field. Markers 9router
 * already covers as text rules (`overloaded`, `capacity`, `rate limit`, `too
 * many requests`) are deliberately absent — the rule table runs first and owns
 * their cooldowns. `limit reached` is FCC's `resource exhausted` family and
 * cools the provider; `internal server error` is a plain upstream wobble.
 */
const MARKER_RULES = Object.freeze([
  Object.freeze({ marker: 'rate_limit', backoff: true, kind: FAILURE_KIND.RATE_LIMIT, scope: FAILURE_SCOPE.ACCOUNT, retryable: true }),
  Object.freeze({ marker: 'resourceexhausted', backoff: true, kind: FAILURE_KIND.OVERLOADED, scope: FAILURE_SCOPE.PROVIDER, retryable: true }),
  Object.freeze({ marker: 'resource exhausted', backoff: true, kind: FAILURE_KIND.OVERLOADED, scope: FAILURE_SCOPE.PROVIDER, retryable: true }),
  // The Google/gRPC spelling of the same status; FCC's own marker list misses
  // the underscore form, and it is the one a structured `code` arrives under.
  Object.freeze({ marker: 'resource_exhausted', backoff: true, kind: FAILURE_KIND.OVERLOADED, scope: FAILURE_SCOPE.PROVIDER, retryable: true }),
  Object.freeze({ marker: 'limit reached', backoff: true, kind: FAILURE_KIND.OVERLOADED, scope: FAILURE_SCOPE.PROVIDER, retryable: true }),
  Object.freeze({ marker: 'internal_server_error', cooldownMs: TRANSIENT_COOLDOWN_MS, kind: FAILURE_KIND.UPSTREAM, scope: FAILURE_SCOPE.TRANSIENT, retryable: true }),
  Object.freeze({ marker: 'internal server error', cooldownMs: TRANSIENT_COOLDOWN_MS, kind: FAILURE_KIND.UPSTREAM, scope: FAILURE_SCOPE.TRANSIENT, retryable: true }),
  // A structured "this model is not routed here" without a 404 status still
  // means the same thing the 404 status rule says.
  Object.freeze({ marker: 'model_not_found', cooldownMs: COOLDOWN_LONG_MS, kind: FAILURE_KIND.UNAVAILABLE, scope: FAILURE_SCOPE.ACCOUNT, retryable: false }),
])

/** Overload statuses FCC folds into one retryable meaning. */
const OVERLOAD_STATUSES = Object.freeze([502, 503, 504, 529])

/**
 * Build one internal verdict. `cooldownLevel` is 0 for every fixed rule: a
 * level only exists to remember exponential growth, and reporting 0 keeps
 * callers from resetting an account's level on a rule that never read it.
 */
function verdictOf(kind, scope, options = {}) {
  return {
    kind,
    scope,
    retryable: options.retryable === true,
    cooldownMs: options.cooldownMs ?? 0,
    cooldownLevel: options.cooldownLevel ?? 0,
    rule: options.rule ?? 'default',
  }
}

/** One backoff rule: advance the level, then read the level's cooldown. */
function backoffOf(kind, scope, level, rule) {
  const cooldownLevel = Math.min(Math.max(0, level) + 1, BACKOFF_MAX_LEVEL)
  return verdictOf(kind, scope, {
    retryable: true,
    cooldownMs: backoffFor(cooldownLevel),
    cooldownLevel,
    rule,
  })
}

function normalizeLevel(level) {
  return typeof level === 'number' && Number.isFinite(level) ? Math.max(0, Math.floor(level)) : 0
}

/** Accept 429 and "429" alike; anything else is "no status". */
function normalizeStatus(status) {
  if (Number.isInteger(status)) return status
  if (typeof status === 'string' && /^\d{1,3}$/.test(status.trim())) return Number(status.trim())
  return undefined
}

/** JSON text for a body/message value; never throws on cycles or BigInt. */
function bodyTextOf(value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

/** The lowercase haystack every text/marker rule scans. */
function failureText(message, body, code) {
  const parts = []
  const messageText = typeof message === 'string' ? message : bodyTextOf(message)
  if (messageText !== '') parts.push(messageText)
  if (typeof code === 'string' && code !== '') parts.push(code)
  const bodyText = bodyTextOf(body)
  if (bodyText !== '') parts.push(bodyText)
  return parts.join(' ').toLowerCase()
}

/**
 * The structured `code`/`type` discriminators on the call and in the body
 * envelope, lowercased and deduplicated. FCC reads them off the exception and
 * from `body`, `body.error` and a JSON string body; the same walk happens here.
 */
function failureCodes(code, body) {
  const found = []
  const add = value => {
    if (typeof value !== 'string') return
    const trimmed = value.trim().toLowerCase()
    if (trimmed !== '' && !found.includes(trimmed)) found.push(trimmed)
  }
  add(code)
  for (const candidate of bodyCandidates(body)) {
    if (candidate === null || typeof candidate !== 'object') continue
    add(candidate.code)
    add(candidate.type)
  }
  return found
}

/** `body` itself plus its nested `error` object, parsing a JSON string body. */
function bodyCandidates(body) {
  if (typeof body === 'string') {
    try {
      return bodyCandidates(JSON.parse(body))
    } catch {
      return [body]
    }
  }
  if (body === null || typeof body !== 'object') return [body]
  const nested = body.error
  return nested !== null && typeof nested === 'object' && !Array.isArray(nested) ? [body, nested] : [body]
}

/** 1. Context overflow, before every other reading — see CONTEXT_WINDOW_CODES. */
function contextWindowVerdict(codes, text) {
  const named = codes.some(code => CONTEXT_WINDOW_CODES.includes(code))
  const described = CONTEXT_WINDOW_MARKERS.some(marker => text.includes(marker))
  if (!named && !described) return null
  return verdictOf(FAILURE_KIND.CONTEXT_WINDOW, FAILURE_SCOPE.REQUEST, { rule: 'context-window' })
}

/** 2. The 9router text rules, in table order, case-insensitive substring. */
function textRuleVerdict(text, level) {
  if (text === '') return null
  for (const rule of ERROR_RULES) {
    if (rule.text === undefined || !text.includes(rule.text)) continue
    if (rule.backoff === true) return backoffOf(rule.kind, rule.scope, level, `text:${rule.text}`)
    return verdictOf(rule.kind, rule.scope, { retryable: rule.retryable, cooldownMs: rule.cooldownMs, rule: `text:${rule.text}` })
  }
  return null
}

/** 3. The caller's own code, which is more specific than the raw status. */
function codeVerdict(codes, level) {
  for (const code of codes) {
    const rule = CODE_VERDICTS[code]
    if (rule === undefined) continue
    if (rule.backoff === true) return backoffOf(rule.kind, rule.scope, level, `code:${code}`)
    return verdictOf(rule.kind, rule.scope, { retryable: rule.retryable, cooldownMs: rule.cooldownMs, rule: `code:${code}` })
  }
  return null
}

/** 4. The 9router status rules. */
function statusRuleVerdict(status, level) {
  if (status === undefined) return null
  for (const rule of ERROR_RULES) {
    if (rule.status === undefined || rule.status !== status) continue
    if (rule.backoff === true) return backoffOf(rule.kind, rule.scope, level, `status:${status}`)
    return verdictOf(rule.kind, rule.scope, { retryable: rule.retryable, cooldownMs: rule.cooldownMs, rule: `status:${status}` })
  }
  return null
}

/** 5. FCC's marker table, for bodies with no status the table above matched. */
function markerVerdict(text, level) {
  if (text === '') return null
  for (const rule of MARKER_RULES) {
    if (!text.includes(rule.marker)) continue
    if (rule.backoff === true) return backoffOf(rule.kind, rule.scope, level, `marker:${rule.marker}`)
    return verdictOf(rule.kind, rule.scope, { retryable: rule.retryable, cooldownMs: rule.cooldownMs, rule: `marker:${rule.marker}` })
  }
  return null
}

/**
 * 6. FCC's status layer for everything 9router never listed.
 *
 * Unmatched 4xx is request-scoped with a zero cooldown: 9router's own
 * carve-out, kept because a 400 caused by the request says nothing about the
 * credential, and benching the account would remove a healthy connection while
 * hiding the real cause. 408 and 425 are the retryable carve-outs the target
 * project's http.js already treats as timing trouble. Any 5xx is a transient
 * 30 s wobble — 9router's default branch — with FCC's 502/503/504/529 read as
 * OVERLOADED rather than a generic upstream error.
 */
function statusLayerVerdict(status) {
  if (status === undefined) return null
  if (status === 408) return verdictOf(FAILURE_KIND.TIMEOUT, FAILURE_SCOPE.TRANSIENT, { retryable: true, cooldownMs: TRANSIENT_COOLDOWN_MS, rule: 'status:408' })
  if (status === 425) return verdictOf(FAILURE_KIND.UPSTREAM, FAILURE_SCOPE.TRANSIENT, { retryable: true, cooldownMs: TRANSIENT_COOLDOWN_MS, rule: 'status:425' })
  if (status >= 400 && status < 500) return verdictOf(FAILURE_KIND.INVALID_REQUEST, FAILURE_SCOPE.REQUEST, { rule: `status:${status}` })
  if (status >= 500 && status <= 599) {
    const kind = OVERLOAD_STATUSES.includes(status) ? FAILURE_KIND.OVERLOADED : FAILURE_KIND.UPSTREAM
    return verdictOf(kind, FAILURE_SCOPE.TRANSIENT, { retryable: true, cooldownMs: TRANSIENT_COOLDOWN_MS, rule: `status:${status}` })
  }
  return null
}

/** 7. Nothing matched at all: 9router's 30 s transient default. */
function transientVerdict() {
  return verdictOf(FAILURE_KIND.UNKNOWN, FAILURE_SCOPE.TRANSIENT, { retryable: true, cooldownMs: TRANSIENT_COOLDOWN_MS, rule: 'transient' })
}

/**
 * A provider-reported reset replaces the rule's cooldown for retryable
 * verdicts, clamped to `MAX_PROVIDER_COOLDOWN_MS`. Non-retryable verdicts keep
 * their own duration: a 401 does not become 30 s just because the body carried
 * a `retry-after`, and a zero-cooldown request-scoped verdict must not gain one.
 */
function applyProviderReset(verdict, retryAfterMs) {
  const reported = typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) ? Math.trunc(retryAfterMs) : 0
  if (reported <= 0) return verdict
  if (verdict.retryable !== true || verdict.cooldownMs <= 0) return verdict
  return { ...verdict, cooldownMs: Math.min(reported, MAX_PROVIDER_COOLDOWN_MS), rule: `${verdict.rule}+provider-reset` }
}

/**
 * The ported ERROR_RULES evaluation, in 9router's own vocabulary.
 *
 * Text rules are checked before status rules; the returned `cooldownLevel` is
 * the level after this failure (the source's `newBackoffLevel`), so a caller
 * that stores it can escalate the next cooldown. `shouldFallback` reproduces
 * the source's own answer exactly — false only for the unmatched-4xx
 * carve-out — which is also how `shouldAdvance` reads the merged verdict.
 *
 * @param {{status?: number|string, message?: string|object, backoffLevel?: number}} [failure]
 * @returns {{shouldFallback: boolean, cooldownMs: number, cooldownLevel: number, matched: string}}
 */
export function cooldownVerdict({ status, message, backoffLevel = 0 } = {}) {
  const normalizedStatus = normalizeStatus(status)
  const text = failureText(message, undefined, undefined)
  const level = normalizeLevel(backoffLevel)
  const hit = textRuleVerdict(text, level) ?? statusRuleVerdict(normalizedStatus, level)
  if (hit !== null) {
    return {
      shouldFallback: true,
      cooldownMs: hit.cooldownMs,
      cooldownLevel: hit.cooldownLevel,
      matched: hit.rule,
    }
  }
  if (normalizedStatus >= 400 && normalizedStatus < 500
    && normalizedStatus !== 401 && normalizedStatus !== 402 && normalizedStatus !== 403 && normalizedStatus !== 429) {
    return { shouldFallback: false, cooldownMs: 0, cooldownLevel: 0, matched: `request:${normalizedStatus}` }
  }
  return { shouldFallback: true, cooldownMs: TRANSIENT_COOLDOWN_MS, cooldownLevel: 0, matched: 'transient' }
}

/**
 * Classify one upstream failure into the merged vocabulary.
 *
 * Evaluation order, and why it is this order:
 *   1. context overflow — the provider may hide it in a plain 400, and the
 *      answer is "shrink the request", not "this account is broken";
 *   2. the 9router text rules — the source's documented rule that wording beats
 *      status for rate-limit/quota/capacity messages;
 *   3. the caller's own structured code — more specific than the status (a WAF
 *      403 is CLIENT_ERROR, not a bad credential);
 *   4. the 9router status rules (401/402/403/404/429);
 *   5. FCC's marker table — conditions named in the body with no usable status;
 *   6. FCC's status layer — unmatched 4xx is request-scoped, 5xx transient;
 *   7. the 30 s transient default.
 *
 * @param {object} failure
 * @param {number|string} [failure.status] - HTTP status, if the failure had one
 * @param {string} [failure.code] - project code (`UpstreamError.code`) or a provider code
 * @param {string|object} [failure.message] - error message text
 * @param {object|string} [failure.body] - error envelope or raw body
 * @param {number} [failure.retryAfterMs] - provider-reported reset duration
 * @param {number} [failure.backoffLevel] - the account's current backoff level
 * @returns {{kind: string, retryable: boolean, cooldownMs: number, cooldownLevel: number, scope: string, rule: string, status?: number}}
 */
export function classifyFailure({ status, code, message, body, retryAfterMs, backoffLevel = 0 } = {}) {
  const normalizedStatus = normalizeStatus(status)
  const text = failureText(message, body, code)
  const codes = failureCodes(code, body)
  const level = normalizeLevel(backoffLevel)
  const matched = contextWindowVerdict(codes, text)
    ?? textRuleVerdict(text, level)
    ?? codeVerdict(codes, level)
    ?? statusRuleVerdict(normalizedStatus, level)
    ?? markerVerdict(text, level)
    ?? statusLayerVerdict(normalizedStatus)
  const verdict = applyProviderReset(matched ?? transientVerdict(), retryAfterMs)
  return {
    kind: verdict.kind,
    retryable: verdict.retryable === true,
    cooldownMs: verdict.cooldownMs,
    cooldownLevel: verdict.cooldownLevel,
    scope: verdict.scope,
    rule: verdict.rule,
    ...normalizedStatus === undefined ? {} : { status: normalizedStatus },
  }
}

/**
 * Should the router move on to the next candidate?
 *
 * This is 9router's `shouldFallback`, read off the merged verdict: a candidate
 * is skipped only when the failure says nothing about it — the request-scoped
 * 4xx carve-out, an aborted turn, a context overflow. A caller that wants a
 * bigger-window fallback for a `context_window` failure can still check the
 * kind explicitly; the default stays "do not replay an identical body".
 *
 * @param {object} verdict - a `classifyFailure` result (or a `cooldownVerdict`)
 * @returns {boolean}
 */
export function shouldAdvance(verdict) {
  if (verdict === null || typeof verdict !== 'object') return false
  return verdict.retryable === true || verdict.cooldownMs > 0
}

/** Cooldown as the shortest honest human string: "2s", "2m", "1h 5m". */
function humanCooldown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const totalSeconds = Math.round(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts = []
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`)
  return parts.join(' ')
}

/**
 * One line for a log or a settings page. Never throws on a missing verdict: an
 * unclassified failure still has to be printable, or the log line becomes the
 * second failure.
 *
 * @param {object} verdict - a `classifyFailure` result
 * @returns {string}
 */
export function describeVerdict(verdict) {
  if (verdict === null || typeof verdict !== 'object') return 'unknown/unknown · no cooldown · via none'
  const parts = [`${verdict.kind ?? FAILURE_KIND.UNKNOWN}/${verdict.scope ?? 'unknown'}`]
  parts.push(verdict.cooldownMs > 0 ? `cooldown ${humanCooldown(verdict.cooldownMs)}` : 'no cooldown')
  if (verdict.cooldownLevel > 0) parts.push(`backoff level ${verdict.cooldownLevel}`)
  if (Number.isInteger(verdict.status)) parts.push(`HTTP ${verdict.status}`)
  parts.push(`via ${typeof verdict.rule === 'string' && verdict.rule !== '' ? verdict.rule : 'none'}`)
  return parts.join(' · ')
}
