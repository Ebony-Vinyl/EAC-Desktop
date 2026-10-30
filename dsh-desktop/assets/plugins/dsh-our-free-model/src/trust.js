/**
 * Request trust fence for the plugin's HTTP surface.
 *
 * The plugin registers a prefix *longer* than the kernel's `/api`, and webServer
 * dispatch is longest-prefix-wins — so these routes run before the connection
 * service's own admission check and would otherwise answer any loopback caller.
 * That was measured and documented as an open boundary; this module closes it.
 *
 * Two layers, tried in order:
 *
 * 1. the composition's own `connection` service when present — the exact
 *    admission decision the kernel applies to its `/api` routes (trust fence
 *    plus browser-auth cookie), so the plugin is never weaker than the app;
 * 2. a structural replica of that fence for compositions without the service:
 *    loopback host only, no cross-site fetches, and an `Origin`/`Referer` that
 *    matches the `Host` authority whenever the client supplies one, with a
 *    narrow exception for the desktop's dsh-app://app relay Referer.
 *
 * @module src/trust.js
 */

/** Hostnames a same-machine caller can legitimately use. */
const LOOPBACK_NAMES = new Set(['127.0.0.1', '[::1]', '::1', 'localhost'])

/**
 * Is this address one a same-machine caller can reach — i.e. may the forward
 * listener bind it? The lanes are keyed to this machine's egress and priced
 * against whoever shares it, so binding a routable interface would hand the
 * quota to the whole subnet on the strength of a string in a settings file.
 */
export function isLoopbackHost(value) {
  const raw = String(value ?? '').trim()
  // URL's authority parser requires brackets around an IPv6 literal, but the
  // listener accepts the bare spelling too (`resolveLoopbackBind` strips the
  // brackets itself, and the standalone URL formatter names `::1` directly).
  if (raw === '::1') return true
  const authority = authorityOf(raw, 'http')
  return authority !== null && LOOPBACK_NAMES.has(authority.hostname)
}

/**
 * The fence's view of one connection service, keyed under `admit` (issue #89).
 *
 * The composition may publish `connection` long after plugins have loaded, so
 * index.js reads it per request through this late-binding view. Hosts before
 * dsh 0.1.7 carry the same decision as `requestRejection`: the view maps that
 * method onto `admit` instead of wrapping a property that does not exist —
 * the wrapping call used to throw inside the fence and read as 503 admission
 * unavailable on every request. A bare status travels as the `{rejection}`
 * envelope `rejectionFor` unwraps: handed through bare, an object-shaped
 * return reads as "no rejection" and switches the host's authentication off.
 *
 * Exported so the tests exercise the real view rather than a replica that can
 * drift from it.
 *
 * @param {object|(() => object|undefined)} service - the harness `connection`
 *   service, or a thunk resolving it per request (the composition may publish
 *   it long after plugins have loaded)
 * @returns {{admit: (req: object) => ({rejection: number}|undefined)|undefined}|{admit: undefined}}
 */
export function connectionAdmissionView(service) {
  return {
    get admit() {
      const current = typeof service === 'function' ? service() : service
      if (current === undefined) return undefined
      if (typeof current.admit !== 'function' && typeof current.requestRejection === 'function') {
        return req => {
          const status = current.requestRejection(req)
          return status === undefined ? undefined : { rejection: status }
        }
      }
      return req => current.admit(req)
    },
  }
}

/**
 * Decide one request. Returns an HTTP status to reject with, or `undefined` to
 * let the handler run.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {object|undefined} connection - the harness `connection` service, when the composition mounts one
 * @param {(decision: {status: number, source: string, reason: string}) => void} [onRejection]
 *   fixed diagnostic fields only; never request headers or error text
 * @returns {number|undefined}
 */
export function rejectionFor(req, connection, onRejection) {
  let decision
  try {
    // Hosts before dsh 0.1.7 publish the same decision under the older name
    // `requestRejection` (issue #89): `admit` is undefined there, and the
    // service *exists*, so an empty read must fall through to that method —
    // treating it as a fault turned every request into 503 admission
    // unavailable. The return value is a bare status on that spelling and an
    // `{rejection}` envelope on `admit`.
    const admit = connection?.admit
    if (typeof admit === 'function') {
      const admission = admit.call(connection, req)
      const status = admission && typeof admission === 'object' ? admission.rejection : undefined
      if (status === undefined) return undefined
      decision = { status, source: 'connection', reason: 'host-rejected' }
    } else {
      const reject = connection?.requestRejection
      if (typeof reject === 'function') {
        const status = reject.call(connection, req)
        if (status === undefined) return undefined
        decision = { status, source: 'connection', reason: 'host-rejected' }
      }
    }
  } catch {
    // Never bypass browser authentication when a mounted Host service fails.
    decision = { status: 503, source: 'connection', reason: 'admission-error' }
  }
  if (decision === undefined) {
    const reason = structuralReason(req)
    if (reason === undefined) return undefined
    decision = { status: 403, source: 'structural', reason }
  }
  try {
    onRejection?.(decision)
  } catch {
    // Diagnostics are observational; a logger cannot change the HTTP decision.
  }
  return decision.status
}

/**
 * The replica fence. Same shape as the kernel's `isTrustedApiRequest`: DNS
 * rebinding defence via the Host header, cross-site fetch refusal, and an
 * Origin/Referer authority match.
 */
export function structuralRejection(req) {
  return structuralReason(req) === undefined ? undefined : 403
}

/** Return a fixed reason without exposing caller-supplied strings. */
function structuralReason(req) {
  const host = authorityOf(req.headers.host, 'http')
  if (host === null || !LOOPBACK_NAMES.has(host.hostname)) return 'host-not-loopback'
  const site = String(req.headers['sec-fetch-site'] ?? '').toLowerCase()
  if (site === 'cross-site') return 'cross-site'
  for (const header of ['origin', 'referer']) {
    const raw = req.headers[header]
    if (typeof raw !== 'string' || raw.trim() === '') continue
    if (header === 'referer' && isDesktopRelayReferer(raw)) {
      // Desktop forwardWebRequest strips both browser markers before relaying
      // to HTTP loopback, but retains this Referer. It is not an Origin grant
      // and never overrides a mounted Host's authentication decision.
      if (req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined) return 'desktop-relay-markers'
      continue
    }
    const authority = authorityOf(raw.trim())
    if (authority === null) return `${header}-invalid`
    // The web server speaks plain http on a loopback bind, so an Origin that
    // claims https — or any other scheme — is not this page.
    if (authority.scheme !== host.scheme || authority.hostname !== host.hostname || authority.port !== host.port) return `${header}-mismatch`
  }
  return undefined
}

/** Only the owned application page, never arbitrary custom-protocol pages. */
function isDesktopRelayReferer(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'dsh-app:' && url.hostname === 'app' && url.port === ''
      && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

/** Split a Host/Origin/Referer value into {scheme, hostname, port}, defaulting the port. */
function authorityOf(value, defaultScheme) {
  if (typeof value !== 'string' || value.trim() === '') return null
  let url
  try {
    url = new URL(value.includes('://') ? value.trim() : `${defaultScheme ?? 'http'}://${value.trim()}`)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const port = url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port
  return { scheme: url.protocol.replace(':', ''), hostname: url.hostname.toLowerCase(), port }
}
