/**
 * Diagnostics — a bounded, path-free record of what the plugin decided.
 *
 * Two rules make this safe to expose:
 *
 * 1. BOUNDED. A ring buffer, so a client that retries in a loop cannot grow the
 *    host's memory. Old entries fall off.
 *
 * 2. NO ABSOLUTE PATHS. Every string that looks like a filesystem path is
 *    replaced with its basename. `/status.json` is reachable by anything that
 *    can reach this port, and the home directory is not something to hand out.
 *
 * Nothing here can throw: a diagnostics call that fails must never be the reason
 * a request fails.
 */

const DEFAULT_LIMIT = 200

/** Strip directories from anything path-shaped. */
export function redact(value) {
  if (typeof value === 'string') {
    // A Windows drive letter, a UNC prefix, or a POSIX absolute path.
    if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/')) {
      const parts = value.split(/[\\/]/).filter((part) => part !== '')
      return parts.length === 0 ? '(path)' : parts[parts.length - 1]
    }
    return value
  }
  if (Array.isArray(value)) return value.map((item) => redact(item))
  if (value !== null && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {}
    for (const [key, item] of Object.entries(value)) out[key] = redact(item)
    return out
  }
  return value
}

export class Diagnostics {
  /**
   * @param {{ limit?: number, version?: string }} [options]
   */
  constructor(options = {}) {
    this.limit = options.limit ?? DEFAULT_LIMIT
    this.version = options.version ?? '0'
    /** @type {Array<{ at: number, kind: string, detail: unknown }>} */
    this.entries = []
    this.startedAt = Date.now()
  }

  /**
   * Record one event. Never throws, never blocks.
   * @param {string} kind
   * @param {unknown} [detail]
   */
  event(kind, detail) {
    try {
      this.entries.push({ at: Date.now(), kind, detail: detail === undefined ? null : redact(detail) })
      while (this.entries.length > this.limit) this.entries.shift()
    } catch {
      /* diagnostics must never be the reason a request fails */
    }
  }

  /** A snapshot for `/status.json`. */
  snapshot() {
    return {
      version: this.version,
      uptimeMs: Date.now() - this.startedAt,
      events: this.entries.slice(-40),
    }
  }

  /** How many events are held. */
  get size() {
    return this.entries.length
  }
}
