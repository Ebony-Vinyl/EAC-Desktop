/**
 * Compact a line-numbered file dump (`  1|content`, e.g. Cursor's read_file).
 *
 * The numbering is kept because it is how a model cites locations, and the
 * head+tail window is deliberate: a file's imports and top-level declarations
 * live at the top, and a diff or a trailing call site lives at the bottom. The
 * marker names the missing line count so the model knows the file continues and
 * can ask for a specific range instead of assuming it read the whole thing.
 *
 * @module src/token-saver/rtk/filters/readNumbered.js
 */

import { SMART_TRUNCATE_HEAD, SMART_TRUNCATE_TAIL, SMART_TRUNCATE_MIN_LINES } from '../constants.js'

const LINE_RE = /^\s*\d+\|/

export function readNumbered(input) {
  const lines = input.split('\n')
  if (lines.length < SMART_TRUNCATE_MIN_LINES) return input

  // Count how many lines match "N|content" to verify shape (hit ratio check
  // already done by autodetect; here we just truncate).
  const head = lines.slice(0, SMART_TRUNCATE_HEAD)
  const tail = lines.slice(lines.length - SMART_TRUNCATE_TAIL)
  const cut = lines.length - head.length - tail.length

  return [
    ...head,
    `... +${cut} lines truncated (file continues)`,
    ...tail
  ].join('\n')
}

readNumbered.filterName = 'read-numbered'

// Exposed for autodetect
export const READ_NUMBERED_LINE_RE = LINE_RE
