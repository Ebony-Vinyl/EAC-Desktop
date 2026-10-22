/**
 * LAN relay for the absorbed channels' OpenAI gateway.
 *
 * The vendored channel pack serves every 白嫖 provider through one
 * OpenAI-compatible gateway, but it always binds the loopback — a deliberate
 * upstream choice this plugin keeps. What the settings page promises in
 * exchange is a relay of our own: a second listener, bound wherever the user
 * points it, that forwards to that loopback gateway under *this plugin's* key.
 *
 * The split of keys is the whole security model:
 * - callers authenticate with `settings.chanGateway.relay.key` (this plugin
 *   generates, shows and rotates it);
 * - the pack's gateway key never leaves the host process — it is read from the
 *   gateway's own credential file (or its env override) only to be attached to
 *   the forwarded hop, and is never served to any client of this relay;
 * - a hop marker refuses request loops (a relay pointed at its own port).
 *
 * Path allowlist mirrors what the gateway itself serves; anything else is a
 * 404 before a single byte is forwarded.
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'
import { keyMatches } from './forward.js'

/** Request loop breaker: present on hops this relay already forwarded once. */
const HOP_HEADER = 'x-ofm-chan-relay-hop'

/** The gateway's own surface — nothing else is forwarded. */
const FORWARDED_PATHS = new Set([
  '/v1/models',
  '/v1/chat/completions',
  '/v1/responses',
  '/v1/reasoning-efforts',
])

const corsHeaders = () => ({
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, x-api-key',
})

function openAiError(res, status, code, message) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ error: { message, type: code, code } }))
}

/** Match the vendored resolveChannelPackHome order, without moving OFM's data. */
export function chanGatewayHome({ profileContext, env = process.env } = {}) {
  const override = String(env.DSH_CHANNEL_PACK_STATE_DIR ?? '').trim()
  if (override !== '') return override
  if (typeof profileContext?.home === 'string' && profileContext.home.length > 0) return profileContext.home
  const envHome = String(env.DSH_HOME ?? '').trim()
  return envHome || path.join(homedir(), '.dsh')
}

/**
 * The gateway's API-key env override outranks its credential file. An absent
 * key returns null so the relay fails closed with 503. Explicit home is kept
 * as a test/embedding seam; normal callers pass the current profileContext.
 */
export function chanGatewayCredential({ home, profileContext, env = process.env }) {
  const fromEnv = String(env.DSH_OPENAI_GATEWAY_API_KEY ?? '').trim()
  if (fromEnv !== '') return { key: fromEnv, fromEnv: true, path: null }
  const directory = path.join(home ?? chanGatewayHome({ profileContext, env }), 'openai-gateway')
  const file = path.join(directory, 'api-key')
  try {
    const stored = fs.readFileSync(file, 'utf8').trim()
    if (stored !== '') return { key: stored, fromEnv: false, path: file }
  } catch { /* never generated yet */ }
  return null
}

/** The gateway's port, env-overridable the same way the gateway reads it. */
export function chanGatewayPort(env = process.env) {
  const raw = String(env.DSH_OPENAI_GATEWAY_PORT ?? '').trim()
  if (raw === '') return 8326
  const port = Number.parseInt(raw, 10)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 8326
}

/**
 * The gateway's own switch. Same normalization rule as the gateway: only an
 * explicit false-y string disables, because `parseInt('0') || 1`-style parses
 * are how switches end up that cannot be turned off.
 */
export function chanGatewayEnabled(env = process.env) {
  const raw = String(env.DSH_OPENAI_GATEWAY_ENABLED ?? '').trim().toLowerCase()
  if (raw === '') return true
  return raw !== '0' && raw !== 'false' && raw !== 'off' && raw !== 'no'
}

/**
 * Bind the relay. `config()` is read per request, so a settings save applies
 * without a rebind (except host/port, which the caller rebinds for).
 */
export async function startChanRelay({ config, log = () => {} }) {
  const server = http.createServer((req, res) => {
    void relay(req, res).catch(error => {
      log(`relay request failed: ${error?.message ?? error}`)
      if (!res.headersSent) openAiError(res, 502, 'server_error', String(error?.message ?? error))
      else res.end()
    })
  })

  async function relay(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const routePath = url.pathname.replace(/\/+$/, '') || '/'
    // A browser cannot put a key on a preflight, and answering one spends nothing.
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders())
      res.end()
      return
    }
    const settings = config()
    if (!settings.enabled) {
      openAiError(res, 503, 'service_unavailable', 'the channel-gateway relay is switched off in Our Free Model settings')
      return
    }
    if (!keyMatches(bearerOf(req), settings.lanKey)) {
      openAiError(res, 401, 'invalid_request_error', 'missing or invalid relay key')
      return
    }
    if (req.headers[HOP_HEADER] !== undefined) {
      openAiError(res, 508, 'server_error', 'the relay would be dialing itself — give it a port of its own')
      return
    }
    if (!FORWARDED_PATHS.has(routePath)) {
      openAiError(res, 404, 'not_found_error', `no route for ${req.method} ${routePath}`)
      return
    }
    if (typeof settings.gatewayKey !== 'string' || settings.gatewayKey === '') {
      openAiError(res, 503, 'service_unavailable', 'the channel gateway has no credential yet — open it once from the gateway page, then retry')
      return
    }
    const headers = { ...req.headers }
    delete headers.host
    delete headers.connection
    delete headers['x-api-key']
    // The caller's relay key stops at this door; the gateway only ever sees
    // the key that belongs to this machine.
    headers.authorization = `Bearer ${settings.gatewayKey}`
    headers[HOP_HEADER] = '1'
    const target = http.request({
      host: settings.gatewayHost || '127.0.0.1',
      port: settings.gatewayPort,
      method: req.method,
      path: `${routePath}${url.search}`,
      headers,
    })
    target.on('response', upstream => {
      const relayed = { ...upstream.headers }
      delete relayed.connection
      delete relayed['keep-alive']
      delete relayed['transfer-encoding']
      res.writeHead(upstream.statusCode ?? 502, relayed)
      upstream.pipe(res)
    })
    target.on('error', error => {
      log(`upstream failed: ${error?.message ?? error}`)
      if (!res.headersSent) openAiError(res, 502, 'server_error', 'the channel gateway did not answer (is it enabled?)')
      else res.end()
    })
    // A caller that walks away takes its upstream request with it.
    res.once('close', () => {
      if (!res.writableEnded) target.destroy()
    })
    req.pipe(target)
  }

  function bearerOf(req) {
    const header = String(req.headers.authorization ?? '')
    return header.startsWith('Bearer ') ? header.slice(7).trim() : String(req.headers['x-api-key'] ?? '')
  }

  // The bind comes from the caller's snapshot of the settings: a changed
  // host/port is applied by closing and starting again (see the plugin's
  // sync), while everything else is read per request through `config()`.
  const boot = config()
  const host = String(boot.host ?? '').trim() || '127.0.0.1'
  const wantedPort = Number.isFinite(Number(boot.port)) && Number(boot.port) > 0 ? Math.trunc(Number(boot.port)) : 0
  const address = await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(wantedPort, host, () => resolve(server.address()))
  })
  return {
    host: address?.address ?? host,
    port: address?.port ?? 0,
    async close() { await new Promise(resolve => server.close(resolve)) },
  }
}
