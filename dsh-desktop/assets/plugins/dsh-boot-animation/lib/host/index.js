/**
 * dsh-boot-animation — host half.
 *
 * This file owns exactly one thing: HTTP. It builds the eight collaborators
 * (registry, resolver, selection store, media server, diagnostics, random,
 * errors) and registers the routes that expose them. It decides nothing about
 * clips itself — every "which clip" question goes through ClipResolver, every
 * byte through MediaServer.
 *
 * Plain JavaScript with no DSH SDK imports, so it needs no compiler: the build
 * copies `src/host/` over `lib/host/` and `src/host/index.js` to `lib/index.js`.
 * Node resolves the relative imports natively; there is no bundler in this half.
 *
 * Routes (all under /dsh-boot-animation):
 *
 *   GET  /media/<clipId>     the canonical, per-clip media resource
 *   GET  /boot.mp4           backward compatibility: 302 to the canonical URL
 *   GET  /resolve.json       the single "which clip plays now" answer
 *   GET  /videos.json        the library, the selection and the settings
 *   POST /select             select a clip, or change random/fit, or pin a conversation
 *   GET  /status.json        diagnostics, active clip, full listing
 *
 * `?session=<id>` on resolve/videos/status/boot.mp4 asks the per-conversation
 * question: "which clip plays in THIS conversation". Without it every answer is
 * exactly what it was before the conversation layer existed, which is what keeps
 * an already-installed client working unchanged.
 *
 * Layout on disk:
 *   $DSH_HOME/boot-animation/selection.json   settings only (see selection-store)
 *   $DSH_HOME/boot-animation/videos/*.mp4     the user's own clips
 *   $DSH_HOME/boot-animation/intro.mp4        legacy drop-in, still honoured
 *   lib/clips.meta.js + lib/clips.data.js     the embedded built-ins
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLIPS } from '../clips.meta.js'
import { ACTIVE_ALIAS, normalizeClipId } from './clip-id.js'
import { ClipRegistry } from './clip-registry.js'
import { ClipResolver } from './clip-resolver.js'
import { Diagnostics } from './diagnostics.js'
import { PluginError, asBootAnimationError } from './errors.js'
import { MediaServer } from './media-server.js'
import { RandomController } from './random-controller.js'
import { SelectionStore, normalizeSessionId } from './selection-store.js'

export const name = 'dsh-boot-animation'

/** The webserver routes are the only host service this plugin needs. */
export const inject = ['webServer']

const HERE = dirname(fileURLToPath(import.meta.url))
/** lib/host/index.js -> package root */
const PKG_ROOT = join(HERE, '..', '..')

const BASE_ROUTE = '/dsh-boot-animation'
const ROUTE = BASE_ROUTE + '/boot.mp4'
/**
 * NO trailing slash. The webserver matches a prefix route with
 *   pathname !== prefix && !pathname.startsWith(prefix + '/')
 * so a registered path of `.../media/` would be tested as `.../media//` and
 * never match a real `.../media/<id>` request — every media URL 404s.
 */
const MEDIA_ROUTE = BASE_ROUTE + '/media'
const LIST_ROUTE = BASE_ROUTE + '/videos.json'
const SELECT_ROUTE = BASE_ROUTE + '/select'
const STATUS_ROUTE = BASE_ROUTE + '/status.json'
const RESOLVE_ROUTE = BASE_ROUTE + '/resolve.json'
const DATA_MODULE = '../clips.data.js'

function readVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : '0'
  } catch {
    return '0'
  }
}

function homeDir() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'boot-animation')
}

/** The directories the user adds clips to. The plugin ships none of its own. */
function scanDirs() {
  const dir = homeDir()
  return [
    { source: 'yours', dir: join(dir, 'videos'), writable: true },
    { source: 'yours', dir, writable: true },
  ]
}

function sendJson(res, payload, status = 200) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload, null, 2))
}

/**
 * Plain-text reply, always uncacheable.
 *
 * Every failure path says `no-store`: a 404 with no cache directive is
 * heuristically cacheable, so a route that 404s once while it is broken keeps
 * 404ing in that browser after the fix.
 */
function sendText(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

/** The raw query string of a request, without the leading `?`. */
function queryOf(req) {
  const raw = typeof req.url === 'string' ? req.url : ''
  const at = raw.indexOf('?')
  return at === -1 ? '' : raw.slice(at + 1)
}

/**
 * The `?session=` parameter, or null.
 *
 * Extracted here and validated in one place (the selection store), so the
 * resolver, the listing and the select endpoint all agree on what a session key
 * is. An absent or empty parameter means "the global question", which is what
 * every caller asked before this layer existed.
 */
function sessionOf(req) {
  const value = new URLSearchParams(queryOf(req)).get('session')
  return value === null || value === '' ? null : value
}

/** One clip as the wire format has always spelled it, plus the new fields. */
function publicClip(clip, selection, extra = {}) {
  return {
    id: clip.id,
    name: clip.name,
    file: clip.file,
    ext: clip.ext,
    source: clip.source,
    kind: clip.kind,
    writable: clip.writable,
    embedded: clip.embedded ?? null,
    bytes: clip.bytes,
    mtime: clip.mtime,
    legacy: clip.legacy,
    faststart: clip.faststart === true,
    /**
     * The identity a client pins into the media URL as `?v=`.
     *
     * `clip.version()`, NOT `contentKey`: a file that never needed hashing has no
     * contentKey, and emitting null there would leave the client pinning nothing
     * while the media server compared `s<size>-t<mtime>` — a mismatch that
     * silently costs every replay a revalidation round trip.
     */
    version: clip.version(),
    /** The canonical resource for this clip. Never a shared URL. */
    mediaUrl: `${MEDIA_ROUTE}/${encodeURIComponent(clip.id)}`,
    copies: clip.copies ?? 1,
    alsoAt: clip.alsoAt ?? [],
    selected: selection.selectedClipId === clip.id,
    ...extra,
  }
}

export function apply(ctx) {
  const diagnostics = new Diagnostics({ version: readVersion() })
  const selection = new SelectionStore(join(homeDir(), 'selection.json'), { diagnostics })
  const registry = new ClipRegistry({ embedded: CLIPS, scanDirs, diagnostics })
  const random = new RandomController()
  const resolver = new ClipResolver({
    registry,
    selection,
    random,
    envPath: () => (typeof process.env.DSH_BOOT_ANIMATION === 'string' ? process.env.DSH_BOOT_ANIMATION : null),
    diagnostics,
  })
  const media = new MediaServer({ dataModulePath: DATA_MODULE, diagnostics })

  diagnostics.event('plugin-applied', { clips: CLIPS.length, cli: 'dynamic-inject' })

  /** The library listing, shared by /videos.json and /status.json. */
  const libraryPayload = (sessionId = null) => {
    const clips = registry.list()
    const { clip, how } = resolver.resolveActive(sessionId)
    const settings = selection.read()
    /**
     * The pin that is actually IN EFFECT for this conversation.
     *
     * Derived from `how` rather than read from the store, so the listing and the
     * playback decision can never disagree: a pin whose clip has been moved away
     * reports as "no pin here" in both places (and is recorded in diagnostics).
     */
    const conversationClipId = how === 'conversation' && clip !== null ? clip.id : null
    return {
      clips,
      active: clip,
      how,
      settings,
      payload: {
        // Historical field names, kept: an old client reads these.
        activeId: clip === null ? null : clip.id,
        activeHow: how,
        activeVersion: clip === null ? null : clip.version(),
        videos: clips.map((item) =>
          publicClip(item, settings, {
            active: clip !== null && item.id === clip.id,
            conversation: conversationClipId !== null && item.id === conversationClipId,
          }),
        ),
        userDir: join(homeDir(), 'videos'),
        accepts: [...new Set(['.mp4', '.m4v', '.webm', '.mov', '.mkv'])],
        // New: the settings that used to be split between localStorage and here.
        selectedClipId: settings.selectedClipId,
        randomPlayback: settings.randomPlayback,
        fitMode: settings.fitMode,
        /**
         * Which auto-play rule the client obeys.
         *
         * Deliberately part of the SETTINGS payload and not a client default: it
         * is the user's choice, it must survive a DSH port change (localStorage
         * would not), and the client's decision effect waits for this payload
         * instead of guessing.
         */
        playOnAppStart: settings.playOnAppStart,
        selectionVersion: settings.version,
        mediaRoute: MEDIA_ROUTE,
        /**
         * The per-conversation layer, as it applies to the caller.
         *
         * Only THIS session's pin is published — never the whole map. The client
         * has no use for other conversations' ids, and a settings file that leaks
         * every session id a user ever pinned is a worse shape than one that
         * answers the question actually asked.
         */
        conversationClipId,
        conversationOverrideCount: Object.keys(settings.conversationOverrides).length,
        sessionKnown: sessionId !== null,
      },
    }
  }

  const serveList = (req, res) => {
    try {
      sendJson(res, libraryPayload(sessionOf(req)).payload)
    } catch (cause) {
      const error = asBootAnimationError(cause, 'plugin', 'serving the library')
      diagnostics.event('library-error', { message: error.message })
      sendJson(res, { ok: false, error: 'library unavailable', boundary: error.boundary }, 500)
    }
  }

  const serveStatus = (req, res) => {
    try {
      const { payload } = libraryPayload(sessionOf(req))
      sendJson(res, {
        active: payload.activeId,
        activeHow: payload.activeHow,
        activeVersion: payload.activeVersion,
        count: payload.videos.length,
        selectedClipId: payload.selectedClipId,
        randomPlayback: payload.randomPlayback,
        fitMode: payload.fitMode,
        playOnAppStart: payload.playOnAppStart,
        conversationClipId: payload.conversationClipId,
        conversationOverrideCount: payload.conversationOverrideCount,
        /**
         * How many embedded clips are currently decoded in memory.
         *
         * Reported because "the plugin must not decode all four clips at
         * install" is otherwise unobservable from outside — and an install-time
         * stall is exactly the kind of regression that no unit test notices.
         * `verify-install.mjs` asserts it is 0 before any media request and 1
         * after one clip is fetched.
         */
        decodedClips: media.decoded.size,
        videos: payload.videos,
        diagnostics: diagnostics.snapshot(),
      })
    } catch (cause) {
      const error = asBootAnimationError(cause, 'plugin', 'serving status')
      sendJson(res, { ok: false, error: 'status unavailable', boundary: error.boundary }, 500)
    }
  }

  /**
   * The single answer to "which clip plays now".
   *
   * With `?session=` and a pin in place, that conversation's clip answers first;
   * otherwise `mode=active` respects random (when enabled) → selection → env →
   * legacy drop-in → library → embedded. `mode=random` asks for a random pick
   * outright and is deliberately NEVER answered by a pin — the caller asked for a
   * random clip, and a pin is a request for a specific one. `mode=selected`
   * returns the user's choice for this conversation (its pin, else the stored
   * selection, else null). Everything downstream plays the returned clipId
   * through ONE media path.
   */
  const serveResolve = (req, res) => {
    try {
      const mode = new URLSearchParams(queryOf(req)).get('mode') ?? 'active'
      const sessionId = sessionOf(req)
      if (mode === 'selected') {
        const pinned = resolver.conversationPick(sessionId)
        const id = pinned === null ? selection.read().selectedClipId : pinned.id
        const clip = id === null ? null : registry.get(id)
        sendJson(res, {
          clipId: clip === null ? null : clip.id,
          version: clip === null ? null : clip.version(),
          how: clip === null ? 'none' : pinned === null ? 'selected' : 'conversation',
          mediaUrl: clip === null ? null : `${MEDIA_ROUTE}/${encodeURIComponent(clip.id)}`,
        })
        return
      }
      if (mode === 'random') {
        const pool = resolver.playable()
        const chosen = random.pick(pool)
        sendJson(res, {
          clipId: chosen === null ? null : chosen.id,
          version: chosen === null ? null : chosen.version(),
          how: chosen === null ? 'none' : 'random',
          poolSize: pool.length,
          mediaUrl: chosen === null ? null : `${MEDIA_ROUTE}/${encodeURIComponent(chosen.id)}`,
        })
        return
      }
      const { clip, how } = resolver.resolveActive(sessionId)
      sendJson(res, {
        clipId: clip === null ? null : clip.id,
        version: clip === null ? null : clip.version(),
        how,
        sessionScoped: how === 'conversation',
        mediaUrl: clip === null ? null : `${MEDIA_ROUTE}/${encodeURIComponent(clip.id)}`,
      })
    } catch (cause) {
      const error = asBootAnimationError(cause, 'plugin', 'resolving the active clip')
      diagnostics.event('resolve-error', { message: error.message })
      sendJson(res, { clipId: null, how: 'error', boundary: error.boundary }, 500)
    }
  }

  /** `POST /select` — the user's choice, and nothing but the choice. */
  const handleSelect = (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, { ok: false, error: 'POST required' }, 405)
      return
    }
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 8192) req.destroy()
    })
    req.on('end', () => {
      let parsed = null
      try {
        parsed = JSON.parse(body)
      } catch {
        sendJson(res, { ok: false, error: 'invalid JSON body' }, 400)
        return
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        sendJson(res, { ok: false, error: 'body must be an object' }, 400)
        return
      }
      /**
       * `scope: 'conversation'` writes the per-conversation layer instead of the
       * global settings. Anything else (including no scope at all) is the
       * original global write, byte for byte.
       */
      const scope = typeof parsed.scope === 'string' ? parsed.scope : 'global'
      if (scope === 'conversation') {
        const sessionId = normalizeSessionId(parsed.sessionId)
        if (sessionId === null) {
          sendJson(res, { ok: false, error: 'scope=conversation needs a usable sessionId' }, 400)
          return
        }
        const requested = Object.prototype.hasOwnProperty.call(parsed, 'selectedClipId')
          ? parsed.selectedClipId
          : Object.prototype.hasOwnProperty.call(parsed, 'id')
            ? parsed.id
            : undefined
        if (requested === undefined) {
          sendJson(res, { ok: false, error: 'scope=conversation needs id (or selectedClipId); null clears the pin' }, 400)
          return
        }
        const clearing = requested === null || requested === ''
        const id = clearing ? null : normalizeClipId(requested)
        if (id === null && !clearing) {
          sendJson(res, { ok: false, error: 'conversation override must be a real ClipId' }, 400)
          return
        }
        if (id === ACTIVE_ALIAS) {
          sendJson(res, { ok: false, error: 'conversation override must be a real ClipId' }, 400)
          return
        }
        if (id !== null && registry.get(id) === null) {
          sendJson(res, { ok: false, error: 'no clip with that id' }, 404)
          return
        }
        try {
          const pinned = selection.setConversationOverride(sessionId, id)
          diagnostics.event('conversation-override-written', { sessionId, clipId: pinned })
          registry.invalidate()
          sendJson(res, {
            ok: true,
            scope: 'conversation',
            conversationClipId: pinned,
            name: pinned === null ? null : (registry.get(pinned)?.name ?? null),
          })
        } catch (cause) {
          const error = asBootAnimationError(cause, 'clip', 'saving the conversation override')
          diagnostics.event('conversation-override-write-failed', { message: error.message })
          sendJson(res, { ok: false, error: error.message, boundary: error.boundary }, 500)
        }
        return
      }
      if (scope !== 'global') {
        sendJson(res, { ok: false, error: `unknown scope "${scope}"` }, 400)
        return
      }

      /** @type {Record<string, unknown>} */
      const patch = {}
      // `id` is the 0.1.x/0.2.x spelling; keep accepting it.
      if (Object.prototype.hasOwnProperty.call(parsed, 'selectedClipId')) patch.selectedClipId = parsed.selectedClipId
      else if (Object.prototype.hasOwnProperty.call(parsed, 'id')) patch.selectedClipId = parsed.id
      if (Object.prototype.hasOwnProperty.call(parsed, 'randomPlayback')) patch.randomPlayback = parsed.randomPlayback
      if (Object.prototype.hasOwnProperty.call(parsed, 'fitMode')) patch.fitMode = parsed.fitMode
      // The app-start toggle travels the same path as every other setting, so it
      // is written atomically and with the same validation as the rest.
      if (Object.prototype.hasOwnProperty.call(parsed, 'playOnAppStart')) patch.playOnAppStart = parsed.playOnAppStart

      if (Object.keys(patch).length === 0) {
        sendJson(res, { ok: false, error: 'nothing to change' }, 400)
        return
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'selectedClipId')) {
        const id = normalizeClipId(patch.selectedClipId)
        if (id === null || id === ACTIVE_ALIAS) {
          sendJson(res, { ok: false, error: 'selectedClipId must be a real ClipId' }, 400)
          return
        }
        if (registry.get(id) === null) {
          sendJson(res, { ok: false, error: 'no clip with that id' }, 404)
          return
        }
        patch.selectedClipId = id
      }
      try {
        const next = selection.write(/** @type {any} */ (patch))
        diagnostics.event('selection-written', { ...patch, selectedClipId: next.selectedClipId })
        // The listing changed under us: drop the cached scan so the next read
        // reports the new state rather than the previous answer.
        registry.invalidate()
        sendJson(res, {
          ok: true,
          selectedClipId: next.selectedClipId,
          randomPlayback: next.randomPlayback,
          fitMode: next.fitMode,
          playOnAppStart: next.playOnAppStart,
          name: next.selectedClipId === null ? null : (registry.get(next.selectedClipId)?.name ?? null),
        })
      } catch (cause) {
        const error = asBootAnimationError(cause, 'clip', 'saving the selection')
        diagnostics.event('selection-write-failed', { message: error.message })
        sendJson(res, { ok: false, error: error.message, boundary: error.boundary }, 500)
      }
    })
    req.on('error', () => {
      try {
        sendJson(res, { ok: false, error: 'request error' }, 400)
      } catch {
        /* socket already gone */
      }
    })
  }

  /** `GET /media/<clipId>` — the canonical resource. One clip, one identity. */
  const serveMedia = (req, res) => {
    const raw = typeof req.url === 'string' ? req.url : ''
    const path = raw.split('?')[0]
    const id = path.length > MEDIA_ROUTE.length + 1 ? decodeURIComponent(path.slice(MEDIA_ROUTE.length + 1)) : ''
    const clip = id === '' ? null : resolver.resolve(id)?.clip ?? null
    if (clip === null) {
      sendText(res, 404, 'dsh-boot-animation: no such clip id')
      return
    }
    void media.serve(req, res, clip)
  }

  /**
   * `GET /boot.mp4` — backward compatibility ONLY.
   *
   * It redirects to the canonical per-clip URL instead of serving bytes under a
   * shared name. That is what removes the stale-cache hazard for any client that
   * still asks for it: the bytes always come from a URL that identifies one clip.
   */
  const serveBoot = (req, res) => {
    try {
      const { clip } = resolver.resolveActive(sessionOf(req))
      if (clip === null) {
        sendText(
          res,
          404,
          'dsh-boot-animation: no clip found (drop an .mp4 into ' +
            join(homeDir(), 'videos') +
            ', set DSH_BOOT_ANIMATION, or add $DSH_HOME/boot-animation/intro.mp4)',
        )
        return
      }
      const version = clip.version()
      const location =
        `${MEDIA_ROUTE}/${encodeURIComponent(clip.id)}` + (version === null ? '' : `?v=${encodeURIComponent(version)}`)
      diagnostics.event('legacy-redirect', { id: clip.id })
      res.writeHead(302, { location, 'cache-control': 'no-store' })
      res.end()
    } catch (cause) {
      const error = asBootAnimationError(cause, 'plugin', 'redirecting the legacy route')
      diagnostics.event('legacy-route-error', { message: error.message })
      sendText(res, 500, 'dsh-boot-animation: could not resolve a clip')
    }
  }

  // A failure while REGISTERING is the plugin boundary: report it and stop,
  // never let it escape into the host boot.
  try {
    ctx.effect(
      () => ctx.webServer.register({ kind: 'prefix', path: MEDIA_ROUTE, handler: serveMedia }),
      'dsh-boot-animation: clip media',
    )
    ctx.effect(
      () => ctx.webServer.register({ kind: 'prefix', path: ROUTE, handler: serveBoot }),
      'dsh-boot-animation: legacy boot url',
    )
    ctx.effect(
      () => ctx.webServer.register({ kind: 'prefix', path: RESOLVE_ROUTE, handler: serveResolve }),
      'dsh-boot-animation: resolve',
    )
    ctx.effect(
      () => ctx.webServer.register({ kind: 'prefix', path: LIST_ROUTE, handler: serveList }),
      'dsh-boot-animation: library',
    )
    ctx.effect(
      () => ctx.webServer.register({ kind: 'prefix', path: SELECT_ROUTE, handler: handleSelect }),
      'dsh-boot-animation: select',
    )
    ctx.effect(
      () => ctx.webServer.register({ kind: 'prefix', path: STATUS_ROUTE, handler: serveStatus }),
      'dsh-boot-animation: status',
    )
  } catch (cause) {
    const error = cause instanceof PluginError ? cause : new PluginError(`route registration failed: ${String(cause)}`)
    diagnostics.event('plugin-failed', { message: error.message })
    throw error
  }
}
