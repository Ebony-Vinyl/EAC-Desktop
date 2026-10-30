/**
 * The lane's own egress: one switchable outlet every upstream request walks out
 * through.
 *
 * Three call sites make the requests the region gate and the per-IP pools see —
 * `postStreamed` and `getJson` in src/http.js, `detectEgress` in src/probe.js —
 * and all three used to be a bare `fetch`. This module keeps them on `fetch`
 * and moves the routing underneath: with an outlet configured, `egressFetch`
 * rewrites the call to a loopback relay it owns, and the relay opens the real
 * connection through the outlet. The call sites keep their bodies, headers,
 * signals and `redirect: 'error'` policy verbatim, so a proxied turn and a
 * direct one differ in exactly one thing: which socket leaves this machine.
 *
 * Two outlet shapes, one dialer:
 *
 *   - `client`   — an http/https/socks5 proxy address that already exists (the
 *                  user's own client, a LAN gateway). The plugin dials it.
 *   - `subscription` — the plugin spawns mihomo (Clash Verge's core, or any
 *                  mihomo/clash binary found on the machine) with a
 *                  proxy-provider pointing at the subscription URL and a
 *                  url-test group that re-measures every node every five
 *                  minutes. The lowest-latency node wins, a 429 in the
 *                  health-check marks the node dead and takes it out of the
 *                  rotation, and the plugin only ever dials the local mixed
 *                  port — it never parses a vless/vmess/trojan URI itself.
 *
 * Why spawn rather than embed: the light route (parse `http(s)/socks5` entries
 * and dial them in-process) cannot express a vless-REALITY subscription at all,
 * and a 108-byte PROXY-style trick cannot either — the protocol work belongs to
 * a purpose-built binary that already does health scoring and group selection.
 * The plugin's job is the seam: config in, local port out, `egressFetch`
 * unchanged between modes.
 *
 * Security notes that the settings route relies on:
 *
 *   - The relay binds `127.0.0.1` on an ephemeral port and is deliberately not
 *     an open proxy: every start mints a random key, `egressFetch` presents it,
 *     and any other caller — a neighbouring local process, a rebound page — is
 *     refused before a single dial. A keyed caller still needs an absolute
 *     http(s) target, and nothing else in the process rewrites.
 *   - The managed mihomo's mixed port is passworded (`authentication`) with a
 *     per-start credential the plugin is the only holder of, so the outlet
 *     cannot be borrowed by another process on this machine.
 *   - The subscription URL is a bearer credential: it is written to the mihomo
 *     config file (mode 0600-ish, inside the plugin's own data dir), never
 *     logged, and surfaced to the settings page as a hostname only.
 *   - `mihomoPath` comes from local settings, which the trust fence already
 *     gates the same way it gates every other write; there is no download step
 *     anywhere in this file.
 */
import fs from 'node:fs'
import net from 'node:net'
import tls from 'node:tls'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { spawn } from 'node:child_process'

/** The loopback address the relay listens on. Never a routable one. */
const RELAY_HOST = '127.0.0.1'
/** Carries the absolute target URL from `egressFetch` to the relay. */
const TARGET_HEADER = 'x-ofm-egress-target'
/** Carries this start's relay key. Every listen mints one, `egressFetch` is the
 *  only thing that learns it, and a request without it is not the plugin — it
 *  is refused before a single dial, so the loopback port is nobody's open
 *  proxy. Never forwarded upstream: the relay strips it like the target. */
const KEY_HEADER = 'x-ofm-egress-key'
/** One dial (connect, CONNECT response, socks5 handshake, TLS) gets this long. */
const DIAL_TIMEOUT_MS = 10_000
/** A freshly spawned mihomo gets this long to open its mixed port. */
const READY_TIMEOUT_MS = 15_000
/** Schemes a `client` outlet may speak. The subscription path needs none: it
 *  always dials the local mixed port over plain http. */
const CLIENT_SCHEMES = new Set(['http:', 'https:', 'socks5:', 'socks5h:'])
/** Hop-by-hop headers never forwarded across the relay boundary, either
 *  direction. `transfer-encoding` is dropped too: Node re-derives framing from
 *  the stream it is handed, and forwarding a foreign `chunked` marker would
 *  double-frame it. */
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'proxy-connection'])

/**
 * The live relay, owned by whichever generation started it. Module-level on
 * purpose: `egressFetch` is imported by src/http.js and src/probe.js, which
 * have no handle on the index fiber, and a hot reload swaps this whole module
 * while the old relay's disposer tears the old one down.
 */
let activeRelay = null

/** True when requests will be rewritten onto the relay instead of going out direct. */
export function egressActive() {
  return activeRelay !== null
}

/**
 * `fetch`, through the outlet when one is running and straight out when not.
 *
 * The rewrite is deliberately boring: same method, same body, same signal, plus
 * the target and this start's key in headers, and the path replaced by the
 * origin-form the loopback relay serves. Call sites keep `redirect: 'error'` in
 * `init`, so a 3xx is a response, never a second hop that would dodge the outlet.
 */
export async function egressFetch(url, init) {
  const relay = activeRelay
  if (relay === null) return fetch(url, init)
  const target = new URL(String(url))
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error(`the egress relay only carries http(s) targets, got "${target.protocol}"`)
  }
  const headers = new Headers(init?.headers ?? {})
  headers.set(TARGET_HEADER, target.href)
  headers.set(KEY_HEADER, relay.key)
  return fetch(`http://${RELAY_HOST}:${relay.port}${target.pathname}${target.search}`, { ...init, headers })
}

/**
 * Start the relay for the current settings; throws with a message the settings
 * page can show when the configuration cannot run.
 *
 * Mirrors `startForwardServer`'s contract: the caller (`syncEgress`) owns the
 * idempotence — close the old one first — and this function only builds the
 * new one or fails.
 */
export async function startEgressRelay({ config, dataDir, log = () => {}, onDead }) {
  const cfg = { mode: 'subscription', url: '', mihomoPath: '', ...config() }
  const mode = cfg.mode === 'client' ? 'client' : 'subscription'
  const url = String(cfg.url ?? '').trim()
  if (url === '') throw new Error('the egress outlet is enabled but empty — paste a proxy address or a subscription link')
  // Minted per start, not per process: a key that leaked from a previous relay
  // must not open this one. Lives in the handle only, and is never written down.
  const key = randomBytes(16).toString('hex')
  let child = null
  let managed = null
  let outlet
  if (mode === 'client') {
    const parsed = new URL(url)
    if (!CLIENT_SCHEMES.has(parsed.protocol)) {
      throw new Error(`unsupported proxy scheme "${parsed.protocol}" — use http, https, socks5 or socks5h`)
    }
    outlet = { kind: 'url', url: parsed }
  } else {
    const binary = findMihomoBinary(cfg.mihomoPath)
    const dir = path.join(dataDir, 'egress')
    fs.mkdirSync(dir, { recursive: true })
    const mixedPort = await freePort()
    const apiPort = await freePort()
    const secret = randomBytes(16).toString('hex')
    // The mixed port is passworded for the same reason the relay is keyed: an
    // outlet any local process can borrow is an outlet that will be borrowed.
    // Only this module's dialer ever learns this credential — it rides in the
    // outlet URL below, never in the rendered config the user can read.
    const outletAuth = `ofm:${randomBytes(12).toString('hex')}`
    const configPath = path.join(dir, 'mihomo.yaml')
    fs.writeFileSync(configPath, renderMihomoConfig({
      subscription: url,
      mixedPort,
      apiPort,
      secret,
      auth: outletAuth,
      logFile: path.join(dir, 'mihomo.log'),
    }), { mode: 0o600 })
    child = spawn(binary, ['-d', dir, '-f', configPath], { windowsHide: true, stdio: 'ignore' })
    let spawnError = null
    let exited = null
    child.on('error', error => { spawnError = error })
    child.on('exit', (code, signal) => { if (exited === null && spawnError === null) exited = `mihomo exited (${signal ?? code})` })
    // The provider URL is fetched by mihomo itself on startup, so readiness is
    // "the mixed port answers", not "the subscription parsed" — a bad link
    // still opens the port and then reports zero nodes through the API, which
    // the first health-check surfaces as a dead group rather than a hang here.
    try {
      await waitForPort(RELAY_HOST, mixedPort, READY_TIMEOUT_MS, () => {
        if (spawnError !== null) throw new Error(`mihomo could not start (${spawnError.message})`)
        if (exited !== null) throw new Error(`${exited} — see ${path.join(dir, 'mihomo.log')}`)
      })
    } catch (error) {
      // Nothing owns this child yet — the handle that would kill it is not built
      // until the listener is up — so a start that fails here has to reap it
      // itself, or a wedged mihomo outlives the attempt holding the mixed port.
      await killChild(child)
      throw error
    }
    log(`managed mihomo on ${RELAY_HOST}:${mixedPort} (controller ${RELAY_HOST}:${apiPort})`)
    outlet = { kind: 'url', url: new URL(`http://${outletAuth}@${RELAY_HOST}:${mixedPort}`) }
    managed = { mixedPort, apiPort, secret, dir }
  }

  const sockets = new Set()
  const server = http.createServer(relayRequest)
  server.on('connection', socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, RELAY_HOST, () => { server.removeListener('error', reject); resolve() })
    })
  } catch (error) {
    // The listener is what turns `child` into an owned handle; without it the
    // started mihomo would outlive the failed start holding its ports.
    await killChild(child)
    throw error
  }
  const port = server.address().port
  const handle = {
    port,
    key,
    mode,
    url,
    outlet,
    managed,
    child,
    log,
    /** Set when the managed child dies after startup; the settings page shows it. */
    dead: '',
    close: async () => {
      if (activeRelay === handle) activeRelay = null
      for (const socket of sockets) socket.destroy()
      await new Promise(resolve => server.close(resolve))
      await killChild(child)
    },
  }
  if (child !== null) {
    child.on('exit', () => {
      handle.dead = 'the managed mihomo process exited'
      log(`${handle.dead}; a restart has been scheduled`)
      // A dead managed mihomo otherwise stays dead until the user touches the
      // settings page: every upstream request would hard-fail through the
      // relay's closed dial port. The owner decides the retry policy (backoff,
      // give-up) — this only reports the death once, on the way down.
      try { onDead?.() } catch { /* a diagnostics callback cannot resurrect or worsen the relay */ }
    })
  }
  activeRelay = handle
  return handle
}

/**
 * One proxied request: open the tunnel, hand the socket to a one-shot agent,
 * pipe both directions.
 *
 * The dial is awaited before the outgoing request is built because the
 * agent's `createConnection` override is synchronous — the same seam the LAN
 * relay uses to stamp a PROXY v1 line, proven against this http stack. Both
 * bodies and the SSE response stream through as bytes; nothing is buffered
 * beyond Node's own flow control, so a streaming turn keeps its chunk cadence.
 */
function relayRequest(req, res) {
  const key = String(req.headers[KEY_HEADER] ?? '')
  delete req.headers[KEY_HEADER]
  if (!sameSecret(key, activeRelay?.key ?? '')) {
    // Not the plugin: a neighbouring local process, a page that guessed the
    // port, a fetch left over from a previous generation. Refused before any
    // dial happens, and the caller learns nothing about the outlet.
    activeRelay?.log?.('relay: refused a caller without this start’s key')
    sendLocal(res, 403, 'the egress relay answers its own plugin only')
    return
  }
  const targetHeader = req.headers[TARGET_HEADER]
  delete req.headers[TARGET_HEADER]
  let upstream
  try {
    upstream = new URL(String(targetHeader ?? ''))
  } catch {
    sendLocal(res, 400, `the egress relay needs a full ${TARGET_HEADER} target URL`)
    return
  }
  if (upstream.protocol !== 'http:' && upstream.protocol !== 'https:') {
    sendLocal(res, 400, `the egress relay carries http(s) targets only, got "${upstream.protocol}"`)
    return
  }
  const outlet = activeRelayOutlet()
  // Host only, never the href: query strings routinely carry credentials
  // (Gemini's ?key=… being the canonical case), and this line runs per request.
  activeRelay?.log?.(`relay: ${req.method} → ${upstream.protocol}//${upstream.host} (outlet ${outlet === null ? 'none' : 'ok'})`)
  if (outlet === null) {
    sendLocal(res, 502, 'the egress relay is not running')
    return
  }
  void (async () => {
    const socket = await openTunnel(upstream, outlet)
    const agent = new http.Agent({ keepAlive: false })
    agent.createConnection = () => socket
    const headers = { ...req.headers, host: upstream.host }
    delete headers['transfer-encoding']
    const outgoing = http.request({
      method: req.method,
      path: `${upstream.pathname}${upstream.search}`,
      headers,
      agent,
    })
    outgoing.on('response', upstreamRes => {
      const responseHeaders = {}
      for (const [name, value] of Object.entries(upstreamRes.headers)) {
        if (!HOP_BY_HOP.has(name)) responseHeaders[name] = value
      }
      res.writeHead(upstreamRes.statusCode ?? 502, responseHeaders)
      activeRelay?.log?.(`relay: response ${upstreamRes.statusCode} for ${upstream.host} started`)
      upstreamRes.on('error', error => {
        activeRelay?.log?.(`egress relay: upstream body for ${upstream.host} failed: ${error?.message ?? error}`)
        res.destroy()
      })
      upstreamRes.pipe(res)
    })
    outgoing.on('error', error => {
      activeRelay?.log?.(`egress relay: tunnel to ${upstream.host} failed: ${error?.message ?? error}`)
      failOnce(res, error)
    })
    // A client abort (the harness aborts a dead turn) must tear the upstream
    // side down too, or the socket idles until the outlet times it out. On a
    // completed response only the one-shot tunnel socket goes: destroying the
    // client connection while its body is still in flight reads as a reset to
    // fetch(). The per-request tunnel is never reused (keepAlive: false).
    res.on('close', () => {
      outgoing.destroy()
      socket.destroy()
      if (!res.writableFinished) {
        activeRelay?.log?.(`relay: response for ${upstream.host} closed before finish (writableEnded=${res.writableEnded})`)
        try { res.destroy() } catch { /* already gone */ }
      }
    })
    req.on('error', () => { outgoing.destroy() })
    req.pipe(outgoing)
  })().catch(error => {
    activeRelay?.log?.(`egress relay: ${upstream.host} failed: ${error?.message ?? error}`)
    failOnce(res, error)
  })
}

/** The outlet the running relay dials; `null` between generations. */
function activeRelayOutlet() {
  return activeRelay?.outlet ?? null
}

/** The relay is loopback-only: a non-2xx here is a local misconfiguration, answered as JSON like every other local refusal. */
function sendLocal(res, status, message) {
  if (res.headersSent) { activeRelay?.log?.(`relay: sendLocal(${status}) after headers, destroying`); res.destroy(); return }
  const body = JSON.stringify({ error: message })
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

/** Last-word failure: 502 before headers, a dead socket after. */
function failOnce(res, error) {
  if (res.headersSent) { res.destroy(); return }
  sendLocal(res, 502, `egress tunnel failed: ${error?.message ?? error}`)
}

/**
 * Connect to `upstream` through `outlet` and return a socket ready for plain
 * http framing — already TLS-wrapped when the target is https.
 */
async function openTunnel(upstream, outlet) {
  const isTls = upstream.protocol === 'https:'
  const host = upstream.hostname
  const port = Number(upstream.port) || (isTls ? 443 : 80)
  let socket
  if (outlet.kind === 'url') {
    const proxy = outlet.url
    if (proxy.protocol === 'http:' || proxy.protocol === 'https:') socket = await httpConnect(proxy, host, port)
    else if (proxy.protocol === 'socks5:' || proxy.protocol === 'socks5h:') socket = await socks5Connect(proxy, host, port, proxy.protocol === 'socks5h:')
    else throw new Error(`unsupported proxy scheme "${proxy.protocol}"`)
  } else {
    socket = await netConnect(host, port)
  }
  if (!isTls) return socket
  return await withTimeout(new Promise((resolve, reject) => {
    const secured = tls.connect({
      socket,
      // An IP literal has no name to assert; the lane's hosts are names.
      servername: net.isIP(host) === 0 ? host : undefined,
      ALPNProtocols: ['http/1.1'],
    })
    secured.once('secureConnect', () => resolve(secured))
    secured.once('error', error => { secured.destroy(); reject(error) })
  }), DIAL_TIMEOUT_MS, 'target TLS handshake', socket)
}

/** Plain TCP with the dial budget applied. */
function netConnect(host, port) {
  return withTimeout(new Promise((resolve, reject) => {
    const socket = net.connect({ host, port })
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  }), DIAL_TIMEOUT_MS, 'tcp connect')
}

/**
 * HTTP CONNECT through an http(s) proxy — including the local mixed port a
 * managed mihomo opens, which speaks CONNECT like any other proxy.
 */
async function httpConnect(proxy, targetHost, targetPort) {
  let socket = await netConnect(proxy.hostname, Number(proxy.port) || (proxy.protocol === 'https:' ? 443 : 80))
  try {
    if (proxy.protocol === 'https:') {
      socket = await withTimeout(new Promise((resolve, reject) => {
        const secured = tls.connect({ socket, servername: net.isIP(proxy.hostname) === 0 ? proxy.hostname : undefined })
        secured.once('secureConnect', () => resolve(secured))
        secured.once('error', error => { secured.destroy(); reject(error) })
      }), DIAL_TIMEOUT_MS, 'proxy TLS handshake', socket)
    }
    const auth = proxy.username === '' ? '' : `Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}\r\n`
    socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n${auth}\r\n`)
    const { rest } = await readUntil(socket, DIAL_TIMEOUT_MS, 'CONNECT response', buffer => {
      const end = buffer.indexOf('\r\n\r\n')
      if (end === -1) return null
      const head = buffer.subarray(0, end).toString('latin1')
      const match = /^HTTP\/1\.[01] (\d{3})/.exec(head)
      if (match === null) throw new Error(`the proxy answered "${head.split('\r\n')[0] ?? ''}" to CONNECT`)
      if (Number(match[1]) < 200 || Number(match[1]) >= 300) throw new Error(`the proxy refused CONNECT with ${match[1]}`)
      return end + 4
    })
    if (rest.length > 0) socket.unshift(rest)
    return socket
  } catch (error) {
    socket.destroy()
    throw error
  }
}

/**
 * SOCKS5 CONNECT (RFC 1928, optional RFC 1929 credentials).
 *
 * `socks5h` sends the hostname and lets the proxy resolve it — the airport
 * exit must see the name, not this machine's DNS answer. Plain `socks5`
 * resolves locally first, per the scheme's definition.
 */
async function socks5Connect(proxy, targetHost, targetPort, resolveAtProxy) {
  const socket = await netConnect(proxy.hostname, Number(proxy.port) || 1080)
  try {
    const withAuth = proxy.username !== ''
    socket.write(Buffer.from(withAuth ? [0x05, 0x02, 0x00, 0x02] : [0x05, 0x01, 0x00]))
    // Each stage consumes exactly the bytes of its message (parsed from
    // `head`) and pushes any bytes past the mark back — a coalesced TCP read
    // must not swallow the next stage.
    const greeting = await readUntil(socket, DIAL_TIMEOUT_MS, 'socks5 greeting', buffer => (buffer.length < 2 ? null : 2 + buffer[1]))
    if (greeting.rest.length > 0) socket.unshift(greeting.rest)
    if (greeting.head[0] !== 0x05) throw new Error(`the socks5 proxy answered version ${greeting.head[0] ?? 'nothing'}`)
    const selected = greeting.head[1]
    if (selected === 0x02) {
      if (!withAuth) throw new Error('the socks5 proxy demands credentials this outlet does not have')
      const user = Buffer.from(decodeURIComponent(proxy.username), 'utf8')
      const pass = Buffer.from(decodeURIComponent(proxy.password), 'utf8')
      socket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]))
      const auth = await readUntil(socket, DIAL_TIMEOUT_MS, 'socks5 auth', buffer => (buffer.length >= 2 ? 2 : null))
      if (auth.rest.length > 0) socket.unshift(auth.rest)
      if (auth.head[0] !== 0x01 || auth.head[1] !== 0x00) throw new Error('the socks5 proxy rejected the credentials')
    } else if (selected !== 0x00) {
      throw new Error(`the socks5 proxy selected method ${selected}, expected 0 (none) or 2 (user/pass)`)
    }
    let address
    if (resolveAtProxy) {
      // RFC 1928: atyp 3 is [1-byte length][domain], unlike the raw IP forms.
      address = { type: 0x03, bytes: Buffer.concat([Buffer.from([Buffer.byteLength(targetHost)]), Buffer.from(targetHost, 'utf8')]) }
    } else {
      address = encodeAddress(await lookup(targetHost))
    }
    const request = Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, address.type]),
      address.bytes,
      Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff]),
    ])
    socket.write(request)
    const reply = await readUntil(socket, DIAL_TIMEOUT_MS, 'socks5 connect reply', buffer => {
      if (buffer.length < 4) return null
      if (buffer[0] !== 0x05) throw new Error(`the socks5 reply started with ${buffer[0]}`)
      if (buffer[1] !== 0x00) throw new Error(`the socks5 proxy refused the connection (code ${buffer[1]})`)
      const atyp = buffer[3]
      if (atyp === 0x01) return buffer.length >= 10 ? 10 : null
      if (atyp === 0x04) return buffer.length >= 22 ? 22 : null
      if (atyp === 0x03) {
        if (buffer.length < 5) return null
        const full = 4 + 1 + buffer[4] + 2
        return buffer.length >= full ? full : null
      }
      throw new Error(`the socks5 reply used unknown address type ${atyp}`)
    })
    if (reply.rest.length > 0) socket.unshift(reply.rest)
    return socket
  } catch (error) {
    socket.destroy()
    throw error
  }
}

/** DNS answer → SOCKS5 address block (type byte + encoded bytes). */
function encodeAddress(resolved) {
  if (resolved.family !== 6) {
    return { type: 0x01, bytes: Buffer.from(resolved.address.split('.').map(part => Number(part) & 0xff)) }
  }
  // Expand the `::` run before splitting: a compressed literal has empty
  // groups in the middle that must be counted, not parsed.
  const [head, tail, ...extra] = resolved.address.split('::')
  if (extra.length > 0) throw new Error(`unexpected IPv6 literal "${resolved.address}"`)
  const headGroups = head === '' ? [] : head.split(':')
  const tailGroups = tail === undefined || tail === '' ? [] : tail.split(':')
  const groups = tail === undefined
    ? headGroups
    : [...headGroups, ...Array(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill('0'), ...tailGroups]
  const bytes = Buffer.alloc(16)
  groups.forEach((group, index) => {
    const value = Number.parseInt(group, 16)
    bytes[index * 2] = (value >> 8) & 0xff
    bytes[index * 2 + 1] = value & 0xff
  })
  return { type: 0x04, bytes }
}

/**
 * Accumulate socket bytes until `matcher` is happy; resolve with the bytes
 * past the mark so the caller can push them back with `unshift`.
 */
function readUntil(socket, timeoutMs, what, matcher) {
  return withTimeout(new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    const onData = chunk => {
      chunks.push(chunk)
      size += chunk.length
      const buffer = Buffer.concat(chunks, size)
      let mark
      try {
        mark = matcher(buffer)
      } catch (error) {
        cleanup()
        reject(error)
        return
      }
      if (mark === null) {
        if (size > 16 * 1024) {
          cleanup()
          reject(new Error(`the proxy sent more than 16KB without finishing the ${what}`))
        }
        return
      }
      cleanup()
      resolve({ head: buffer.subarray(0, mark), rest: buffer.subarray(mark) })
    }
    const onError = error => { cleanup(); reject(error) }
    const onClose = () => { cleanup(); reject(new Error(`the proxy closed during the ${what}`)) }
    const cleanup = () => {
      socket.off('data', onData)
      socket.off('error', onError)
      socket.off('close', onClose)
    }
    socket.on('data', onData)
    socket.on('error', onError)
    socket.on('close', onClose)
    // The socket was paused until now (connect-stage listeners only), so the
    // first byte arrives after this switch and nothing is lost in between.
    socket.resume()
  }), timeoutMs, what, socket)
}

/** Reject after `ms`, tearing the socket down so nothing leaks half-open. */
function withTimeout(promise, ms, what, socket) {
  let timer
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        socket?.destroy?.()
        reject(new Error(`timed out after ${ms}ms: ${what}`))
      }, ms)
      timer.unref?.()
    }),
  ])
}

/** A free loopback port. Small bind/close race is acceptable — a collision surfaces as a clean startup error, not a corrupt state. */
async function freePort() {
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, RELAY_HOST, resolve))
  const { port } = server.address()
  await new Promise(resolve => server.close(resolve))
  return port
}

/** Poll a TCP port until it answers or the budget runs out; `check` rethrows why early. */
async function waitForPort(host, port, timeoutMs, check) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    check?.()
    const open = await new Promise(resolve => {
      const socket = net.connect({ host, port })
      const settle = ok => {
        socket.removeAllListeners()
        socket.destroy()
        resolve(ok)
      }
      socket.once('connect', () => settle(true))
      socket.once('error', () => settle(false))
    })
    if (open) return
    if (Date.now() > deadline) throw new Error(`the port ${host}:${port} never opened within ${timeoutMs}ms`)
    await new Promise(resolve => { const t = setTimeout(resolve, 250); t.unref?.() })
  }
}

/**
 * Stop a spawned outlet child: ask nicely, then insist. Shared by `close()` and
 * by a failed start — a mihomo that never opened its port still holds it, and
 * once the attempt has given up nothing else can reach that child.
 */
async function killChild(proc) {
  if (proc === null || proc.exitCode !== null || proc.signalCode !== null) return
  proc.removeAllListeners('exit')
  try { proc.kill() } catch { /* already gone */ }
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 3_000)
    proc.once('exit', () => { clearTimeout(timer); resolve() })
  })
  if (proc.exitCode === null && proc.signalCode === null) {
    try { proc.kill('SIGKILL') } catch { /* already gone */ }
  }
}

/** Constant-time relay-key comparison; the length check keeps `timingSafeEqual` from throwing. */
function sameSecret(given, expected) {
  const a = Buffer.from(String(given ?? ''))
  const b = Buffer.from(String(expected ?? ''))
  return a.length >= 16 && a.length === b.length && timingSafeEqual(a, b)
}

/**
 * The mihomo configuration this plugin runs: subscription as a proxy-provider,
 * a url-test group that re-measures on an interval, and MATCH routed through
 * it — so every connection the plugin makes leaves via the freshest
 * lowest-latency node without the plugin choosing one itself.
 *
 * `expected-status: 204` sits on the provider's health-check: the target is
 * gstatic's `generate_204`, so a 429 (or any error page) marks the node dead
 * and url-test excludes it. That is the 429-penalty half of the health score,
 * delegated to the component that already measures every node anyway.
 *
 * `auth` (when the caller supplies one) password-protects the mixed port, the
 * same way the relay key protects the loopback port in front of it: a listener
 * every local process can borrow is a listener that will be borrowed.
 */
export function renderMihomoConfig({ subscription, mixedPort, apiPort, secret, auth, logFile }) {
  return [
    '# Managed by dsh-our-free-model. Edits are overwritten on the next sync.',
    `mixed-port: ${mixedPort}`,
    // The outlet serves this plugin alone: a private loopback listener with no
    // LAN exposure, no system proxy and no TUN — only `egressFetch` reroutes.
    'bind-address: 127.0.0.1',
    'allow-lan: false',
    ...(auth === undefined ? [] : [
      'authentication:',
      `  - ${JSON.stringify(auth)}`,
    ]),
    'mode: rule',
    'log-level: warning',
    ...(logFile === undefined ? [] : [`log-file: ${JSON.stringify(logFile)}`]),
    `external-controller: ${RELAY_HOST}:${apiPort}`,
    `secret: ${JSON.stringify(secret)}`,
    'dns:',
    '  enable: false',
    'proxy-providers:',
    '  egress:',
    '    type: http',
    `    url: ${JSON.stringify(subscription)}`,
    '    interval: 86400',
    '    path: ./egress-provider.yaml',
    '    health-check:',
    '      enable: true',
    '      url: "http://www.gstatic.com/generate_204"',
    '      interval: 300',
    '      timeout: 5000',
    '      expected-status: 204',
    'proxy-groups:',
    '  - name: ofm-outlet',
    '    type: url-test',
    '    use:',
    '      - egress',
    '    url: "http://www.gstatic.com/generate_204"',
    '    interval: 300',
    '    tolerance: 50',
    'rules:',
    '  - MATCH,ofm-outlet',
    '',
  ].join('\n')
}

/**
 * Locate a mihomo-family binary: the explicit setting first, then PATH, then
 * the install directories of the clients that are actually common (Clash
 * Verge ships `verge-mihomo.exe` beside its GUI). No downloads here — a missing
 * binary is an error the settings page can explain, not a silent fetch.
 */
export function findMihomoBinary(explicit) {
  const given = String(explicit ?? '').trim()
  if (given !== '') {
    const stat = statOrNull(given)
    if (stat === null) throw new Error(`the mihomo path "${given}" does not exist`)
    const found = stat.isDirectory()
      ? scanMihomo([given, path.join(given, 'bin'), path.join(given, 'resources')], mihomoNames())
      : scanMihomo([path.dirname(given)], [path.basename(given)])
    if (found === null) throw new Error(`the mihomo path "${given}" holds no mihomo binary`)
    if (!found.executable) throw notExecutable(found.path)
    return found.path
  }
  const found = scanMihomo(mihomoSearchRoots(), mihomoNames())
  if (found === null) {
    throw new Error('no mihomo binary found - set its path in the egress settings (Clash Verge installs one, or get it from MetaCubeX/mihomo)')
  }
  if (!found.executable) throw notExecutable(found.path)
  return found.path
}

function mihomoNames() {
  return process.platform === 'win32'
    ? ['mihomo.exe', 'verge-mihomo.exe', 'verge-mihomo-alpha.exe', 'clash-meta.exe', 'clash.exe']
    : ['mihomo', 'clash-meta', 'clash']
}

function mihomoSearchRoots() {
  const roots = []
  for (const entry of (process.env.PATH ?? '').split(path.delimiter)) {
    if (entry.trim() !== '') roots.push(entry)
  }
  let home = ''
  try { home = os.homedir() } catch { /* no home in this environment */ }
  if (typeof home !== 'string' || !path.isAbsolute(home)) home = ''
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || (home === '' ? '' : path.join(home, 'AppData', 'Local'))
    const installs = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
    if (local !== '' && path.isAbsolute(local)) installs.push(path.join(local, 'Programs'))
    for (const root of installs) {
      if (typeof root !== 'string' || !path.isAbsolute(root)) continue
      roots.push(path.join(root, 'Clash Verge'), path.join(root, 'clash-verge'), path.join(root, 'mihomo'))
    }
    return roots
  }
  // Missing home/prefix values must not turn fallback roots into cwd searches.
  if (home !== '') roots.push(path.join(home, '.local', 'bin'), path.join(home, 'bin'))
  const prefix = String(process.env.PREFIX ?? '').trim()
  if (prefix !== '' && path.isAbsolute(prefix)) roots.push(path.join(prefix, 'bin'))
  roots.push('/usr/local/bin', '/usr/bin', '/opt/homebrew/bin')
  return roots
}

/** Keep searching past a non-executable hit, but retain its actionable error. */
function scanMihomo(dirs, names) {
  let blocked = null
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name)
      if (statOrNull(candidate)?.isFile() !== true) continue
      try {
        if (process.platform !== 'win32') fs.accessSync(candidate, fs.constants.X_OK)
        return { path: candidate, executable: true }
      } catch {
        blocked ??= candidate
      }
    }
  }
  return blocked === null ? null : { path: blocked, executable: false }
}

function statOrNull(target) {
  try { return fs.statSync(target) } catch { return null }
}

function notExecutable(target) {
  return new Error(`the mihomo at "${target}" is not executable - run: chmod +x "${target}"`)
}

/** Hostname of a URL, for display: the path of a subscription link is its credential. */
export function outletLabel(url) {
  try {
    const parsed = new URL(String(url))
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return ''
  }
}

/**
 * What the outlet is carrying traffic on right now, straight from mihomo's own
 * controller: the node its url-test picked and the delay that won it the rank.
 *
 * Returns `null` for a `client` outlet (there is no controller to ask) or while
 * url-test has not settled on a node yet. A controller that cannot answer at all
 * throws: the caller keeps its last reading rather than reporting a bare outlet.
 */
export async function readOutletSelection(relay, { timeoutMs = 4000 } = {}) {
  const managed = relay?.managed
  if (managed === null || managed === undefined) return null
  const group = await controllerJson(managed, '/proxies/ofm-outlet', timeoutMs)
  const node = typeof group?.now === 'string' ? group.now : ''
  if (node === '') return null
  // The winner's own reading is the number url-test ranked on. Nodes that came
  // from the provider are not addressable as `/proxies/<name>` (mihomo answers
  // 404 for those), so the delay is read out of the provider's own table; the
  // group's history is the last fallback, and in some builds it stays empty.
  const provider = await controllerJson(managed, '/providers/proxies/egress', timeoutMs).catch(() => null)
  const ranked = Array.isArray(provider?.proxies) ? provider.proxies.find(item => item?.name === node) : undefined
  return { node, delayMs: lastDelay(ranked) ?? lastDelay(group) ?? 0 }
}

function lastDelay(proxy) {
  const history = proxy?.history
  if (!Array.isArray(history) || history.length === 0) return undefined
  const delay = history[history.length - 1]?.delay
  return typeof delay === 'number' && delay > 0 ? delay : undefined
}

function controllerJson(managed, path, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: RELAY_HOST,
        port: managed.apiPort,
        path,
        headers: { authorization: `Bearer ${managed.secret}` },
        timeout: timeoutMs,
      },
      response => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', chunk => { body += chunk })
        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(new Error(`mihomo controller ${path} answered ${response.statusCode}`))
            return
          }
          try {
            resolve(JSON.parse(body))
          } catch {
            reject(new Error(`mihomo controller ${path} sent unparsable JSON`))
          }
        })
      },
    )
    request.on('timeout', () => request.destroy(new Error(`mihomo controller ${path} timed out`)))
    request.on('error', reject)
    request.end()
  })
}
