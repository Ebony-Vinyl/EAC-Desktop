/**
 * ClipRegistry — every playable clip, discovered lazily and never by index.
 *
 * The 0.2.x host recomputed this list on every HTTP request, hashed EVERY user
 * file with sha256 (a full read of each one) and — on the first embedded request
 * — base64-decoded all four built-in clips at once. That is three stalls in the
 * install/first-load path, which is why this class exists.
 *
 * What changed, and why each change is safe:
 *
 * 1. THE SCAN IS CACHED. A signature over the scan directories (entry names plus
 *    each entry's size and mtime) invalidates it, so dropping a file in still
 *    takes effect without a restart — but one page load that hits
 *    `/videos.json`, `/boot.mp4` and `/status.json` scans once, not three times.
 *
 * 2. HASHING IS COLLISION-GATED. The content hash has exactly two jobs: proving
 *    two entries are the same video (so one row is shown), and giving the bytes a
 *    stable identity. Only the first needs a real hash, and it is only needed
 *    when two entries could possibly be equal — i.e. when their sizes match. A
 *    lone 2GB file is therefore never read at all. Entries that never collide
 *    keep a cheap `s<size>-t<mtime>` identity, which changes whenever the bytes
 *    do, so cache-busting stays exact.
 *
 * 3. A BROKEN ENTRY IS A CLIP ERROR, NOT A LISTING FAILURE. One unreadable file
 *    is skipped and reported; the other clips still list.
 *
 * Embedded clips are metadata-only here (id, name, bytes, sha256 from
 * `clips.meta.js`). Their bytes are never touched by this file — see
 * `media-server.js`, which decodes ONE clip on demand.
 */
import { createHash } from 'node:crypto'
import { closeSync, openSync, readSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { embeddedClipId, fileClipId } from './clip-id.js'
import { ClipError, asBootAnimationError } from './errors.js'

/** Extensions treated as video for listing purposes. */
export const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.mov', '.mkv'])

/**
 * Which copy survives when the same content exists in more than one place.
 * Lower wins, so the plugin's own copy beats a user's duplicate: the embedded
 * one cannot be deleted, so a selection pointing at it always resolves.
 */
const SOURCE_RANK = { embedded: 0, yours: 2, env: 3 }

/** Display order in the picker: built-ins first, the user's after. */
const LIST_RANK = { embedded: 0, yours: 2, env: 3 }

/** How much of a file to peek at when asking whether `moov` is in front. */
const FASTSTART_HEAD = 65536

/** Upper bound on adopted (out-of-directory) clips kept addressable. */
const ADOPTED_LIMIT = 16

const VIDEO_LIKE_EXT = new Set(['.mp4', '.m4v'])

/**
 * Whether the `moov` atom sits in the head of the file.
 *
 * The difference between a video that paints immediately and one that shows
 * nothing until the whole file has been fetched. One 64KB read, never a full
 * read, and only asked of containers that can carry `moov` — a `.webm` has none,
 * so reporting `false` for it would be a lie.
 */
function hasFaststart(filePath) {
  let fd = null
  try {
    fd = openSync(filePath, 'r')
    const buffer = Buffer.alloc(FASTSTART_HEAD)
    const read = readSync(fd, buffer, 0, FASTSTART_HEAD, 0)
    const head = buffer.subarray(0, read).toString('latin1')
    const moov = head.indexOf('moov')
    if (moov === -1) return false
    const mdat = head.indexOf('mdat')
    return mdat === -1 || moov < mdat
  } catch {
    return false
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        /* already closed */
      }
    }
  }
}

/** sha256 of a file's bytes, truncated. The expensive one — collision-gated. */
function hashFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex').slice(0, 16)
}

function statFile(p) {
  try {
    const stats = statSync(p)
    return stats.isFile() && stats.size > 0 ? stats : null
  } catch {
    return null
  }
}

/**
 * The clip record. Field names are the public ones the list route already
 * serves, so the wire format does not change underneath existing clients.
 */
class Clip {
  constructor(fields) {
    Object.assign(this, fields)
    /** @type {string | null} lazily resolved content hash */
    this.contentHash = null
    /** @type {string | null} */
    this.contentKey = fields.contentKey ?? null
  }

  /** The identity a client pins into a media URL. Cheap when no hash is needed. */
  version() {
    if (this.contentKey !== null) return this.contentKey
    return `s${String(this.bytes)}-t${String(Math.round(this.mtimeMs))}`
  }
}

export class ClipRegistry {
  /**
   * @param {object} options
   * @param {Array<{ id: string, name: string, ext: string, bytes: number, sha256: string }>} options.embedded
   * @param {() => Array<{ source: string, dir: string, writable: boolean }>} options.scanDirs
   * @param {{ event: (kind: string, detail?: unknown) => void } | null} [options.diagnostics]
   */
  constructor(options) {
    this.embeddedMeta = options.embedded
    this.scanDirs = options.scanDirs
    this.diagnostics = options.diagnostics ?? null
    /** @type {{ signature: string, clips: Clip[] } | null} */
    this.cache = null
    /**
     * Clips adopted from outside the managed directories, by id.
     *
     * `adopt()` exists for DSH_BOOT_ANIMATION, and an adopted clip must be
     * SERVABLE by its id — not merely resolvable as "active". Without this map
     * `/media/<env-id>` 404s while `/resolve.json` happily returns that same id,
     * which is a broken URL the client would faithfully ask for. Bounded, because
     * the env variable can be pointed at anything.
     */
    /** @type {Map<string, Clip>} */
    this.adopted = new Map()
  }

  /** Cheap signature: directory mtimes only. Invalidation, not enumeration. */
  #dirSignature(dirs) {
    const parts = []
    for (const { dir } of dirs) {
      try {
        const stats = statSync(dir)
        parts.push(`${dir}:${String(Math.round(stats.mtimeMs))}:${String(stats.size)}`)
      } catch {
        parts.push(`${dir}:-`)
      }
    }
    return parts.join('|')
  }

  /** The built-in clips. Metadata only — no bytes, no base64, no decode. */
  #embeddedClips() {
    return this.embeddedMeta.map(
      (clip) =>
        new Clip({
          id: embeddedClipId(clip.id),
          name: clip.name,
          kind: 'embedded',
          source: 'embedded',
          ext: clip.ext,
          file: null,
          path: null,
          writable: false,
          bytes: clip.bytes,
          mtimeMs: 0,
          mtime: null,
          legacy: false,
          // Guaranteed at embed time: scripts/embed-clips.mjs refuses a clip
          // whose moov is not already in front.
          faststart: true,
          embedded: clip.id,
          // Free: the metadata already carries the real sha256.
          contentKey: clip.sha256,
          contentHash: clip.sha256,
          copies: 1,
          alsoAt: [],
        }),
    )
  }

  /** File clips from the managed directories. Skips what it cannot stat. */
  #fileClips(dirs, seenPaths) {
    const clips = []
    for (const { source, dir, writable } of dirs) {
      let names = []
      try {
        names = readdirSync(dir)
      } catch {
        continue
      }
      for (const fileName of names) {
        const ext = extname(fileName).toLowerCase()
        if (!VIDEO_EXT.has(ext)) continue
        const full = join(dir, fileName)
        const normalised = full.replace(/\\/g, '/').toLowerCase()
        if (seenPaths.has(normalised)) continue
        seenPaths.add(normalised)
        const stats = statFile(full)
        if (stats === null) {
          this.diagnostics?.event('clip-unreadable', { name: fileName })
          continue
        }
        try {
          clips.push(
            new Clip({
              id: fileClipId(full),
              name: basename(fileName, extname(fileName)),
              kind: 'file',
              source,
              ext,
              file: fileName,
              path: full,
              writable,
              bytes: stats.size,
              mtimeMs: stats.mtimeMs,
              mtime: new Date(stats.mtimeMs).toISOString(),
              legacy: fileName.toLowerCase() === 'intro.mp4',
              faststart: VIDEO_LIKE_EXT.has(ext) ? hasFaststart(full) : false,
              embedded: null,
              contentKey: null,
              copies: 1,
              alsoAt: [],
            }),
          )
        } catch (cause) {
          const error = asBootAnimationError(cause, 'clip', `listing ${fileName}`)
          this.diagnostics?.event('clip-error', { name: fileName, message: error.message })
        }
      }
    }
    return clips
  }

  /**
   * Collapse entries that are the same video.
   *
   * The hash is only computed for size-collision groups. Two entries can only be
   * equal if their sizes are, so a file with a unique size proves itself distinct
   * for free — and that is the common case.
   */
  #collapseByContent(clips) {
    const bySize = new Map()
    for (const clip of clips) {
      const group = bySize.get(clip.bytes)
      if (group === undefined) bySize.set(clip.bytes, [clip])
      else group.push(clip)
    }

    for (const [size, group] of bySize) {
      if (group.length < 2) continue
      this.diagnostics?.event('content-hash-group', { size, entries: group.length })
      for (const clip of group) {
        try {
          clip.contentHash = clip.kind === 'embedded' ? clip.contentKey : hashFile(clip.path)
        } catch (cause) {
          const error = asBootAnimationError(cause, 'clip', `hashing ${clip.name}`)
          this.diagnostics?.event('clip-error', { name: clip.name, message: error.message })
          // Distinct-by-fiat: an unreadable file must not merge into another row.
          clip.contentHash = `unreadable:${clip.id}`
        }
      }
    }

    const byContent = new Map()
    for (const clip of clips) {
      const key = clip.contentHash ?? `unique:${clip.id}`
      const kept = byContent.get(key)
      if (kept === undefined) {
        byContent.set(key, clip)
        continue
      }
      const incomingWins = (SOURCE_RANK[clip.source] ?? 9) < (SOURCE_RANK[kept.source] ?? 9)
      const winner = incomingWins ? clip : kept
      const loser = incomingWins ? kept : clip
      winner.copies += loser.copies
      winner.alsoAt.push(loser.source, ...loser.alsoAt)
      byContent.set(key, winner)
    }
    return [...byContent.values()]
  }

  /** Order: built-ins in their embedded order, then the user's newest first. */
  #order(clips) {
    const embeddedOrder = new Map(this.embeddedMeta.map((clip, index) => [embeddedClipId(clip.id), index]))
    return clips.sort((a, b) => {
      const bySource = (LIST_RANK[a.source] ?? 9) - (LIST_RANK[b.source] ?? 9)
      if (bySource !== 0) return bySource
      // Name lookup, never a positional index into the live list.
      if (a.source === 'embedded' && b.source === 'embedded') {
        return (embeddedOrder.get(a.id) ?? 0) - (embeddedOrder.get(b.id) ?? 0)
      }
      return b.mtimeMs - a.mtimeMs
    })
  }

  /**
   * Every distinct clip, cheapest correct answer.
   *
   * @param {{ force?: boolean }} [options]
   * @returns {Clip[]}
   */
  list(options = {}) {
    const dirs = this.scanDirs()
    const signature = this.#dirSignature(dirs)
    if (options.force !== true && this.cache !== null && this.cache.signature === signature) {
      return this.cache.clips
    }
    const seenPaths = new Set()
    const clips = this.#collapseByContent([
      ...this.#embeddedClips(),
      ...this.#fileClips(dirs, seenPaths),
    ])
    const ordered = this.#order(clips)
    this.cache = { signature, clips: ordered }
    this.diagnostics?.event('registry-scan', { clips: ordered.length })
    return ordered
  }

  /**
   * One clip by id, or null. Never throws on a bad id.
   * @param {string | null | undefined} id
   */
  get(id) {
    if (typeof id !== 'string') return null
    const listed = this.list().find((clip) => clip.id === id)
    if (listed !== undefined) return listed
    // An adopted clip is not in the scanned list, but it is still a real clip
    // with a real id, so it must be findable here or its media URL would 404.
    return this.adopted.get(id) ?? null
  }

  /**
   * Turn one file outside the managed directories into a clip.
   *
   * Used for `DSH_BOOT_ANIMATION`, which points wherever the user likes. It is
   * deliberately NOT added to the cached listing: the listing is "what is in the
   * managed directories", and a one-off path is not part of that inventory.
   *
   * @param {string} absolutePath
   * @param {string} source
   * @returns {Clip}
   * @throws {ClipError} when the path is not a readable non-empty file
   */
  adopt(absolutePath, source) {
    const stats = statFile(absolutePath)
    if (stats === null) throw new ClipError(`not a readable non-empty file: ${absolutePath}`)
    const ext = extname(absolutePath).toLowerCase()
    if (!VIDEO_EXT.has(ext)) throw new ClipError(`not a video extension: ${ext || '(none)'}`)
    const clip = new Clip({
      id: fileClipId(absolutePath),
      name: basename(absolutePath, extname(absolutePath)),
      kind: 'file',
      source,
      ext,
      file: basename(absolutePath),
      path: absolutePath,
      writable: false,
      bytes: stats.size,
      mtimeMs: stats.mtimeMs,
      mtime: new Date(stats.mtimeMs).toISOString(),
      legacy: false,
      faststart: VIDEO_LIKE_EXT.has(ext) ? hasFaststart(absolutePath) : false,
      embedded: null,
      contentKey: null,
      copies: 1,
      alsoAt: [],
    })
    this.adopted.set(clip.id, clip)
    while (this.adopted.size > ADOPTED_LIMIT) {
      const oldest = this.adopted.keys().next()
      if (oldest.done === true) break
      this.adopted.delete(oldest.value)
    }
    return clip
  }

  /** Invalidate the cache, so the next `list()` rescans. */
  invalidate() {
    this.cache = null
  }
}

export { Clip }
