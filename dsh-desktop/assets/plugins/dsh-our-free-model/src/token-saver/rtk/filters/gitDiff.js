/**
 * Compact a unified diff for model consumption.
 *
 * A diff is the one tool output whose *shape* is as informative as its content:
 * which files changed, how much each hunk moved, and what the changed lines say.
 * The line-by-line body of every hunk is what costs tokens, so this filter keeps
 * file names, hunk headers and a bounded window of each hunk, and replaces the
 * rest with an explicit count. The count matters — a model that cannot tell a
 * diff was truncated will reason as if it saw the whole change.
 *
 * Ported from the Rust `git::compact_diff`; the output markers are part of the
 * ported contract because they are what the model has been trained to read.
 *
 * @module src/token-saver/rtk/filters/gitDiff.js
 */

import { GIT_DIFF_HUNK_MAX_LINES } from '../constants.js'

/**
 * @param {string} diff - raw `git diff` output
 * @param {number} [maxLines=500] - cap on output lines; the trailing marker is
 *   appended when the cap is hit, so the caller can tell a complete compaction
 *   from a truncated one.
 */
export function gitDiff(diff, maxLines = 500) {
  const result = []
  let currentFile = ''
  let added = 0
  let removed = 0
  let inHunk = false
  let hunkShown = 0
  let hunkSkipped = 0
  let wasTruncated = false
  const maxHunkLines = GIT_DIFF_HUNK_MAX_LINES

  const lines = diff.split('\n')

  // The labeled break is what lets the cap stop mid-diff; the per-hunk flush
  // below still runs, so the last partial hunk reports its skipped lines.
  outer: for (const line of lines) {
    if (line.startsWith('diff --git')) {
      if (hunkSkipped > 0) {
        result.push(`  ... (${hunkSkipped} lines truncated)`)
        wasTruncated = true
        hunkSkipped = 0
      }
      // Close out the previous file's change counts before starting the next.
      if (currentFile && (added > 0 || removed > 0)) {
        result.push(`  +${added} -${removed}`)
      }
      // "diff --git a/x b/y" — take everything after the first " b/" so a path
      // that itself contains " b/" is not cut short.
      const parts = line.split(' b/')
      currentFile = parts.length > 1 ? parts.slice(1).join(' b/') : 'unknown'
      result.push(`\n${currentFile}`)
      added = 0
      removed = 0
      inHunk = false
      hunkShown = 0
    } else if (line.startsWith('@@')) {
      if (hunkSkipped > 0) {
        result.push(`  ... (${hunkSkipped} lines truncated)`)
        wasTruncated = true
        hunkSkipped = 0
      }
      inHunk = true
      hunkShown = 0
      result.push(`  ${line}`)
    } else if (inHunk) {
      // `+++`/`---` are file headers, not content: counting them as changes
      // would inflate every file's +N -M and mislead the model about scale.
      if (line.startsWith('+') && !line.startsWith('+++')) {
        added += 1
        if (hunkShown < maxHunkLines) {
          result.push(`  ${line}`)
          hunkShown += 1
        } else {
          hunkSkipped += 1
        }
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        removed += 1
        if (hunkShown < maxHunkLines) {
          result.push(`  ${line}`)
          hunkShown += 1
        } else {
          hunkSkipped += 1
        }
      } else if (hunkShown < maxHunkLines && !line.startsWith('\\')) {
        // Context lines only make sense next to a shown change: a hunk whose
        // first 100 lines were all context would otherwise arrive as noise.
        if (hunkShown > 0) {
          result.push(`  ${line}`)
          hunkShown += 1
        }
      }
    }

    if (result.length >= maxLines) {
      result.push('\n... (more changes truncated)')
      wasTruncated = true
      break outer
    }
  }

  if (hunkSkipped > 0) {
    result.push(`  ... (${hunkSkipped} lines truncated)`)
    wasTruncated = true
  }

  if (currentFile && (added > 0 || removed > 0)) {
    result.push(`  +${added} -${removed}`)
  }

  // Tell the model how to get the whole thing rather than letting it assume
  // the compacted diff is complete.
  if (wasTruncated) {
    result.push('[full diff: rtk git diff --no-compact]')
  }

  return result.join('\n')
}

gitDiff.filterName = 'git-diff'
