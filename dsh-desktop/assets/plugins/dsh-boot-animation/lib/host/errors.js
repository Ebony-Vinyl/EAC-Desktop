/**
 * Error boundaries.
 *
 * Five boundaries, and the whole point is that they never contaminate each
 * other. A broken clip must not read as a plugin failure; a media read failure
 * must not stop the plugin from loading; a UI mistake must not take the DSH GUI
 * with it.
 *
 *   plugin   the plugin cannot initialise at all (routes unregistered)
 *   clip     one clip entry is unusable (missing file, bad metadata)
 *   media    bytes for one clip could not be produced (decode/read/range)
 *   playback one playback attempt failed (client side; same vocabulary here so
 *            the diagnostics ring reads the same from both halves)
 *   ui       a React render/interaction failed (client side)
 *
 * Every error carries its boundary so `diagnostics` can report it without
 * guessing, and so a caller can decide what to degrade.
 */

/** Base class; `boundary` is what makes an error reportable without a stack scan. */
export class BootAnimationError extends Error {
  /** @param {string} message @param {{ cause?: unknown, detail?: unknown }} [options] */
  constructor(message, options = {}) {
    super(message)
    this.name = 'BootAnimationError'
    /** @type {string} */
    this.boundary = 'plugin'
    this.detail = options.detail ?? null
    if (options.cause !== undefined) this.cause = options.cause
  }
}

export class PluginError extends BootAnimationError {
  constructor(message, options) {
    super(message, options)
    this.name = 'PluginError'
    this.boundary = 'plugin'
  }
}

export class ClipError extends BootAnimationError {
  constructor(message, options) {
    super(message, options)
    this.name = 'ClipError'
    this.boundary = 'clip'
  }
}

export class MediaError extends BootAnimationError {
  constructor(message, options) {
    super(message, options)
    this.name = 'MediaError'
    this.boundary = 'media'
  }
}

export class PlaybackError extends BootAnimationError {
  constructor(message, options) {
    super(message, options)
    this.name = 'PlaybackError'
    this.boundary = 'playback'
  }
}

export class UiError extends BootAnimationError {
  constructor(message, options) {
    super(message, options)
    this.name = 'UiError'
    this.boundary = 'ui'
  }
}

/** The boundary an unknown throw belongs to, for reporting. */
export function boundaryOf(error) {
  return error instanceof BootAnimationError ? error.boundary : 'plugin'
}

/**
 * One error as a flat record, safe to serialise into a JSON response.
 *
 * Never includes a filesystem path: `/status.json` is reachable by anything that
 * can reach this port, and an absolute path leaks the home directory.
 */
export function toDiagnostic(error) {
  return {
    boundary: boundaryOf(error),
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
  }
}

/**
 * Run `fn`, converting an unexpected throw into a boundary-tagged result.
 *
 * Used at the edges (a route handler, a UI render) where an exception would
 * otherwise escape into the host and look like a plugin-wide failure.
 *
 * @template T
 * @param {() => T} fn
 * @param {string} boundary
 * @param {string} what
 * @returns {{ ok: true, value: T } | { ok: false, error: BootAnimationError }}
 */
export function guard(fn, boundary, what) {
  try {
    return { ok: true, value: fn() }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    const error =
      boundary === 'clip'
        ? new ClipError(`${what}: ${message}`, { cause })
        : boundary === 'media'
          ? new MediaError(`${what}: ${message}`, { cause })
          : boundary === 'playback'
            ? new PlaybackError(`${what}: ${message}`, { cause })
            : boundary === 'ui'
              ? new UiError(`${what}: ${message}`, { cause })
              : new PluginError(`${what}: ${message}`, { cause })
    return { ok: false, error }
  }
}

/** Narrow a caught value to a boundary-tagged error. */
export function asBootAnimationError(cause, boundary, what) {
  if (cause instanceof BootAnimationError) return cause
  return guard(
    () => {
      throw cause
    },
    boundary,
    what,
  ).error
}
