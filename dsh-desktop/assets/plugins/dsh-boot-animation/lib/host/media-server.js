/**
 * MediaServer — bytes for exactly one clip, identified by that clip's id.
 *
 * The 0.2.x design served every video under one URL (`/boot.mp4`, "whatever is
 * active"), which is what produced the three reported defects:
 *
 *   - a URL whose `v=` said clip A could return clip B's bytes after a switch;
 *   - a response to that URL could be cached `immutable` forever, so a switched
 *     clip kept playing the old bytes until the page was reloaded;
 *   - "preview clip B" had no way to name B at all.
 *
 * Here every response is addressed by ClipId, the validator is that clip's own
 * identity, and `?v=` is only honoured when it matches the clip actually being
 * served. Range, ETag and faststart behaviour are unchanged — they were verified
 * working and are not what was broken.
 *
 * Embedded bytes are decoded ONE CLIP AT A TIME and kept in a small LRU. The
 * previous implementation decoded all four on the first embedded request (11.8MB
 * of base64), which is a stall in the install path for a video the user may
 * never watch.
 */
import { createReadStream, statSync } from 'node:fs'
import { MediaError, asBootAnimationError } from './errors.js'

const CONTENT_TYPE = 'video/mp4'

/** How many decoded embedded clips to keep. Each is 1-4MB of Buffer. */
const DECODED_CACHE_LIMIT = 3

export class MediaServer {
  /**
   * @param {object} options
   * @param {string} options.dataModulePath path of the generated base64 module
   * @param {{ event: (kind: string, detail?: unknown) => void } | null} [options.diagnostics]
   */
  constructor(options) {
    this.dataModulePath = options.dataModulePath
    this.diagnostics = options.diagnostics ?? null
    /** @type {Map<string, Buffer>} insertion-ordered LRU */
    this.decoded = new Map()
    /** @type {Record<string, string> | null} */
    this.dataModule = null
  }

  /**
   * The bytes of ONE embedded clip.
   *
   * Decoding is per clip and lazy: requesting `builtin:brand` must not pay for
   * `builtin:startup`.
   *
   * @param {string} name the short name inside the `builtin:` id
   * @returns {Promise<Buffer | null>}
   */
  async embeddedBuffer(name) {
    const cached = this.decoded.get(name)
    if (cached !== undefined) {
      // Refresh recency for the LRU.
      this.decoded.delete(name)
      this.decoded.set(name, cached)
      return cached
    }
    if (this.dataModule === null) this.dataModule = await import(this.dataModulePath)
    const base64 = this.dataModule[name]
    if (typeof base64 !== 'string') {
      this.diagnostics?.event('embedded-missing', { name })
      return null
    }
    const buffer = Buffer.from(base64, 'base64')
    this.decoded.set(name, buffer)
    while (this.decoded.size > DECODED_CACHE_LIMIT) {
      const oldest = this.decoded.keys().next()
      if (oldest.done === true) break
      this.decoded.delete(oldest.value)
    }
    this.diagnostics?.event('embedded-decoded', { name, bytes: buffer.length })
    return buffer
  }

  /**
   * The content identity of one clip.
   *
   * A file's on-disk identity is size+mtime: free, and it changes whenever the
   * bytes do. An embedded clip's is its sha256, which `clips.meta.js` already
   * carries, so revalidation is exact rather than stat-based.
   *
   * @param {import('./clip-registry.js').Clip} clip
   */
  identity(clip) {
    if (clip.kind === 'embedded') {
      const key = clip.contentKey ?? 'unknown'
      return {
        size: clip.bytes,
        version: key,
        etag: `"embedded-${key}"`,
        lastModified: null,
      }
    }
    let stats = null
    try {
      stats = statSync(clip.path)
    } catch {
      /* fall through: serve without validators rather than fail the request */
    }
    return {
      size: stats === null ? clip.bytes : stats.size,
      // The SAME string the listing publishes, so a client that pins it gets a
      // match here. Two definitions of "this clip's version" is how a `?v=` stops
      // matching and every replay pays a revalidation.
      version: clip.version(),
      etag: stats === null ? null : `"${stats.size.toString(16)}-${Math.round(stats.mtimeMs).toString(16)}"`,
      lastModified: stats === null ? null : new Date(stats.mtimeMs).toUTCString(),
    }
  }

  /**
   * Which `cache-control` a response may carry.
   *
   * `?v=<this clip's own version>` cannot go stale — the version changes whenever
   * the bytes do, so the old URL is simply a different resource — and may be
   * cached forever. Anything else revalidates. Matching is against the version of
   * the clip being served, never against "whatever is active", which is the bug
   * this method used to have.
   *
   * @param {string} rawUrl
   * @param {string | null} version
   */
  cacheControlFor(rawUrl, version) {
    if (typeof version === 'string' && version !== '') {
      const query = rawUrl.indexOf('?')
      if (query !== -1) {
        try {
          if (new URLSearchParams(rawUrl.slice(query + 1)).get('v') === version) {
            return 'public, max-age=31536000, immutable'
          }
        } catch {
          /* malformed query: fall through to revalidation */
        }
      }
    }
    return 'no-cache'
  }

  /**
   * Where the bytes come from for this clip: a Buffer, or a readable for a slice.
   *
   * @param {import('./clip-registry.js').Clip} clip
   * @param {number} start
   * @param {number | undefined} end
   */
  async #body(clip, start, end) {
    if (clip.kind === 'embedded') {
      const buffer = await this.embeddedBuffer(clip.embedded)
      if (buffer === null) {
        throw new MediaError(`embedded clip data is missing from the data module: ${String(clip.embedded)}`)
      }
      return start === undefined ? buffer : buffer.subarray(start, end === undefined ? buffer.length : end + 1)
    }
    return start === undefined
      ? createReadStream(clip.path)
      : createReadStream(clip.path, { start, end })
  }

  /**
   * Serve one clip, addressed by its own id.
   *
   * Failure is contained to this request: the response is an uncacheable error
   * and the plugin keeps running. A missing or unreadable file never propagates
   * further than here.
   *
   * @param {{ method?: string, url?: string, headers: Record<string, unknown> }} req
   * @param {{ writeHead: (status: number, headers?: Record<string, string>) => void, end: (body?: unknown) => void }} res
   * @param {import('./clip-registry.js').Clip} clip
   */
  async serve(req, res, clip) {
    try {
      const { size, etag, lastModified, version } = this.identity(clip)
      const validators = {}
      if (etag !== null) validators.etag = etag
      if (lastModified !== null) validators['last-modified'] = lastModified
      const rawUrl = typeof req.url === 'string' ? req.url : ''
      const cacheControl = this.cacheControlFor(rawUrl, version)

      if (etag !== null) {
        const inm = req.headers['if-none-match']
        const matched =
          typeof inm === 'string' &&
          inm
            .split(',')
            .map((candidate) => candidate.trim())
            .some((candidate) => candidate === etag || candidate === '*')
        if (matched) {
          res.writeHead(304, { ...validators, 'cache-control': cacheControl })
          res.end()
          return
        }
      }

      const sendBody = async (start, end) => {
        const chunk = await this.#body(clip, start, end)
        if (Buffer.isBuffer(chunk)) res.end(chunk)
        else chunk.pipe(res)
      }

      const range = req.headers.range
      if (typeof range === 'string') {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
        if (match !== null) {
          const rawStart = match[1]
          const rawEnd = match[2]
          let start = rawStart === '' ? undefined : Number(rawStart)
          let end = rawEnd === '' ? undefined : Number(rawEnd)
          if (start === undefined && end !== undefined) {
            // Suffix form: last N bytes.
            start = Math.max(0, size - end)
            end = size - 1
          }
          if (start !== undefined && end === undefined) end = size - 1
          const valid =
            start !== undefined &&
            end !== undefined &&
            Number.isFinite(start) &&
            Number.isFinite(end) &&
            start <= end &&
            start < size
          if (!valid) {
            res.writeHead(416, { 'content-range': 'bytes */' + String(size), 'cache-control': 'no-store' })
            res.end()
            return
          }
          end = Math.min(end, size - 1)
          res.writeHead(206, {
            ...validators,
            'content-type': CONTENT_TYPE,
            'content-length': String(end - start + 1),
            'content-range': 'bytes ' + String(start) + '-' + String(end) + '/' + String(size),
            'accept-ranges': 'bytes',
            'cache-control': cacheControl,
          })
          if (req.method === 'HEAD') {
            res.end()
            return
          }
          await sendBody(start, end)
          return
        }
      }

      res.writeHead(200, {
        ...validators,
        'content-type': CONTENT_TYPE,
        'content-length': String(size),
        'accept-ranges': 'bytes',
        'cache-control': cacheControl,
      })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      await sendBody(undefined, undefined)
    } catch (cause) {
      const error = asBootAnimationError(cause, 'media', `serving ${clip.id}`)
      this.diagnostics?.event('media-error', { id: clip.id, boundary: error.boundary, message: error.message })
      try {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
        res.end('dsh-boot-animation: could not read this clip')
      } catch {
        /* headers already sent: the stream failed midway */
      }
    }
  }
}
