/**
 * ClipId — the ONE identity for a video, everywhere.
 *
 * Two shapes, and neither is ever an array index:
 *
 *   builtin:<name>          a clip embedded in `lib/clips.data.js`
 *   <stem>-<fnv8>           a file on disk, hashed from its normalised path
 *
 * The file form is deliberately the same function the 0.2.x releases used, so a
 * `selection.json` written by an older version keeps resolving instead of being
 * silently discarded on upgrade. What is NEW here is that the shape is declared,
 * validated and normalised in one place, so nothing downstream has to guess.
 *
 * Stability, honestly: a built-in id is stable forever. A file id is stable for
 * as long as the file stays at the same path — rename or move it and it gets a
 * new id. That is why selection resolution treats a missing id as "fall through
 * the priority chain" rather than as an error, and why the UI marks which clip
 * is actually live instead of trusting the stored choice blindly.
 */
import { basename, extname } from 'node:path'
import { ClipError } from './errors.js'

/** Namespace for the clips the package ships. Can never collide with a path. */
export const EMBEDDED_PREFIX = 'builtin:'

/**
 * The pseudo-id meaning "whatever should play now".
 *
 * Kept as an alias rather than a real clip so the router can keep the historical
 * `/boot.mp4` behaviour without inventing a second resolution path.
 */
export const ACTIVE_ALIAS = 'active'

/** Bound on a path-derived id, so a pathological filename cannot blow a URL up. */
const MAX_STEM = 40

/** FNV-1a, 32-bit. Deterministic across processes — no hash library, no salt. */
function fnv1a(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** The id of an embedded clip, from the short name in `clips.meta.js`. */
export function embeddedClipId(name) {
  if (typeof name !== 'string' || name === '') {
    throw new ClipError('embedded clip name must be a non-empty string')
  }
  return EMBEDDED_PREFIX + name
}

/** Whether an id addresses an embedded clip. */
export function isEmbeddedClipId(id) {
  return typeof id === 'string' && id.startsWith(EMBEDDED_PREFIX)
}

/** The short name inside a `builtin:` id, or null. */
export function embeddedNameOf(id) {
  return isEmbeddedClipId(id) ? id.slice(EMBEDDED_PREFIX.length) : null
}

/**
 * A stable id for a file, from its normalised absolute path.
 *
 * Normalised (slashes unified, lower-cased) so the same file reached through
 * `C:\x\a.mp4` and `c:/x/a.mp4` is one clip rather than two.
 */
export function fileClipId(absolutePath) {
  if (typeof absolutePath !== 'string' || absolutePath === '') {
    throw new ClipError('file clip path must be a non-empty string')
  }
  const normalised = absolutePath.replace(/\\/g, '/').toLowerCase()
  const stem = (basename(absolutePath, extname(absolutePath)) || 'video')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_STEM)
  return (stem || 'video') + '-' + fnv1a(normalised)
}

/**
 * Normalise a raw id from a URL or a JSON body.
 *
 * Returns null for anything that cannot be a ClipId, so a caller answers 404
 * rather than throwing on user input. Percent-encoding is decoded by the caller
 * (the route owns that), so this is about shape, not transport.
 */
export function normalizeClipId(raw) {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (trimmed.length > 300) return null
  if (trimmed === ACTIVE_ALIAS) return ACTIVE_ALIAS
  // A ClipId is URL-safe by construction: no separators, no traversal, no
  // control characters. Anything else is not an id we ever issued.
  if (!/^[A-Za-z0-9_.:-]+$/.test(trimmed)) return null
  if (trimmed.includes('..')) return null
  if (isEmbeddedClipId(trimmed)) {
    return embeddedNameOf(trimmed) === '' ? null : trimmed
  }
  return trimmed
}

/** `normalizeClipId` or throw, for callers that own the value (not user input). */
export function assertClipId(raw) {
  const id = normalizeClipId(raw)
  if (id === null) throw new ClipError(`not a valid ClipId: ${String(raw)}`)
  return id
}
