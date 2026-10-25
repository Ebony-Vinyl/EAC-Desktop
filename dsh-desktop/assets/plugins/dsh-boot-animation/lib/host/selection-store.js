/**
 * SelectionStore — the ONE place the user's choices live.
 *
 * `$DSH_HOME/boot-animation/selection.json` holds settings and nothing else:
 *
 *   { "version": 4, "selectedClipId": "builtin:brand",
 *     "randomPlayback": false, "fitMode": "cover", "playOnAppStart": true,
 *     "conversationOverrides": { "session-abc": "builtin:cyberpunk" } }
 *
 * `conversationOverrides` is the per-conversation layer: one session pinned to
 * one clip, on top of the global choice. It lives here rather than in a second
 * file because it is the same kind of thing the rest of the file holds — a user
 * choice — and this store is the only thing in the plugin that knows how to
 * write a settings file atomically and heal a corrupt one. A second settings
 * file would need a second copy of both.
 *
 * `playOnAppStart` (added in 0.4.2) is which of the two auto-play rules the
 * client obeys. It lives HERE, not in localStorage, on purpose: localStorage is
 * partitioned per origin, so a DSH port change would silently drop the user's
 * choice — one of the field reports behind "设置没了". Defaults to true.
 *
 * Three rules, each of which is a bug this file exists to prevent:
 *
 * 1. NO MEDIA PATHS. Earlier shapes stored an id that could be a path, so a
 *    machine-specific absolute path ended up in a file that is meant to be
 *    portable and hand-editable. A ClipId is now validated on the way in, and
 *    a path fails validation (it contains a separator) and is dropped.
 *
 * 2. A CORRUPT FILE IS NOT A STARTUP FAILURE. Any parse error, any wrong type,
 *    any unknown version resolves to defaults. The plugin must still load; the
 *    worst acceptable outcome is that the user's pick is forgotten, and that is
 *    reported through diagnostics rather than thrown.
 *
 * 3. MIGRATION IS A PURE FUNCTION. `migrate()` takes whatever was on disk and
 *    returns a valid, current-schema selection — no I/O, no globals — so it can
 *    be exercised directly by tests instead of being inferred from behaviour.
 */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { ACTIVE_ALIAS, normalizeClipId } from './clip-id.js'
import { ClipError } from './errors.js'

/** Current on-disk schema. Bump and extend `migrate` together. */
export const SELECTION_VERSION = 4

/** Fit modes the client understands; anything else falls back to the default. */
export const FIT_MODES = ['cover', 'contain']
export const DEFAULT_FIT = 'cover'

/**
 * The default for `playOnAppStart`.
 *
 * TRUE. A boot animation that only ever plays in a conversation it has not seen
 * before reads as "一次性的" — that is the field report 0.4.2 exists to fix — so
 * the default is the once-per-DSH-launch rule, and turning the toggle off is
 * what restores the old per-new-conversation behaviour.
 */
export const DEFAULT_PLAY_ON_APP_START = true

/**
 * How many per-conversation pins are kept.
 *
 * A cap exists because the key is a session id the plugin does not mint: a bug
 * or a hostile client could otherwise grow a settings file without bound. The
 * oldest key is evicted first (object key order is insertion order, and setting
 * a key again moves it to the end), so what is dropped is the least recently
 * *used* conversation rather than an arbitrary one.
 */
export const MAX_CONVERSATION_OVERRIDES = 200
const MAX_SESSION_ID_LENGTH = 200

/**
 * A session id as this store will accept it as a map key.
 *
 * The plugin never learns what a session id IS — only that the host publishes a
 * short opaque string. So this is a guard against junk (empty keys, control
 * characters, a whole path pasted in by mistake), not a parser: it trims,
 * bounds the length, and rejects anything with a control character.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeSessionId(raw) {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (value === '' || value.length > MAX_SESSION_ID_LENGTH) return null
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(value)) return null
  return value
}

/** A fresh selection. Every field is spelled out so the shape is greppable. */
export function defaultSelection() {
  return {
    version: SELECTION_VERSION,
    selectedClipId: null,
    randomPlayback: false,
    fitMode: DEFAULT_FIT,
    playOnAppStart: DEFAULT_PLAY_ON_APP_START,
    conversationOverrides: {},
  }
}

/**
 * A sessionId -> ClipId map with anything unusable dropped. Pure.
 *
 * Both sides are validated with the same rules the writers use, so a hand-edited
 * file cannot smuggle a media path (or an unusable key) into the conversation
 * layer — the same reason `selectedClipId` is validated.
 *
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
function coerceOverrides(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  /** @type {Record<string, string>} */
  const out = {}
  for (const [key, raw] of Object.entries(value)) {
    if (Object.keys(out).length >= MAX_CONVERSATION_OVERRIDES) break
    const session = normalizeSessionId(key)
    if (session === null) continue
    const id = normalizeClipId(raw)
    if (id === null || id === ACTIVE_ALIAS) continue
    out[session] = id
  }
  return out
}

function coerceFit(value) {
  return typeof value === 'string' && FIT_MODES.includes(value) ? value : DEFAULT_FIT
}

/** Strict: only a real boolean counts, and `false` is a real boolean. */
function coerceBoolean(value) {
  return value === true
}

/**
 * A tri-state on-disk boolean: `true` / `false` written by a user, or "absent".
 *
 * The default ONLY applies when the field is genuinely missing (an older file, a
 * file with a typo'd key). A stored `false` must survive as `false` — collapsing
 * it into the default is precisely the bug that would make an off toggle spring
 * back on.
 *
 * @param {unknown} value
 * @param {boolean} fallback
 */
function coerceBooleanDefault(value, fallback) {
  if (typeof value === 'boolean') return value
  return fallback
}

/**
 * Any historical or damaged shape to a valid current selection.
 *
 * Pure. Accepts:
 *   - `{ version: 4, ... }`            current (adds `playOnAppStart`)
 *   - `{ version: 3, ... }`            0.4.x: conversation layer, no app-start toggle
 *   - `{ version: 2, ... }`            0.3.x: no conversation layer yet
 *   - `{ id: "builtin:brand" }`        v1 (0.1.x - 0.2.x): the id field was bare
 *   - `{ selectedClipId: "..." }`      v2 without a version stamp
 *   - `null`, `undefined`, garbage     defaults
 *
 * Every version below 4 migrates to `playOnAppStart: true`, which is the rule
 * those versions already implemented — the field's addition is not a behaviour
 * change until the user turns it off.
 *
 * @param {unknown} raw
 * @returns {{ selection: ReturnType<typeof defaultSelection>, migrated: boolean, reason: string }}
 */
export function migrate(raw) {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return { selection: defaultSelection(), migrated: false, reason: 'no usable value on disk' }
  }
  const source = /** @type {Record<string, unknown>} */ (raw)
  const declared = typeof source.version === 'number' ? source.version : null

  // The 0.1.x/0.2.x shape: { id, at }. Kept because it is what every installed
  // copy has on disk right now, and the pick is the one thing worth carrying over.
  const legacyId = typeof source.id === 'string' ? source.id : null
  const modernId = typeof source.selectedClipId === 'string' ? source.selectedClipId : null
  const rawId = modernId ?? legacyId

  const selectedClipId = rawId === null ? null : normalizeClipId(rawId)
  const next = {
    version: SELECTION_VERSION,
    selectedClipId,
    randomPlayback: coerceBoolean(source.randomPlayback),
    fitMode: coerceFit(source.fitMode ?? source.fit),
    // Absent (any pre-0.4.2 file) -> true. A stored false stays false.
    playOnAppStart: coerceBooleanDefault(source.playOnAppStart, DEFAULT_PLAY_ON_APP_START),
    // A v2 file has no conversation layer, and "no layer" and "an empty layer"
    // mean the same thing here, so this migrates without a special case.
    conversationOverrides: coerceOverrides(source.conversationOverrides),
  }

  const migrated = declared !== SELECTION_VERSION
  const reason = migrated
    ? declared === null
      ? 'no version stamp; read as the legacy shape'
      : `version ${String(declared)} -> ${String(SELECTION_VERSION)}`
    : ''
  return { selection: next, migrated, reason }
}

/**
 * Reads, validates, migrates and writes the selection file.
 *
 * Never throws out of `read()`: a selection store that can fail a boot is
 * exactly the class of defect this refactor exists to remove.
 */
export class SelectionStore {
  /**
   * @param {string} file absolute path to selection.json
   * @param {{ diagnostics?: { event: (kind: string, detail?: unknown) => void } }} [options]
   */
  constructor(file, options = {}) {
    this.file = file
    this.diagnostics = options.diagnostics ?? null
    /** @type {{ signature: string, selection: ReturnType<typeof defaultSelection> } | null} */
    this.cache = null
  }

  /** Signature of the file's current state, or null when it does not exist. */
  #signature() {
    try {
      const stats = statSync(this.file)
      return `${String(stats.size)}@${String(Math.round(stats.mtimeMs))}`
    } catch {
      return null
    }
  }

  /**
   * The current selection. Always a valid object of the current schema.
   * @returns {ReturnType<typeof defaultSelection>}
   */
  read() {
    const signature = this.#signature()
    if (this.cache !== null && this.cache.signature === signature) return this.cache.selection
    if (signature === null) {
      // No file yet: the defaults, and do not cache a negative so the first
      // write is picked up without an invalidation dance.
      this.cache = null
      return defaultSelection()
    }

    let parsed = null
    let parseFailed = false
    try {
      parsed = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch (error) {
      parseFailed = true
      this.diagnostics?.event('selection-unreadable', { reason: String(error?.message ?? error) })
    }

    const { selection, migrated, reason } = migrate(parseFailed ? null : parsed)
    if (parseFailed) {
      this.diagnostics?.event('selection-reset', { reason: 'file could not be parsed; defaults restored' })
      // REPAIR, not just tolerate. "A corrupt file does not stop the plugin" is
      // only half the requirement; the other half is that the file comes back
      // valid, so the next read is an ordinary one and a hand-edit habit does
      // not leave the store permanently degraded.
      try {
        this.#write(selection)
      } catch (error) {
        this.diagnostics?.event('selection-reset-write-failed', { reason: String(error?.message ?? error) })
      }
    } else if (migrated) {
      this.diagnostics?.event('selection-migrated', { reason })
      // Persist the migration so the next start is a plain v2 read. A failure
      // here must not stop the plugin: the in-memory value is already correct.
      try {
        this.#write(selection)
      } catch (error) {
        this.diagnostics?.event('selection-migrate-write-failed', { reason: String(error?.message ?? error) })
      }
    }
    this.cache = { signature: this.#signature(), selection }
    return selection
  }

  /**
   * Merge a patch into the selection and persist it.
   *
   * Only known fields are accepted; an unknown key is a programming error and
   * throws a ClipError rather than silently writing junk into the file.
   *
   * @param {{ selectedClipId?: string | null, randomPlayback?: boolean, fitMode?: string, playOnAppStart?: boolean }} patch
   * @returns {ReturnType<typeof defaultSelection>}
   */
  write(patch) {
    const current = this.read()
    /** @type {ReturnType<typeof defaultSelection>} */
    const next = { ...current }
    if (Object.prototype.hasOwnProperty.call(patch, 'selectedClipId')) {
      const raw = patch.selectedClipId
      if (raw === null) next.selectedClipId = null
      else {
        const id = normalizeClipId(raw)
        if (id === null || id === 'active') {
          throw new ClipError(`selectedClipId must be a real ClipId, got: ${String(raw)}`)
        }
        next.selectedClipId = id
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'randomPlayback')) {
      next.randomPlayback = coerceBoolean(patch.randomPlayback)
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'fitMode')) {
      next.fitMode = coerceFit(patch.fitMode)
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'playOnAppStart')) {
      // A non-boolean must not silently become `true` (which would make an
      // attempted "off" look like it worked) nor `false` (which would flip the
      // default for a typo). It is a programming error, like the unknown key.
      if (typeof patch.playOnAppStart !== 'boolean') {
        throw new ClipError(`playOnAppStart must be a boolean, got: ${String(patch.playOnAppStart)}`)
      }
      next.playOnAppStart = patch.playOnAppStart
    }
    for (const key of Object.keys(patch)) {
      if (!['selectedClipId', 'randomPlayback', 'fitMode', 'playOnAppStart'].includes(key)) {
        throw new ClipError(`selection has no field "${key}"`)
      }
    }
    this.#write(next)
    this.cache = { signature: this.#signature(), selection: next }
    return next
  }

  /**
   * The clip a conversation is pinned to, or null when it has no pin.
   *
   * Returns the RAW stored id. Whether that clip still exists is the resolver's
   * question; answering it here would make this a second place that knows how to
   * fall through a stale id.
   *
   * @param {unknown} sessionId
   * @returns {string | null}
   */
  conversationOverrideOf(sessionId) {
    const session = normalizeSessionId(sessionId)
    if (session === null) return null
    const value = this.read().conversationOverrides[session]
    return typeof value === 'string' && value !== '' ? value : null
  }

  /**
   * Pin one conversation to one clip; `clipId === null` clears that pin.
   *
   * Deliberately NOT a `write()` patch. A patch language for a map is either
   * "replace the whole map" — where a caller can silently drop every other
   * conversation's pin — or "merge one key", which is the only operation anyone
   * needs. Both callers (POST /select and the tests) come through here, so the
   * validation rules live in exactly one place.
   *
   * @param {unknown} sessionId
   * @param {unknown} clipId a real ClipId, or null to clear the pin
   * @returns {string | null} the clip now pinned for that session
   */
  setConversationOverride(sessionId, clipId) {
    const session = normalizeSessionId(sessionId)
    if (session === null) {
      throw new ClipError(`sessionId must be a non-empty, control-free string, got: ${String(sessionId)}`)
    }
    const current = this.read()
    const overrides = { ...current.conversationOverrides }
    /** @type {string | null} */
    let pinned = null
    if (clipId === null) {
      delete overrides[session]
    } else {
      const id = normalizeClipId(clipId)
      if (id === null || id === ACTIVE_ALIAS) {
        throw new ClipError(`conversation override must be a real ClipId, got: ${String(clipId)}`)
      }
      // Re-insert so the key moves to the end: a conversation the user keeps
      // returning to must not be the one eviction takes.
      delete overrides[session]
      overrides[session] = id
      pinned = id
    }
    const keys = Object.keys(overrides)
    for (let index = 0; index < keys.length - MAX_CONVERSATION_OVERRIDES; index += 1) {
      delete overrides[keys[index]]
      this.diagnostics?.event('conversation-override-evicted', { session: keys[index] })
    }
    this.#commit({ ...current, conversationOverrides: overrides })
    return pinned
  }

  /**
   * Persist a fully-built selection and refresh the cache in the same step.
   *
   * The cache is refreshed from the object just written rather than by re-reading
   * the file: two writes inside one filesystem-timestamp tick compare equal by
   * signature, and the second one would serve the first one's value.
   */
  #commit(next) {
    this.#write(next)
    this.cache = { signature: this.#signature(), selection: next }
    return next
  }

  /** Atomic-ish replace: a half-written file would silently reset the pick. */
  #write(selection) {
    mkdirSync(dirname(this.file), { recursive: true })
    const payload = JSON.stringify(selection, null, 2) + '\n'
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, payload, 'utf8')
    try {
      renameSync(tmp, this.file)
    } catch {
      writeFileSync(this.file, payload, 'utf8')
    }
  }
}
