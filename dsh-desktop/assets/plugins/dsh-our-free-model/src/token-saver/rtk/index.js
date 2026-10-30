/**
 * RTK token saver: compact tool output inside an outgoing request body.
 *
 * A long agent turn is mostly tool output — diffs, listings, search results,
 * build logs — and almost all of it is redundancy a model does not need: paths
 * repeated per match, progress lines per compiled crate, hunk bodies far larger
 * than the change they describe. This module rewrites those blobs into the
 * compacted shapes the RTK tool defines, in place, just before the request is
 * handed to the provider.
 *
 * Three rules bound what may be touched:
 *
 * - Only tool *output* is compacted. System prompts, user turns and assistant
 *   text are hand-written context; rewriting them would change what the user
 *   asked for.
 * - Error results are never compacted (`is_error` on the Anthropic wire,
 *   `status: "error"` on Kiro's). An error trace is the model's only evidence
 *   of what failed; hiding it makes the model retry the same call, and the user
 *   pays for the loop.
 * - A blob is replaced only when the replacement is non-empty and strictly
 *   smaller. An empty tool result reads as "the tool printed nothing", which is
 *   a different fact than the one the tool reported, and a larger one costs the
 *   context it was meant to save.
 *
 * Every filter failure is fail-open: the original text is sent. This module
 * sits between the user's turn and the provider, so its worst acceptable
 * outcome is saving nothing.
 *
 * Two entry points exist:
 *
 * - {@link module:src/token-saver/rtk/index.js~compressMessages} — the original
 *   wire-agnostic walk (OpenAI chat/responses items, Anthropic blocks, and the
 *   Kiro conversationState shape), kept for parity.
 * - {@link module:src/token-saver/rtk/index.js~compressRequest} — the same
 *   compaction addressed by the three wires this plugin actually builds:
 *   `chat`, `messages`, `responses`.
 *
 * @module src/token-saver/rtk/index.js
 */

import { RAW_CAP, MIN_COMPRESS_SIZE } from './constants.js'
import { autoDetectFilter } from './autodetect.js'
import { safeApply } from './applyFilter.js'

// ── wire-agnostic entry (source parity) ──────────────────────────────────────

/**
 * Compress tool-result content in place, walking every shape the source tool
 * understood.
 *
 * Returns `null` when disabled, when the body has no recognisable message list,
 * or when the walk itself failed — the caller's signal to send the body as-is.
 * On success the stats are `{ bytesBefore, bytesAfter, hits }`, where the byte
 * counts cover only the tool-output text that was considered (not the whole
 * request) and `hits` names the shape and filter behind each saving.
 *
 * @param {object} body - a request body carrying `messages`, `input`, or `conversationState`
 * @param {boolean} enabled - per-request switch
 */
export function compressMessages(body, enabled) {
  if (!enabled) return null
  if (!body) return null

  // Kiro format: conversationState.history + conversationState.currentMessage
  if (body.conversationState) {
    return compressKiroFormat(body, enabled)
  }

  // Support both OpenAI/Claude "messages" and OpenAI Responses "input"
  const items = Array.isArray(body.messages) ? body.messages
    : Array.isArray(body.input) ? body.input
    : null
  if (!items) return null

  const stats = { bytesBefore: 0, bytesAfter: 0, hits: [] }
  try {
    for (let i = 0; i < items.length; i++) {
      const msg = items[i]
      if (!msg) continue

      // Shape 4: OpenAI Responses — top-level { type:"function_call_output", output: string | [{type:"input_text", text}] }
      if (msg.type === 'function_call_output') {
        if (typeof msg.output === 'string') {
          msg.output = compressText(msg.output, stats, 'openai-responses-string')
        } else if (Array.isArray(msg.output)) {
          for (let k = 0; k < msg.output.length; k++) {
            const part = msg.output[k]
            if (part && part.type === 'input_text' && typeof part.text === 'string') {
              part.text = compressText(part.text, stats, 'openai-responses-array')
            }
          }
        }
        continue
      }

      // Shape 1: OpenAI tool message — { role:"tool", content: "string" }
      if (msg.role === 'tool' && typeof msg.content === 'string') {
        msg.content = compressText(msg.content, stats, 'openai-tool')
        continue
      }

      if (!Array.isArray(msg.content)) continue

      // Shape 1b: OpenAI tool message — { role:"tool", content:[{type:"text", text:"..."}] }
      if (msg.role === 'tool') {
        for (let k = 0; k < msg.content.length; k++) {
          const part = msg.content[k]
          if (part && part.type === 'text' && typeof part.text === 'string') {
            part.text = compressText(part.text, stats, 'openai-tool-array')
          }
        }
        continue
      }

      // Shape 2/3: blocks array with tool_result entries
      for (let j = 0; j < msg.content.length; j++) {
        const block = msg.content[j]
        if (!block || block.type !== 'tool_result') continue
        if (block.is_error === true) continue // preserve error traces

        if (typeof block.content === 'string') {
          // Shape 2: claude string form
          block.content = compressText(block.content, stats, 'claude-string')
        } else if (Array.isArray(block.content)) {
          // Shape 3: claude array form — compress each text part
          for (let k = 0; k < block.content.length; k++) {
            const part = block.content[k]
            if (part && part.type === 'text' && typeof part.text === 'string') {
              part.text = compressText(part.text, stats, 'claude-array')
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('[RTK] compressMessages error:', e.message)
    return null
  }
  return stats
}

// Compress Kiro format: conversationState.history[].userInputMessage.userInputMessageContext.toolResults[].content[].text
function compressKiroFormat(body, enabled) {
  const stats = { bytesBefore: 0, bytesAfter: 0, hits: [] }
  try {
    const state = body.conversationState
    const allMessages = [...(Array.isArray(state?.history) ? state.history : [])]
    if (state?.currentMessage) allMessages.push(state.currentMessage)

    for (const msg of allMessages) {
      const toolResults = msg?.userInputMessage?.userInputMessageContext?.toolResults
      if (!Array.isArray(toolResults)) continue

      for (const tr of toolResults) {
        if (tr.status === 'error') continue // preserve error traces
        if (!Array.isArray(tr.content)) continue

        for (const part of tr.content) {
          if (part && typeof part.text === 'string') {
            part.text = compressText(part.text, stats, 'kiro-tool-result')
          }
        }
      }
    }
  } catch (e) {
    console.warn('[RTK] compressKiroFormat error:', e.message)
    return null
  }
  return stats
}

/**
 * Compact one text blob, adding the outcome to `stats`.
 *
 * The size gate lives here rather than in the filters so every shape shares it:
 * a blob under the minimum is left alone (markers would cost more than the
 * saving), a blob over the cap is left alone (regex over a runaway dump is pure
 * latency), and an unrecognised blob is left alone (no filter fits). When a
 * filter *does* run, its output still has to be non-empty and strictly smaller,
 * which is the last line of defence against a filter bug reaching the wire.
 *
 * Exported because callers holding a bare string (a tool result they built
 * themselves) should not have to wrap it in a fake message to compact it.
 *
 * @param {string} text - the candidate blob
 * @param {{bytesBefore:number, bytesAfter:number, hits:Array<{shape:string,filter:string,saved:number}>}} stats - mutated in place
 * @param {string} shape - the wire shape label recorded on a hit
 * @returns {string} the compacted text, or `text` unchanged
 */
export function compressText(text, stats, shape) {
  const bytesIn = text.length
  stats.bytesBefore += bytesIn

  if (bytesIn < MIN_COMPRESS_SIZE || bytesIn > RAW_CAP) {
    stats.bytesAfter += bytesIn
    return text
  }

  const fn = autoDetectFilter(text)
  if (!fn) {
    stats.bytesAfter += bytesIn
    return text
  }

  const out = safeApply(fn, text)

  // Safety: never return empty, never grow the input
  if (!out || out.length === 0 || out.length >= bytesIn) {
    stats.bytesAfter += bytesIn
    return text
  }

  stats.bytesAfter += out.length
  stats.hits.push({ shape, filter: fn.filterName || fn.name, saved: bytesIn - out.length })
  return out
}

/**
 * One log line for a completed pass, or `null` when there is nothing to report.
 *
 * Kept from the source tool: the caller logs this and moves on. It names the
 * byte counts and the filters that fired, which is the only visibility anyone
 * has into why a request got smaller.
 */
export function formatRtkLog(stats) {
  if (!stats || !stats.hits || stats.hits.length === 0) return null
  const saved = stats.bytesBefore - stats.bytesAfter
  const pct = stats.bytesBefore > 0 ? ((saved / stats.bytesBefore) * 100).toFixed(1) : '0'
  const filters = Array.from(new Set(stats.hits.map(h => h.filter))).join(',')
  return `[RTK] saved ${saved}B / ${stats.bytesBefore}B (${pct}%) via [${filters}] hits=${stats.hits.length}`
}

// ── the host plugin's three wires ────────────────────────────────────────────

/**
 * Compact one wire's tool output, in place.
 *
 * The payload is mutated and returned under `payload` (the same reference the
 * caller passed) because that is how this plugin's other request stages work —
 * they adjust the body they were handed rather than allocating a copy. Pass
 * `{ enabled: false }` (or `false`) as the third argument for a per-request off
 * switch: the payload is then returned untouched and `stats.enabled` is false,
 * so a caller can log the decision without a second code path.
 *
 * An unrecognised `wire` is a caller bug and compacts nothing; guessing a shape
 * would risk rewriting a field this module does not own.
 *
 * `stats.bytesBefore`/`bytesAfter` measure only the tool-output text that was
 * considered, not the whole request, and they always satisfy
 * `bytesBefore - bytesAfter === saved` with `saved` equal to the sum of
 * `hits[].saved`.
 *
 * @param {object} payload - the outgoing request body
 * @param {'chat'|'messages'|'responses'} wire - which dialect the body is in
 * @param {boolean|{enabled?:boolean}} [options=true] - per-request switch
 * @returns {{payload: object, stats: {enabled:boolean,bytesBefore:number,bytesAfter:number,saved:number,hits:Array<{shape:string,filter:string,saved:number}>}}}
 */
export function compressRequest(payload, wire, options = true) {
  const enabled = resolveEnabled(options)
  const stats = { enabled, bytesBefore: 0, bytesAfter: 0, saved: 0, hits: [] }
  if (!enabled) return { payload, stats }
  if (payload === null || typeof payload !== 'object') return { payload, stats }

  try {
    if (wire === 'chat') compressChatPayload(payload, stats)
    else if (wire === 'messages') compressMessagesPayload(payload, stats)
    else if (wire === 'responses') compressResponsesPayload(payload, stats)
  } catch (error) {
    console.warn('[rtk] compressRequest error:', error?.message ?? error)
    // A blob whose walk threw was counted as "before" but never as "after";
    // putting the books back in order keeps the stats invariant true even on
    // the failure path (the blob is treated as passed through untouched).
    stats.bytesAfter = stats.bytesBefore - stats.hits.reduce((sum, hit) => sum + hit.saved, 0)
  }

  stats.saved = stats.bytesBefore - stats.bytesAfter
  return { payload, stats }
}

/** `chat`: OpenAI Chat Completions — `{role:'tool'}` results, string or text blocks. */
function compressChatPayload(payload, stats) {
  const items = Array.isArray(payload.messages) ? payload.messages : []
  for (const msg of items) {
    if (!msg) continue
    // Assistant turns carry the model's own `tool_calls`; those arguments are
    // the model's input to the tool, not its output, and rewriting them would
    // change what the tool was asked to do.
    if (msg.role !== 'tool') continue
    if (typeof msg.content === 'string') {
      msg.content = compressText(msg.content, stats, 'openai-tool')
      continue
    }
    if (!Array.isArray(msg.content)) continue
    for (const part of msg.content) {
      if (part && part.type === 'text' && typeof part.text === 'string') {
        part.text = compressText(part.text, stats, 'openai-tool-array')
      }
    }
  }
}

/** `messages`: Anthropic — `tool_result` blocks inside a user turn. */
function compressMessagesPayload(payload, stats) {
  const items = Array.isArray(payload.messages) ? payload.messages : []
  for (const msg of items) {
    if (!msg || !Array.isArray(msg.content)) continue
    for (const block of msg.content) {
      if (!block || block.type !== 'tool_result') continue
      // An errored tool result is the model's only evidence of the failure.
      if (block.is_error === true) continue
      if (typeof block.content === 'string') {
        block.content = compressText(block.content, stats, 'claude-string')
        continue
      }
      if (!Array.isArray(block.content)) continue
      for (const part of block.content) {
        if (part && part.type === 'text' && typeof part.text === 'string') {
          part.text = compressText(part.text, stats, 'claude-array')
        }
      }
    }
  }
}

/** `responses`: OpenAI Responses — `function_call_output` items in `input`. */
function compressResponsesPayload(payload, stats) {
  const items = Array.isArray(payload.input) ? payload.input : []
  for (const item of items) {
    if (!item || item.type !== 'function_call_output') continue
    if (typeof item.output === 'string') {
      item.output = compressText(item.output, stats, 'openai-responses-string')
      continue
    }
    if (!Array.isArray(item.output)) continue
    for (const part of item.output) {
      if (part && part.type === 'input_text' && typeof part.text === 'string') {
        part.text = compressText(part.text, stats, 'openai-responses-array')
      }
    }
  }
}

// ── reporting helpers ────────────────────────────────────────────────────────

/**
 * A one-line human summary of a pass, for a UI or a log line the user reads.
 *
 * Returns `null` only when there is nothing to say — no stats, or the pass was
 * switched off — so a caller can treat null as "do not print". An enabled pass
 * with no hits still gets a line: "(0%) — no tool output compacted" is a useful
 * fact (the saver ran and found nothing), and silence would look like the
 * saver never ran at all.
 */
export function describeSavings(stats) {
  if (!stats || stats.enabled === false) return null
  const before = Number.isFinite(stats.bytesBefore) ? stats.bytesBefore : 0
  const after = Number.isFinite(stats.bytesAfter) ? stats.bytesAfter : 0
  const saved = before - after
  const pct = before > 0 ? Math.round((saved / before) * 100) : 0
  const hits = Array.isArray(stats.hits) ? stats.hits : []
  const filters = Array.from(new Set(hits.map(hit => hit.filter)))
  if (hits.length === 0) {
    return `[token-saver] ${humanBytes(before)} -> ${humanBytes(after)} (0%) — no tool output compacted`
  }
  return `[token-saver] ${humanBytes(before)} -> ${humanBytes(after)} (${pct}%) via ${filters.join(', ')} (${hits.length} blocks)`
}

/** Byte count as a human would read it: B below 1 KiB, one decimal above. */
function humanBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

/**
 * Normalise the third argument of {@link compressRequest}: a boolean, or an
 * options object whose `enabled` flag is honoured (anything but an explicit
 * `false` means on, so a missing option is the enabled default).
 */
function resolveEnabled(options) {
  if (options === undefined || options === null) return true
  if (typeof options === 'object') return options.enabled !== false
  return options !== false
}
