/**
 * Pick the compactor for a blob by what its head looks like.
 *
 * The order of the checks below is the whole algorithm, and it is not
 * interchangeable:
 *
 * - `git log`/`git diff`/`git status` come first because they are the outputs
 *   whose shape is most specific and whose line content can otherwise look like
 *   anything else.
 * - build output is checked *before* the porcelain heuristic: cargo prints
 *   "Compiling foo" lines whose leading `C`/` ` columns can satisfy the
 *   porcelain character class, and a cargo log misread as `git status` would be
 *   summarised into a status nobody asked for.
 * - grep (a plausible hit in the first five lines, with every non-empty row
 *   parseable across the complete output) is
 *   checked before find (all lines path-like): a grep result is a subset of
 *   path-like lines, so testing find first would steal every grep result.
 * - the numbered-dump check runs before the generic fallbacks because the
 *   fallbacks would otherwise eat it and lose the line numbers.
 * - dedupLog before smartTruncate, so a long log with duplicates is deduped
 *   rather than blind-truncated.
 *
 * A blob that matches nothing returns null and passes through untouched — a
 * wrong compaction is worse than no compaction.
 *
 * Ported from the Rust `auto_detect_filter` (pipe_cmd.rs) plus JS extras.
 *
 * @module src/token-saver/rtk/autodetect.js
 */

import { DETECT_WINDOW, READ_NUMBERED_MIN_HIT_RATIO, SMART_TRUNCATE_MIN_LINES } from './constants.js'
import { gitDiff } from './filters/gitDiff.js'
import { gitStatus } from './filters/gitStatus.js'
import { gitLog } from './filters/gitLog.js'
import { buildOutput } from './filters/buildOutput.js'
import { grep } from './filters/grep.js'
import { find } from './filters/find.js'
import { dedupLog } from './filters/dedupLog.js'
import { ls } from './filters/ls.js'
import { tree } from './filters/tree.js'
import { smartTruncate } from './filters/smartTruncate.js'
import { readNumbered, READ_NUMBERED_LINE_RE } from './filters/readNumbered.js'
import { searchList, SEARCH_LIST_HEADER_RE } from './filters/searchList.js'
import { isGrepHit, splitGrepHit, parseGrepOutput } from './hitLine.js'

const RE_GIT_DIFF = /^diff --git /m
const RE_GIT_DIFF_HUNK = /^@@ /m
const RE_GIT_STATUS = /^On branch |^nothing to commit|^Changes (not |to be )|^Untracked files:/m
const RE_GIT_LOG = /^[*|/\\ ]*commit [0-9a-f]{7,40}$/m
// Two blank status columns are not porcelain; they are ordinary indentation.
const RE_PORCELAIN = /^(?!  )[ MADRCU?!][ MADRCU?!] \S/m
const RE_BUILD_OUTPUT = /^(npm (warn|error|ERR!)|yarn (warn|error)|\s*Compiling\s+\S+|\s*Downloading\s+\S+|added \d+ package|\[ERROR\]|BUILD (SUCCESS|FAILED)|\s*Finished\s+|Successfully (installed|built)|ERROR:)/im
const RE_TREE_GLYPH = /[├└]──|│  /
const RE_LS_ROW = /^[-dlbcps][rwx-]{9}/m
const RE_LS_TOTAL = /^total \d+$/m

export function autoDetectFilter(text) {
  // Rust: floor_char_boundary to avoid UTF-8 split — JS .slice() by char is safe
  const head = text.length > DETECT_WINDOW ? text.slice(0, DETECT_WINDOW) : text

  if (RE_GIT_LOG.test(head)) return gitLog
  if (RE_GIT_DIFF.test(head) || RE_GIT_DIFF_HUNK.test(head)) return gitDiff
  if (RE_GIT_STATUS.test(head)) return gitStatus

  // Build output BEFORE porcelain check: prevents cargo "Compiling" misdetection as git-status
  if (RE_BUILD_OUTPUT.test(head)) return buildOutput

  if (isMostlyPorcelain(head)) return gitStatus

  const lines = head.split('\n')
  const nonEmpty = lines.filter(l => l.trim().length > 0)

  // Inspect whole lines, not a line cut by DETECT_WINDOW. A candidate may be
  // a webpage timestamp or source citation. If the complete blob is mixed,
  // return null immediately: another lossy fallback must not claim its prose.
  // Stop sampling at the fifth non-empty row; only a candidate needs the
  // complete-output validation below.
  const first5 = []
  for (let start = 0; start < text.length && first5.length < 5;) {
    const newline = text.indexOf('\n', start)
    const end = newline === -1 ? text.length : newline
    const line = text.slice(start, end)
    if (line.trim()) first5.push(line)
    start = end + 1
  }
  const hasCandidate = first5.some(line => {
    const hit = splitGrepHit(line)
    return hit !== null && /^\d+$/.test(hit.line)
  })
  if (hasCandidate) {
    return first5.some(isGrepHit) && parseGrepOutput(text) !== null ? grep : null
  }

  // Rust find rule: ALL non-empty lines path-like (no ':'), >=3 lines
  if (nonEmpty.length >= 3 && nonEmpty.every(isPathLike)) return find

  // Tree: contains box-drawing glyphs typical of `tree` command
  if (RE_TREE_GLYPH.test(head)) return tree

  // ls -la: has "total N" header or >=3 rows starting with perms string
  if (RE_LS_TOTAL.test(head) || countMatches(head, RE_LS_ROW) >= 3) return ls

  // Cursor Glob search list header
  if (SEARCH_LIST_HEADER_RE.test(head)) return searchList

  // Line-numbered file dump ("  N|content") — fire only if many lines match
  if (lines.length >= SMART_TRUNCATE_MIN_LINES && isLineNumbered(lines)) {
    return readNumbered
  }

  // Fallback: dedupLog for generic multi-line noise with duplicates
  if (nonEmpty.length >= 5) return dedupLog

  // Last resort: big blob with no structure — smart truncate
  if (text.split('\n').length >= SMART_TRUNCATE_MIN_LINES) return smartTruncate

  return null
}

/**
 * A line that could be a filesystem path, with no colon that would make it a
 * grep hit instead.
 *
 * A drive-letter prefix (e.g. "C:\Users\me" or "C:/Users/me") marks a Windows
 * absolute path, so the whole line is treated as path-like. Trailing colons
 * (e.g. "C:\path\file.js:10") are tolerated, matching grep-style suffixes on
 * Windows dumps.
 */
function isPathLike(line) {
  const t = line.trim()
  if (t.length === 0) return false
  if (/^[A-Za-z]:[\\/]/.test(t)) return true
  if (t.includes(':')) return false
  return t.startsWith('.') || t.startsWith('/') || t.includes('/')
}

/**
 * Porcelain has no header line to key on, so it is recognised by density: at
 * least 60% of the non-empty lines carry the two-column status prefix.
 */
function isMostlyPorcelain(head) {
  const lines = head.split('\n').filter(l => l.trim())
  if (lines.length < 3) return false
  const hits = lines.filter(l => RE_PORCELAIN.test(l)).length
  return hits / lines.length >= 0.6
}

/**
 * Ratio of `N|` lines over the first 100 non-empty lines.
 *
 * Whitespace-only lines are counted as non-empty here (length > 0), matching
 * the Rust port: a numbered dump is dense, and one blank line inside it should
 * not swing the ratio.
 */
function isLineNumbered(lines) {
  let hits = 0
  let nonEmpty = 0
  const sample = lines.slice(0, 100)
  for (const l of sample) {
    if (l.length === 0) continue
    nonEmpty++
    if (READ_NUMBERED_LINE_RE.test(l)) hits++
  }
  if (nonEmpty < 5) return false
  return hits / nonEmpty >= READ_NUMBERED_MIN_HIT_RATIO
}

function countMatches(text, re) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  return (text.match(g) || []).length
}
