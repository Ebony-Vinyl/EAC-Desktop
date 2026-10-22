/**
 * Search-output parsing adapted from PR #285
 * (9a6733313c45ed29850fcb8f452130b7cf63a513), fixing issue #280.
 *
 * Retain its drive-aware split and conservative candidate predicate. A single
 * plausible path is not proof that a whole tool result is search output:
 * webpages can contain timestamps, host:port text, and source citations.
 * Validate every non-empty row before rewriting; preserve the entire blob on
 * uncertainty. Do not use the strict candidate predicate to discard matches:
 * real filenames can have spaces or no extension.
 *
 * @module src/token-saver/rtk/hitLine.js
 */

/** A leading `C:` / `c:\` / `C:/` — a drive letter, not a file name. */
const RE_DRIVE_PREFIX = /^[A-Za-z]:[\\/]/

/** A path separator or a dot-extension: what makes the file field path-shaped. */
const RE_PATH_SHAPE = /[\\/.]/

/** Conservative detection seed only; not a restriction on parsed filenames. */
const RE_PATH_REJECT = /\s/

/**
 * Split one candidate line into its three fields without judging whether they
 * are plausible. Detection uses isGrepHit; whole-output parsing validates
 * numeric line fields without rejecting legitimate filenames.
 *
 * Starting the search past a drive prefix is what makes the split work on
 * Windows; the two colons it then finds are the real field separators.
 *
 * @param {string} line - one line of tool output
 * @returns {{file: string, line: string, content: string} | null} the fields, or
 *   null when the line has fewer than two colons and cannot be a hit
 */
export function splitGrepHit(line) {
  const start = RE_DRIVE_PREFIX.test(line) ? 2 : 0
  const first = line.indexOf(':', start)
  if (first === -1) return null
  const second = line.indexOf(':', first + 1)
  if (second === -1) return null
  return {
    file: line.slice(0, first),
    line: line.slice(first + 1, second),
    content: line.slice(second + 1),
  }
}

/**
 * Is this line `file:N:content`, with a numeric line number and a file field
 * that could actually name a file?
 *
 * This is only a conservative detection seed, never proof of tool identity.
 * Dotted host:port lines can match too. Use parseGrepOutput before rewriting.
 *
 * @param {string} line
 * @returns {boolean}
 */
export function isGrepHit(line) {
  const hit = splitGrepHit(line)
  if (hit === null) return false
  if (!/^\d+$/.test(hit.line)) return false
  if (hit.file === '' || RE_PATH_REJECT.test(hit.file)) return false
  return RE_PATH_SHAPE.test(hit.file)
}

/**
 * Parse a complete search output, or refuse the entire blob. A strict detector
 * is useful for choosing a filter, but is NOT a valid reason to discard rows:
 * real filenames can contain spaces or lack an extension (README, Makefile).
 * Blank separators are harmless; any other unparsed line preserves the input.
 * Check the full text, including rows beyond the detection window.
 */
export function parseGrepOutput(text) {
  const hits = []
  for (const row of text.split('\n')) {
    if (row.trim() === '') continue
    const hit = splitGrepHit(row)
    if (hit === null || hit.file.trim() === '' || !/^\d+$/.test(hit.line)) return null
    hits.push(hit)
  }
  return hits.length > 0 ? hits : null
}
