/** Preserve classified failures across the three local forwarding protocols. */
export function carryFailure(failure, kind = 'error') {
  const source = failure && typeof failure === 'object' ? failure : {}
  const code = kind === 'aborted' ? 'ABORTED' : source.code
  const status = source.status ?? source.statusCode
  return {
    message: typeof source.message === 'string' && source.message ? source.message : kind === 'aborted' ? 'request aborted' : 'our free model failed the turn',
    ...typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? { code } : {},
    ...Number.isInteger(status) && status >= 400 && status <= 599 ? { status } : {},
    ...Number.isFinite(source.providerRetryAfterMs) && source.providerRetryAfterMs > 0 ? { providerRetryAfterMs: source.providerRetryAfterMs } : {},
  }
}

/** Wire error metadata; no arbitrary provider properties are forwarded. */
export function forwardFailure(outcome, anthropic = false) {
  const failure = carryFailure(outcome.failure ?? { message: String(outcome.error) })
  const classes = {
    INVALID_CREDENTIAL: [401, 'authentication_error'],
    AUTHORIZATION_REQUIRED: [403, 'permission_error'],
    LANE_LOCKED: [403, 'permission_error'],
    REGION_BLOCKED: [403, 'permission_error'],
    PERMISSION_DENIED: [403, 'permission_error'],
    QUOTA_EXHAUSTED: [429, 'insufficient_quota'],
    RATE_LIMIT: [429, 'rate_limit_error'],
    CLIENT_ERROR: [400, 'invalid_request_error'],
    ABORTED: [400, 'invalid_request_error'],
    TIMEOUT: [504, 'server_error'],
    EAC_UPSTREAM_FAILED: [502, 'server_error'],
    NO_PROGRESS: [504, 'server_error'],
  }
  const byStatus = { 400: 'invalid_request_error', 401: 'authentication_error', 403: 'permission_error', 404: 'invalid_request_error', 429: 'rate_limit_error' }
  const [fallbackStatus, type] = classes[failure.code] ?? [502, byStatus[failure.status] ?? 'server_error']
  return {
    status: failure.status ?? fallbackStatus,
    error: { message: failure.message, type: anthropic && type === 'server_error' ? 'api_error' : type, ...(failure.code ? { code: failure.code } : {}) },
    retryAfterMs: failure.providerRetryAfterMs,
    classified: Boolean(failure.code || failure.status),
  }
}
