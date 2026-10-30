/**
 * Compact `ls -la` output.
 *
 * A long listing is columns the model does not use — permissions, links, owner,
 * group, a date whose exact value is noise — repeated per entry. What a model
 * needs is the names, which are directories, and roughly how big the files are.
 * The extension histogram at the end doubles as a cheap "what kind of project
 * is this" signal that survives even when the entries themselves are capped.
 *
 * Ported from the Rust `compact_ls`.
 *
 * @module src/token-saver/rtk/filters/ls.js
 */

import { LS_EXT_SUMMARY_TOP, LS_NOISE_DIRS } from '../constants.js'

// Rust LS_DATE_RE: month + day + (year|HH:MM)
const LS_DATE_RE = /\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+(\d{4}|\d{2}:\d{2})\s+/

function humanSize(bytes) {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)}M`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}K`
  return `${bytes}B`
}

/**
 * Parse one `ls -l` row by anchoring on the date column.
 *
 * Anchoring on the date rather than splitting from the left is what makes this
 * survive filenames with spaces and `ls` variants that add columns: everything
 * after the date is the name, and the size is the rightmost bare number before
 * it. Returns null for rows that are not listing entries (headers, blanks,
 * "total N" is filtered by the caller).
 */
function parseLsLine(line) {
  const m = LS_DATE_RE.exec(line)
  if (!m) return null
  const name = line.slice(m.index + m[0].length)
  const beforeDate = line.slice(0, m.index)
  const beforeParts = beforeDate.split(/\s+/).filter(Boolean)
  if (beforeParts.length < 4) return null

  const perms = beforeParts[0]
  const fileType = perms.charAt(0)

  // size = rightmost parseable number before the date
  let size = 0
  for (let i = beforeParts.length - 1; i >= 0; i--) {
    const n = Number(beforeParts[i])
    if (Number.isInteger(n) && String(n) === beforeParts[i]) { size = n; break }
  }
  return { fileType, size, name }
}

export function ls(input) {
  const dirs = []
  const files = [] // [name, sizeStr]
  const byExt = new Map()

  for (const line of input.split('\n')) {
    if (line.startsWith('total ') || line.length === 0) continue
    const parsed = parseLsLine(line)
    if (!parsed) continue
    if (parsed.name === '.' || parsed.name === '..') continue

    // Rust ls.rs: show_all flag respected — for LLM context always skip noise
    if (LS_NOISE_DIRS.includes(parsed.name)) continue

    if (parsed.fileType === 'd') {
      dirs.push(parsed.name)
    } else if (parsed.fileType === '-' || parsed.fileType === 'l') {
      const dot = parsed.name.lastIndexOf('.')
      // dot > 0, not >= 0: a leading dot is a dotfile, not an extension.
      const ext = dot > 0 ? parsed.name.slice(dot) : 'no ext'
      byExt.set(ext, (byExt.get(ext) || 0) + 1)
      files.push([parsed.name, humanSize(parsed.size)])
    }
  }

  // Nothing recognisable: not an `ls -l` listing, so pass it through rather
  // than answer with an empty or misleading compaction.
  if (dirs.length === 0 && files.length === 0) return input

  let out = ''
  for (const d of dirs) out += `${d}/\n`
  for (const [name, size] of files) out += `${name}  ${size}\n`

  // Summary line (Rust port)
  let summary = `\nSummary: ${files.length} files, ${dirs.length} dirs`
  if (byExt.size > 0) {
    const ext = Array.from(byExt.entries()).sort((a, b) => b[1] - a[1])
    const parts = ext.slice(0, LS_EXT_SUMMARY_TOP).map(([e, c]) => `${c} ${e}`)
    summary += ` (${parts.join(', ')}`
    if (ext.length > LS_EXT_SUMMARY_TOP) {
      summary += `, +${ext.length - LS_EXT_SUMMARY_TOP} more`
    }
    summary += ')'
  }

  return out + summary
}

ls.filterName = 'ls'
