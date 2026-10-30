/**
 * The token-saving pipeline.
 *
 * Three independent savers run over one outbound payload, in this order:
 *
 * 1. **Prompt shaping** (`./prompts.js` + `./inject.js`) — a terse-response or
 *    YAGNI instruction is appended to the system prompt. This changes what the
 *    model *writes*, so it is the only saver that can reduce output tokens.
 * 2. **Tool-output compaction** (`./rtk/`) — the largest single win on an agent
 *    turn. A `git diff`, a `grep -rn`, an `ls -la` or a package-manager log is
 *    re-encoded into the same information at a fraction of the bytes before it
 *    ever reaches the wire. This is the one saver that is invisible to the
 *    model's reasoning: the compacted text is what the model reads.
 * 3. Nothing else. Response-side trimming (dropping reasoning frames) is
 *    deliberately absent — see `src/stream.js` for why the reasoning channel is
 *    measured rather than muzzled.
 *
 * Every saver is fail-open and independently switchable, and the pipeline
 * reports what it did in bytes so the savings panel shows a measurement instead
 * of a claim. A saver that throws is a saver that is skipped: a request must
 * never fail because the thing that was supposed to make it cheaper broke.
 *
 * @module src/token-saver/index.js
 */

import { compressRequest } from './rtk/index.js'
import { activePrompts } from './prompts.js'
import { injectSystem } from './inject.js'

/** Prompt families this pipeline knows, for the settings schema and the UI. */
export const PROMPT_FAMILIES = ['caveman', 'ponytail']

/**
 * Read the `tokenSaver` settings section into the shape the pipeline wants.
 *
 * Every field is optional and every default is "off" except RTK, which is the
 * only saver whose output the user can verify at a glance (the compacted tool
 * result is right there in the transcript) and the only one that cannot change
 * the model's behaviour. A prompt-level saver changes the assistant's voice, so
 * it is opt-in.
 */
export function saverConfig(settings) {
  const section = settings?.tokenSaver ?? {}
  const prompts = section.prompts ?? {}
  return {
    enabled: section.enabled !== false,
    rtk: section.rtk !== false,
    caveman: PROMPT_FAMILIES.includes('caveman') ? String(prompts.caveman ?? 'off') : 'off',
    ponytail: String(prompts.ponytail ?? 'off'),
    /** Per-request header/query opt-out is handled by the caller; this is the
     *  stored preference only. */
  }
}

/**
 * Run every saver over one payload, in place.
 *
 * Mutating in place is what the adapter expects: `buildPayload` hands back a
 * fresh object per attempt, `applyFingerprint` already mutates it, and the
 * continuation path re-builds rather than reusing. Returning a copy would make
 * the fingerprint's rename map and the payload disagree about which object is
 * on the wire.
 *
 * @param {object} payload - the request body, already fingerprinted
 * @param {'chat'|'messages'|'responses'} wire
 * @param {object} config - from `saverConfig()`
 * @returns {{prompt: object|null, rtk: object|null, saved: number, bytesBefore: number, bytesAfter: number, notes: string[]}}
 */
export function applyTokenSavers(payload, wire, config) {
  const report = { prompt: null, rtk: null, saved: 0, bytesBefore: 0, bytesAfter: 0, notes: [] }
  if (config?.enabled === false || payload === null || typeof payload !== 'object') return report

  // Prompt shaping first: the injected text is a system instruction, never a
  // tool result, so the order does not change RTK's input — but running it first
  // means the reported byte counts describe the payload that actually shipped.
  if (config.caveman !== 'off' || config.ponytail !== 'off') {
    try {
      const prompts = activePrompts({ caveman: config.caveman, ponytail: config.ponytail })
      if (prompts.length > 0) {
        const text = prompts.map(entry => entry.text).join('\n\n')
        const result = injectSystem(payload, wire, text)
        report.prompt = { injected: result.injected === true, reason: result.reason ?? '', families: prompts.map(entry => `${entry.id}:${entry.level}`) }
        if (result.injected !== true && result.reason !== undefined) report.notes.push(`prompt:${result.reason}`)
      }
    } catch (error) {
      report.notes.push(`prompt-failed:${error?.message ?? error}`)
    }
  }

  if (config.rtk !== false) {
    try {
      const result = compressRequest(payload, wire, true)
      report.rtk = result.stats
      report.saved = Number(result.stats?.saved) || 0
      report.bytesBefore = Number(result.stats?.bytesBefore) || 0
      report.bytesAfter = Number(result.stats?.bytesAfter) || 0
    } catch (error) {
      report.notes.push(`rtk-failed:${error?.message ?? error}`)
    }
  }
  return report
}

/** A zeroed lifetime accumulator, so the stats document has a stable shape. */
export function emptySavings() {
  return { bytesBefore: 0, bytesAfter: 0, saved: 0, blocks: 0, calls: 0, promptCalls: 0 }
}

/**
 * Fold one pipeline report into a lifetime accumulator.
 *
 * `calls` counts every request the pipeline ran on — including the ones where
 * nothing was compressible — because "0 bytes saved over 400 calls" and "0
 * bytes saved over 0 calls" are different facts, and only one of them means the
 * saver is working.
 */
export function addSavings(total, report) {
  const base = total ?? emptySavings()
  const blocks = Array.isArray(report?.rtk?.hits) ? report.rtk.hits.length : 0
  return {
    bytesBefore: base.bytesBefore + (Number(report?.bytesBefore) || 0),
    bytesAfter: base.bytesAfter + (Number(report?.bytesAfter) || 0),
    saved: base.saved + (Number(report?.saved) || 0),
    blocks: base.blocks + blocks,
    calls: base.calls + 1,
    promptCalls: base.promptCalls + (report?.prompt?.injected === true ? 1 : 0),
  }
}

/** Percent saved, rounded, or 0 when nothing was measured. */
export function savingsPercent(total) {
  const before = Number(total?.bytesBefore) || 0
  const saved = Number(total?.saved) || 0
  if (before <= 0) return 0
  return Math.round((saved / before) * 100)
}

/** The one-line summary the logs and the panel show. */
export function describeSavingsTotal(total) {
  const safe = total ?? emptySavings()
  const percent = savingsPercent(safe)
  if (safe.calls === 0) return 'token saver: no requests measured yet'
  return `token saver: ${formatBytes(safe.saved)} saved over ${safe.calls} request(s) (${percent}%), ${safe.blocks} block(s) compacted`
}

export function formatBytes(value) {
  const bytes = Number(value) || 0
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
