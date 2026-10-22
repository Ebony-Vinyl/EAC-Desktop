/**
 * Compact `find` output: one path per line, grouped by directory.
 *
 * A find result is a path list, and a path list's information is "how many
 * files, and where" — the repeated parent directory on every line is the cost.
 * Grouping by directory with basenames keeps the shape of the tree (which is
 * what a model reasons over when deciding where to look) while dropping the
 * repetition. Per-directory and total-directory caps bound a runaway tree.
 *
 * Ported from the Rust `find_wrapper`.
 *
 * @module src/token-saver/rtk/filters/find.js
 */

import { FIND_PER_DIR_MAX, FIND_TOTAL_DIR_MAX } from '../constants.js'

export function find(input) {
  const lines = input.split('\n').filter(l => l.trim())
  if (lines.length === 0) return input

  const byDir = new Map()

  for (const path of lines) {
    // Accept both Unix ("/a/b") and Windows ("C:\a\b") separators
    const lastSep = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    let dir
    let basename
    if (lastSep === -1) {
      dir = '.'
      basename = path
    } else {
      // Rust: PathBuf::from(path).parent().display() + file_name().display()
      dir = path.slice(0, lastSep) || '/'
      basename = path.slice(lastSep + 1)
    }
    if (!byDir.has(dir)) byDir.set(dir, [])
    byDir.get(dir).push(basename)
  }

  // Rust: dirs.sort_by_key(|(d, _)| d.clone())
  const dirs = Array.from(byDir.keys()).sort()
  let out = `${lines.length} files in ${dirs.length} dirs:\n\n`

  const showDirs = dirs.slice(0, FIND_TOTAL_DIR_MAX)
  for (const dir of showDirs) {
    const files = byDir.get(dir)
    // Normalise Windows separators so the grouped label is comparable with the
    // Unix-shaped labels in the same list.
    const dirLabel = dir.replace(/\\/g, '/')
    out += `${dirLabel}/  (${files.length})\n`
    const showFiles = files.slice(0, FIND_PER_DIR_MAX)
    for (const f of showFiles) out += `  ${f}\n`
    if (files.length > FIND_PER_DIR_MAX) {
      out += `  +${files.length - FIND_PER_DIR_MAX}\n`
    }
  }
  if (dirs.length > FIND_TOTAL_DIR_MAX) {
    out += `\n+${dirs.length - FIND_TOTAL_DIR_MAX} more dirs\n`
  }

  return out
}

find.filterName = 'find'
