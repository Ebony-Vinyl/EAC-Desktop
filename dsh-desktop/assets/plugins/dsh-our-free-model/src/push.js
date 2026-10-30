/**
 * Server-push channel: one Server-Sent-Events route that every open web surface
 * subscribes to.
 *
 * The kernel has no notification service, but its own client-HMR plugin
 * establishes the pattern this follows: a held-open `text/event-stream`
 * response, a comment heartbeat to defeat idle timeouts, and per-client removal
 * on close. `webServer` explicitly allows a handler to hold its response open,
 * and its gzip layer skips event streams, so no composition special-casing is
 * needed.
 *
 * Events are fire-and-forget snapshots, not a queue: a client that connects
 * after an announcement arrived learns about it from the first `hello` payload
 * rather than from history, which keeps this hub stateless.
 *
 * @module src/push.js
 */

const HEARTBEAT_MS = 25_000

export function createPushHub({ logger = console, heartbeatMs = HEARTBEAT_MS } = {}) {
  /** @type {Set<import('node:http').ServerResponse>} */
  const clients = new Set()
  let heartbeat = undefined

  function startHeartbeat() {
    if (heartbeat !== undefined || clients.size === 0) return
    heartbeat = setInterval(() => {
      for (const res of clients) {
        if (res.writableEnded === true || res.destroyed === true) { clients.delete(res); continue }
        res.write(': ping\n\n')
      }
      if (clients.size === 0) stopHeartbeat()
    }, heartbeatMs)
    heartbeat.unref?.()
  }

  function stopHeartbeat() {
    if (heartbeat === undefined) return
    clearInterval(heartbeat)
    heartbeat = undefined
  }

  return {
    /** @returns {number} how many surfaces are currently attached */
    get size() { return clients.size },
    /**
     * Adopt one request as a live event stream. The route handler has already
     * passed the trust fence; this takes ownership of the response.
     */
    attach(req, res, hello) {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      res.write(': connected\n\n')
      if (hello !== undefined) this.sendTo(res, 'hello', hello)
      clients.add(res)
      startHeartbeat()
      const drop = () => {
        clients.delete(res)
        if (clients.size === 0) stopHeartbeat()
      }
      req.on('close', drop)
      res.on('close', drop)
    },
    sendTo(res, event, data) {
      if (res.writableEnded === true || res.destroyed === true) { clients.delete(res); return }
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`)
      } catch (error) {
        clients.delete(res)
        logger.debug?.(`our-free-model push: dropped client (${error?.message ?? error})`)
      }
    },
    /** Broadcast one event to every attached surface. */
    emit(event, data) {
      for (const res of [...clients]) this.sendTo(res, event, data)
    },
    /** Close every stream; called from the fiber dispose so a hot reload or
     *  uninstall never leaves a half-open response behind. */
    dispose() {
      for (const res of [...clients]) {
        try { res.end() } catch { /* already gone */ }
      }
      clients.clear()
      stopHeartbeat()
    },
  }
}
