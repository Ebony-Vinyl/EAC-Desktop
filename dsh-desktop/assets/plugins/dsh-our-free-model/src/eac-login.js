/** Host-only login delivery. Tokens never appear in the browser response. */
import crypto from 'node:crypto'

const LINK = /^[A-Za-z0-9_-]{16,64}$/
const RECEIPT_TTL = 15 * 60_000
const digest = token => crypto.createHash('sha256').update(token).digest('hex')

export function createEacLoginPoller({ credentialOf, fetch, readUser, writeUser, onSaved, now = Date.now }) {
  const inflight = new Map()
  const receipts = new Map()
  const controllers = new Map()
  const sessions = new Map()
  let generation = 0

  function sessionFor(link) {
    for (const [key, value] of sessions) if (value.exp < now() && !controllers.has(key)) sessions.delete(key)
    if (!sessions.has(link)) sessions.set(link, { cancelled: false, exp: now() + RECEIPT_TTL })
    return sessions.get(link)
  }

  async function collect(link, credential, startedGeneration, controller) {
    const cancelled = () => startedGeneration !== generation || controller.signal.aborted || sessions.get(link)?.cancelled === true
    let response, data
    try {
      const root = credential.base.replace(/\/v1\/?$/, '')
      response = await fetch(`${root}/auth/poll?link=${encodeURIComponent(link)}&retain=1`, {
        headers: { accept: 'application/json' }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      })
      if (!response.ok) return { error: `gateway-http-${response.status}` }
      data = await response.json().catch(() => null)
    } catch { return { error: cancelled() ? 'cancelled' : 'unreachable' } }
    if (cancelled()) return { error: 'cancelled' }
    if (data?.status === 'expired') return { status: 'expired' }
    if (data?.status === 'pending') return { status: 'pending' }
    if (data?.status === 'unstarred') return { status: 'unstarred', login: typeof data.login === 'string' ? data.login : '', repo: typeof data.repo === 'string' ? data.repo : '' }
    if (data?.status !== 'ok' || typeof data.token !== 'string' || data.token === '') return { error: 'malformed' }

    const saved = writeUser({ token: data.token, login: typeof data.login === 'string' ? data.login : '', avatar: typeof data.avatar === 'string' ? data.avatar : '' })
    if (saved === null || readUser()?.token !== data.token) return { error: 'not-writable' }
    onSaved(saved)
    const result = { status: 'ok', login: saved.login }
    receipts.set(link, { hash: digest(saved.token), result, exp: now() + RECEIPT_TTL })
    // Old gateways ignore retain and omit ackRequired. An ACK failure does
    // not invalidate the credential already safely stored on this machine.
    if (data.ackRequired === true) {
      try {
        await fetch(`${credential.base.replace(/\/v1\/?$/, '')}/auth/ack?link=${encodeURIComponent(link)}`, {
          method: 'POST', headers: { accept: 'application/json', 'x-ofm-user': saved.token },
          signal: AbortSignal.timeout(3000),
        })
      } catch { /* bounded pending TTL handles an unreachable confirmation */ }
    }
    return startedGeneration === generation ? result : { error: 'cancelled' }
  }

  return {
    async prepare(link) {
      if (typeof link !== 'string' || !LINK.test(link)) return { error: 'bad-link' }
      if (sessionFor(link).cancelled) return { error: 'cancelled' }
      const credential = credentialOf()
      if (credential === null || credential.mode !== 'worker') return { error: 'no-lane' }
      const startedGeneration = generation
      const controller = new AbortController()
      controllers.set(link, controller)
      try {
        // The existing start endpoint registers a waiting link. Node transport
        // does not follow its OAuth redirect; the system browser opens later.
        const response = await fetch(`${credential.base.replace(/\/v1\/?$/, '')}/auth/github/start?link=${encodeURIComponent(link)}`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        })
        await response.text().catch(() => {})
        if (startedGeneration !== generation || sessionFor(link).cancelled) return { error: 'cancelled' }
        return response.status === 302 ? { ok: true } : { error: `gateway-http-${response.status}` }
      } catch { return { error: controller.signal.aborted ? 'cancelled' : 'unreachable' } }
      finally { if (controllers.get(link) === controller) controllers.delete(link) }
    },
    poll(link) {
      if (typeof link !== 'string' || !LINK.test(link)) return Promise.resolve({ error: 'bad-link' })
      if (sessionFor(link).cancelled) return Promise.resolve({ error: 'cancelled' })
      const credential = credentialOf()
      if (credential === null || credential.mode !== 'worker') return Promise.resolve({ error: 'no-lane' })
      for (const [key, value] of receipts) if (value.exp < now()) receipts.delete(key)
      const receipt = receipts.get(link)
      const local = readUser()
      if (receipt !== undefined && local !== null && digest(local.token) === receipt.hash) return Promise.resolve(receipt.result)
      if (inflight.has(link)) return inflight.get(link)
      const controller = new AbortController()
      controllers.set(link, controller)
      const request = collect(link, credential, generation, controller).finally(() => {
        if (inflight.get(link) === request) inflight.delete(link)
        if (controllers.get(link) === controller) controllers.delete(link)
      })
      inflight.set(link, request)
      return request
    },
    cancel(link) {
      if (typeof link !== 'string' || !LINK.test(link)) return { error: 'bad-link' }
      const receipt = receipts.get(link)
      const local = readUser()
      // Saving is the commit point. If it already happened, report completion
      // instead of claiming cancellation or deleting an existing authorization.
      if (receipt !== undefined && local !== null && digest(local.token) === receipt.hash) return receipt.result
      sessions.set(link, { cancelled: true, exp: now() + RECEIPT_TTL })
      controllers.get(link)?.abort()
      receipts.delete(link)
      return { ok: true }
    },
    reset() {
      generation++
      for (const link of sessions.keys()) sessions.set(link, { cancelled: true, exp: now() + RECEIPT_TTL })
      for (const controller of controllers.values()) controller.abort()
      controllers.clear(); receipts.clear(); inflight.clear()
    },
  }
}
