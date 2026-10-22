/**
 * Generic fallback compactor: collapse duplicate runs, cap the line count.
 *
 * This is what runs when a blob matches no known tool shape. It assumes nothing
 * about the format — a log line repeated 500 times is 500 chances for the model
 * to misread it as progress, and one line plus "500 duplicate lines" carries the
 * same fact. A hard line cap keeps a runaway loop from filling the context.
 *
 * @module src/token-saver/rtk/filters/dedupLog.js
 */

import { DEDUP_LINE_MAX } from '../constants.js'

export function dedupLog(input) {
  const lines = input.split('\n')
  const out = []
  let prev = null
  let runCount = 0
  let blankStreak = 0

  // Emitted lazily: the duplicate run is only reported once a different line
  // (or the end) proves it is over, so the marker sits where the run was.
  const flushRun = () => {
    if (prev !== null && runCount > 1) {
      out.push(`  ... (${runCount - 1} duplicate lines)`)
    }
  }

  for (const line of lines) {
    if (line.trim() === '') {
      // Collapse a blank streak to one blank: paragraph structure survives,
      // but a page of padding does not.
      if (blankStreak < 1) out.push(line)
      blankStreak += 1
      flushRun()
      prev = null
      runCount = 0
      continue
    }
    blankStreak = 0
    if (line === prev) {
      runCount += 1
      continue
    }
    flushRun()
    out.push(line)
    prev = line
    runCount = 1
    if (out.length >= DEDUP_LINE_MAX) {
      out.push(`... (truncated at ${DEDUP_LINE_MAX} lines)`)
      return out.join('\n')
    }
  }
  flushRun()
  return out.join('\n')
}

dedupLog.filterName = 'dedup-log'
