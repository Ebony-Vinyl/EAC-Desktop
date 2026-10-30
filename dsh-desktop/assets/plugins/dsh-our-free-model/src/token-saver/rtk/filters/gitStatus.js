/**
 * Compact `git status`, in both of its dialects.
 *
 * Porcelain output (`--porcelain`, and what most agent tools run) is two status
 * columns plus a path, one line per file; long-form output is prose with
 * `modified:   path` sections. A model only needs the branch, the counts, and
 * enough of the path list to recognise its own work — not a hundred lines of
 * per-file ceremony. Both dialects are parsed here because the wire gives no
 * hint which one a tool used, and a porcelain-only parser silently reports
 * "clean" for long-form input (which is how a model concludes there is nothing
 * to commit while edits sit unstaged).
 *
 * Ported from the Rust `git::format_status_output`.
 *
 * @module src/token-saver/rtk/filters/gitStatus.js
 */

import { STATUS_MAX_FILES, STATUS_MAX_UNTRACKED } from '../constants.js'

export function gitStatus(input) {
  const lines = input.split('\n')
  if (lines.length === 0 || (lines.length === 1 && !lines[0].trim())) {
    return 'Clean working tree'
  }

  let branch = ''
  const stagedFiles = []
  const modifiedFiles = []
  const untrackedFiles = []
  let staged = 0
  let modified = 0
  let untracked = 0
  let conflicts = 0

  for (const raw of lines) {
    if (!raw.trim()) continue

    // Long-form branch detection (LLM usually sends this, not porcelain)
    const longBranch = raw.match(/^On branch (\S+)/)
    if (longBranch) { branch = longBranch[1]; continue }

    // Porcelain branch header: "## main...origin/main"
    if (raw.startsWith('##')) { branch = raw.replace(/^##\s*/, ''); continue }

    // Porcelain status (2 chars + space + path)
    if (raw.length >= 3 && /^[ MADRCU?!][ MADRCU?!] /.test(raw)) {
      const x = raw[0]
      const y = raw[1]
      const file = raw.slice(3)

      if (raw.slice(0, 2) === '??') {
        untracked++
        untrackedFiles.push(file)
        continue
      }

      // Column 1 is the index: any letter that can be staged counts as staged.
      if ('MADRC'.includes(x)) {
        staged++
        stagedFiles.push(file)
      } else if (x === 'U') {
        conflicts++
      }

      // Column 2 is the worktree: modified or deleted but not staged.
      if (y === 'M' || y === 'D') {
        modified++
        modifiedFiles.push(file)
      }
      continue
    }

    // Long form fallback ("modified:   path", "new file:   path", ...)
    const longMatch = raw.match(/^\s*(modified|new file|deleted|renamed|both modified):\s+(.+)$/)
    if (longMatch) {
      const kind = longMatch[1]
      const path = longMatch[2].trim()
      if (kind === 'both modified') { conflicts++ }
      else if (kind === 'modified' || kind === 'deleted') { modified++; modifiedFiles.push(path) }
      else if (kind === 'new file' || kind === 'renamed') { staged++; stagedFiles.push(path) }
      continue
    }

    // "Untracked files:" section — gather bare paths after this marker
    // Handled implicitly: plain paths without markers are skipped (safer).
  }

  let out = ''
  if (branch) out += `* ${branch}\n`

  if (staged > 0) {
    out += `+ Staged: ${staged} files\n`
    for (const f of stagedFiles.slice(0, STATUS_MAX_FILES)) out += `   ${f}\n`
    if (stagedFiles.length > STATUS_MAX_FILES) {
      out += `   ... +${stagedFiles.length - STATUS_MAX_FILES} more\n`
    }
  }

  if (modified > 0) {
    out += `~ Modified: ${modified} files\n`
    for (const f of modifiedFiles.slice(0, STATUS_MAX_FILES)) out += `   ${f}\n`
    if (modifiedFiles.length > STATUS_MAX_FILES) {
      out += `   ... +${modifiedFiles.length - STATUS_MAX_FILES} more\n`
    }
  }

  if (untracked > 0) {
    out += `? Untracked: ${untracked} files\n`
    for (const f of untrackedFiles.slice(0, STATUS_MAX_UNTRACKED)) out += `   ${f}\n`
    if (untrackedFiles.length > STATUS_MAX_UNTRACKED) {
      out += `   ... +${untrackedFiles.length - STATUS_MAX_UNTRACKED} more\n`
    }
  }

  if (conflicts > 0) {
    out += `conflicts: ${conflicts} files\n`
  }

  // An empty status is a fact the model must be told explicitly: silence reads
  // as "the command failed", and the model then runs status again.
  if (staged === 0 && modified === 0 && untracked === 0 && conflicts === 0) {
    out += 'clean — nothing to commit\n'
  }

  return out.replace(/\n+$/, '')
}

gitStatus.filterName = 'git-status'
