/**
 * Anthropic Messages codec for the local `/v1/messages` listener.
 *
 * Claude-shaped clients speak a different dialect from the OpenAI ones the
 * forward listener already serves: `system` travels outside the turn list,
 * content is a list of typed blocks instead of a string, tools are declared with
 * `input_schema`, and the answer streams as a named-event protocol whose
 * `content_block_*` frames carry an index. This module is the pure half of that
 * surface — parsed bodies in, harness messages or complete SSE frame strings
 * out — so the listener itself can stay a thin routing shell and this codec can
 * be exercised without a socket.
 *
 * Nothing here does I/O: no sockets, no timers, no filesystem, no randomness.
 * Ids and clocks belong to the caller (state.messageId, the request's own
 * `model`), which is also what makes the frame renderer deterministic.
 *
 * Request translation, block by block:
 *
 * | Anthropic request | harness message shape |
 * | ----------------- | --------------------- |
 * | `system` string / text blocks | one flattened `system` string |
 * | `text` | `{type:'text', text}` |
 * | `image` base64 | `{type:'image', attachment:{url: data: URL, …}}` |
 * | `image` url | `{type:'image', attachment:{url, attachmentId:'url:…'}}` |
 * | `tool_use` | `{type:'tool-call', id, name, arguments: JSON.stringify(input)}` |
 * | `tool_result` | its own `role:'tool'` row (toolCallId + `source.callId`) |
 * | `thinking` | `{type:'reasoning', text}` on assistant history |
 * | `redacted_thinking` | dropped — opaque, account-bound ciphertext |
 * | `tools[].input_schema` | flat `{name, description, parameters}` |
 *
 * `thinking` -> `reasoning_effort`, bucketed against the free ladder's rungs
 * (see {@link reasoningEffortFor} for the thresholds and why `disabled` is the
 * off spelling).
 *
 * Streaming stop reasons:
 *
 * | harness finish chunk | Anthropic frames |
 * | -------------------- | ---------------- |
 * | `stop` | `message_delta.stop_reason = 'end_turn'` |
 * | `max-tokens` | `'max_tokens'` |
 * | `tool-calls`, or any tool block streamed | `'tool_use'` |
 * | `error` | `event: error` then `message_stop`, no `message_delta` |
 * | `aborted` | `event: error` then `message_stop`, no `message_delta` |
 *
 * @module src/anthropic.js
 */

import { carryFailure, forwardFailure } from './failure.js'

/** The plugin ships no tokenizer; the estimate below charges one token per
 *  four characters, the usual English-prose ratio, and a flat cost for each
 *  image because a base64 payload carries no dimensions to price properly. */
const CHARS_PER_TOKEN = 4
const IMAGE_TOKENS = 1024
const TOOL_FRAME_TOKENS = 8
/** Fixed framing overhead, so an empty body still answers a small non-zero
 *  number instead of 0 (a client that divides by the count must not see 0). */
const BASE_TOKENS = 16

/**
 * Thinking-budget buckets, chosen against `src/effort.js`'s free ladder:
 * `light` caps generation at 2048 tokens, `balanced` at 8192, and `deep` has no
 * rung of its own (the model's full capacity). A budget under half the balanced
 * rung asks for less deliberation than balanced provides, so it becomes
 * `light`; one at or above twice the balanced rung exceeds every rung and
 * becomes `deep`. The thresholds are deliberately round numbers, not the rungs
 * themselves: a caller sending exactly 8192 means "the default", not "deep".
 */
const BALANCED_AT = 4096
const DEEP_AT = 16384

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function string(value) {
  return typeof value === 'string' ? value : ''
}

/**
 * Flatten `system` — a string or a list of text blocks — into one string.
 *
 * Blocks are joined with a blank line, the same separator `toClaudeMessages`
 * uses when it merges several system rows, so a round trip through this codec
 * and the projector is stable.
 */
function flattenSystem(system) {
  if (typeof system === 'string') return system
  if (!Array.isArray(system)) return ''
  const parts = []
  for (const block of system) {
    if (typeof block === 'string') {
      if (block !== '') parts.push(block)
      continue
    }
    if (block?.type === 'text' && typeof block.text === 'string' && block.text !== '') parts.push(block.text)
  }
  return parts.join('\n\n')
}

/**
 * One Anthropic image source -> a harness image block.
 *
 * The attachment carries the data URL in `url` (what every projector reads) and
 * the same URL as `attachmentId` for the base64 case — the harness's attachment
 * identity — while a remote URL gets the short `url:`-prefixed key
 * `fromOpenAiMessages` already mints, because the full URL can be arbitrarily
 * long and is not an id. `bytes`/`width`/`height` stay 0: the caller's base64
 * payload is not decoded here (that would mean a decoder and a buffer copy in a
 * pure codec), and a URL's size is unknown until it is fetched.
 */
function harnessImage(source) {
  if (!isObject(source)) return undefined
  if (source.type === 'base64' && typeof source.data === 'string' && source.data !== '') {
    const mediaType = typeof source.media_type === 'string' && source.media_type !== '' ? source.media_type : 'image/png'
    const url = `data:${mediaType};base64,${source.data}`
    return { type: 'image', attachment: { attachmentId: url, mediaType, bytes: 0, width: 0, height: 0, url } }
  }
  if (source.type === 'url' && typeof source.url === 'string' && source.url !== '') {
    return {
      type: 'image',
      attachment: { attachmentId: `url:${source.url.slice(0, 64)}`, mediaType: 'image/png', bytes: 0, width: 0, height: 0, url: source.url },
    }
  }
  return undefined
}

/** A `tool_result` body (string or block list) -> harness content blocks. */
function toolResultBlocks(content) {
  if (typeof content === 'string') return content === '' ? [] : [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return []
  const out = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text !== '') out.push({ type: 'text', text: block.text })
    else if (block?.type === 'image') {
      const image = harnessImage(block.source)
      if (image !== undefined) out.push(image)
    }
  }
  return out
}

/**
 * An assistant turn's blocks.
 *
 * `thinking` is kept as a `reasoning` block because that is the harness's own
 * spelling for streamed thinking (see `readStream`'s `block-end` chunks) and
 * because every projector — `toChatMessages`, `toClaudeMessages`,
 * `toResponseInput` — drops reasoning blocks on the way upstream. Keeping them
 * therefore cannot replay prior thinking to the provider or trip a wire that
 * rejects it, while dropping them would erase a turn's reasoning from anything
 * that inspects the harness history.
 *
 * `redacted_thinking` is dropped instead of being mapped to an empty reasoning
 * block: its `data` is opaque ciphertext bound to the account that produced it,
 * the same class of payload the Responses projector refuses to echo for
 * encrypted reasoning items, and this codec cannot tell a valid blob from a
 * stale one.
 */
function assistantBlocks(blocks) {
  const content = []
  for (const block of blocks) {
    if (block?.type === 'text') {
      if (typeof block.text === 'string' && block.text !== '') content.push({ type: 'text', text: block.text })
      continue
    }
    if (block?.type === 'tool_use') {
      content.push({
        type: 'tool-call',
        id: String(block.id ?? ''),
        name: String(block.name ?? ''),
        arguments: JSON.stringify(block.input ?? {}),
      })
      continue
    }
    if (block?.type === 'thinking' && typeof block.thinking === 'string' && block.thinking !== '') {
      content.push({ type: 'reasoning', text: block.thinking })
    }
  }
  return content
}

/**
 * Anthropic `thinking` -> the effort id `src/effort.js` resolves.
 *
 * The returned ids are the free ladder's real rungs (`light`, `balanced`,
 * `deep`), not decorative adjectives: `resolveLevel` silently falls back to
 * `balanced` for any id it does not know, so an invented level would be a
 * budget that never reaches the wire. `disabled` is the one off spelling
 * effort.js declares (its level-name table maps `disabled` to "Off"); a
 * free-lane model has no off rung — that lane cannot switch thinking off at
 * all — so there it resolves to the model's default, while a model that
 * declares the level gets its off patch.
 */
function reasoningEffortFor(thinking) {
  if (!isObject(thinking)) return undefined
  if (thinking.type === 'disabled') return 'disabled'
  if (thinking.type !== 'enabled') return undefined
  const budget = number(thinking.budget_tokens)
  if (budget !== undefined && budget >= DEEP_AT) return 'deep'
  if (budget !== undefined && budget >= BALANCED_AT) return 'balanced'
  return 'light'
}

/**
 * Anthropic Messages request -> this plugin's internal request shape.
 *
 * Mirrors `fromOpenAiMessages` in index.js: each row becomes
 * `{role, content:[…]}` with `tool-call` blocks on assistant turns and
 * first-class `role:'tool'` rows for tool results, which is what
 * `repairToolPairing` and the projectors consume. Rows are only emitted when
 * they carry content; a turn that converted to nothing (a `redacted_thinking`
 * only assistant turn, say) is skipped rather than sent upstream empty.
 *
 * @param {object} body - parsed Anthropic Messages request body
 * @returns {{error: string} | {model: string, messages: Array, system: string,
 *   tools: Array, maxTokens: number|undefined, temperature: number|undefined,
 *   stream: boolean, reasoningEffort: string|undefined}}
 */
export function fromAnthropicRequest(body) {
  if (!isObject(body)) return { error: 'the request body must be a JSON object' }
  const model = typeof body.model === 'string' ? body.model.trim() : ''
  if (model === '') return { error: '`model` is required' }
  if (!Array.isArray(body.messages) || body.messages.length === 0) return { error: '`messages` must be a non-empty array' }

  let system = flattenSystem(body.system)
  const messages = []
  for (const row of body.messages) {
    if (!isObject(row)) continue
    const blocks = Array.isArray(row.content)
      ? row.content
      : typeof row.content === 'string' ? [{ type: 'text', text: row.content }] : []

    // Anthropic's own wire has no system role inside `messages`; a caller that
    // sends one anyway gets it hoisted into `system`, which is where the
    // projector would put it and is strictly more useful than an error.
    if (row.role === 'system' || row.role === 'developer') {
      const text = blocks
        .map(block => (typeof block === 'string' ? block : block?.type === 'text' ? string(block.text) : ''))
        .filter(part => part !== '')
        .join('\n\n')
      if (text !== '') system = system === '' ? text : `${system}\n\n${text}`
      continue
    }

    if (row.role === 'assistant') {
      const content = assistantBlocks(blocks)
      if (content.length === 0) continue
      messages.push({ role: 'assistant', content })
      continue
    }

    // Every other role (user, a missing role) is a user turn; tool results are
    // split out into their own rows, one per result, the way a v4 history
    // spells them — `toClaudeMessages` merges consecutive user-side rows back
    // into a single wire turn.
    const content = []
    for (const block of blocks) {
      if (block?.type === 'tool_result') {
        const callId = String(block.tool_use_id ?? '')
        messages.push({
          role: 'tool',
          content: toolResultBlocks(block.content),
          toolCallId: callId,
          source: { kind: 'tool', callId },
          // Omitted when false: the v4 session log rejects an explicit
          // `undefined`, and `false` is the projector's own default anyway.
          ...block.is_error === true ? { isError: true } : {},
        })
        continue
      }
      if (block?.type === 'text') {
        if (typeof block.text === 'string' && block.text !== '') content.push({ type: 'text', text: block.text })
        continue
      }
      if (block?.type === 'image') {
        const image = harnessImage(block.source)
        if (image !== undefined) content.push(image)
      }
    }
    if (content.length === 0) continue
    messages.push({ role: 'user', content })
  }
  // No convertible rows is the same class of failure as no messages at all:
  // sending an empty list upstream is a guaranteed 400 there, so it is refused
  // here with something a client can act on.
  if (messages.length === 0) return { error: 'the request carried no convertible content' }

  const tools = []
  for (const tool of Array.isArray(body.tools) ? body.tools : []) {
    if (!isObject(tool)) continue
    const name = typeof tool.name === 'string' ? tool.name.trim() : ''
    if (name === '') continue
    tools.push({
      name,
      description: string(tool.description),
      parameters: isObject(tool.input_schema) ? tool.input_schema : { type: 'object', properties: {} },
    })
  }

  const maxTokens = number(body.max_tokens)
  const temperature = number(body.temperature)
  return {
    model,
    messages,
    system,
    tools,
    // A non-positive ceiling is "no ceiling" to the adapter (`usableTokens`),
    // so it is reported as unset rather than passed along as 0.
    maxTokens: maxTokens !== undefined && maxTokens > 0 ? maxTokens : undefined,
    temperature,
    stream: body.stream === true,
    reasoningEffort: reasoningEffortFor(body.thinking),
  }
}

/** One complete SSE frame. Anthropic clients dispatch on `event:` and read the
 *  JSON payload; the trailing blank line terminates the frame. */
function sseFrame(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
}

function contentDelta(index, delta) {
  return sseFrame('content_block_delta', { type: 'content_block_delta', index, delta })
}

/** Repair a caller-built state object in place, so a partially seeded state is
 *  usable instead of producing `undefined` indices. */
function ensureState(state) {
  if (!Number.isSafeInteger(state.blockIndex) || state.blockIndex < 0) state.blockIndex = 0
  if (state.openBlock === undefined) state.openBlock = null
  if (!(state.toolSlots instanceof Map)) state.toolSlots = new Map()
  if (number(state.inputTokens) === undefined) state.inputTokens = 0
  if (number(state.outputTokens) === undefined) state.outputTokens = 0
}

/** Close the open text/thinking block, if one is open. */
function closeStreamingBlock(frames, state) {
  if (state.openBlock !== 'text' && state.openBlock !== 'thinking') return
  frames.push(sseFrame('content_block_stop', { type: 'content_block_stop', index: state.openIndex }))
  state.openBlock = null
  state.openIndex = null
}

/** Open (or keep) a text/thinking block. */
function openStreamingBlock(frames, state, kind) {
  if (state.openBlock === kind) return
  closeStreamingBlock(frames, state)
  const index = state.blockIndex++
  state.openIndex = index
  state.openBlock = kind
  const content_block = kind === 'text' ? { type: 'text', text: '' } : { type: 'thinking', thinking: '' }
  frames.push(sseFrame('content_block_start', { type: 'content_block_start', index, content_block }))
}

/** The per-slot renderer bookkeeping for one harness tool block. */
function toolSlot(state, key) {
  let slot = state.toolSlots.get(key)
  if (slot === undefined) {
    slot = { block: null, open: false, id: '', name: '', held: '' }
    state.toolSlots.set(key, slot)
  }
  return slot
}

/**
 * Open a tool_use block for a slot and spill whatever was held for it.
 *
 * Arguments are held until the call names itself (see `anthropicFrames`): an
 * Anthropic tool_use block cannot be announced without a name, and announcing
 * one with an empty name hands the client a call it cannot execute.
 */
function openToolBlock(frames, state, slot) {
  closeStreamingBlock(frames, state)
  const index = state.blockIndex++
  slot.block = index
  slot.open = true
  state.openBlock = 'tool_use'
  frames.push(sseFrame('content_block_start', {
    type: 'content_block_start',
    index,
    content_block: { type: 'tool_use', id: slot.id, name: slot.name, input: {} },
  }))
  if (slot.held !== '') {
    frames.push(contentDelta(index, { type: 'input_json_delta', partial_json: slot.held }))
    slot.held = ''
  }
}

/** Close one tool block. Tool blocks are tracked per slot rather than through
 *  `openBlock` because parallel calls may be open at the same time. */
function closeToolBlock(frames, state, slot) {
  if (slot.open !== true) return
  frames.push(sseFrame('content_block_stop', { type: 'content_block_stop', index: slot.block }))
  slot.open = false
  const another = [...state.toolSlots.values()].some(other => other.open === true)
  if (!another && state.openBlock === 'tool_use') state.openBlock = null
}

/** Close every block still open, in the order they were opened. */
function closeAllBlocks(frames, state) {
  closeStreamingBlock(frames, state)
  for (const slot of state.toolSlots.values()) closeToolBlock(frames, state, slot)
}

/** Has any tool block actually been announced? Used for the stop_reason
 *  fallback: a nameless call that never opened a block is not one. */
function hasToolBlock(state) {
  for (const slot of state.toolSlots.values()) if (slot.block !== null) return true
  return false
}

/**
 * One harness chunk -> zero or more Anthropic SSE frames.
 *
 * The caller owns `state` and must seed it once per stream:
 *
 * ```js
 * const state = {
 *   messageId: 'msg_…', model, started: false, blockIndex: 0,
 *   openBlock: null, toolSlots: new Map(),
 *   inputTokens: 0, outputTokens: 0, stopReason: null,
 * }
 * ```
 *
 * Two implementation fields ride along in it: `openIndex` (the index of the
 * open text/thinking block — `openBlock` only names its kind) and, per
 * `toolSlots` entry, `block`/`open`/`held` (the announced index, whether it is
 * still open, and argument fragments held until the call names itself).
 *
 * Block discipline:
 *
 * - `message_start` is emitted once, before the first chunk's own frames, with
 *   the input count the state already carries (a caller that ran `countTokens`
 *   can seed it; otherwise the real count arrives later and is repeated in
 *   `message_delta`).
 * - One text/thinking block is open at a time; a delta of the other kind closes
 *   it first. Tool blocks are the exception: each is closed by its own
 *   `block-end`, so parallel tool calls can stream concurrently, which is
 *   exactly what index-keyed Anthropic clients expect (the alternative —
 *   closing a tool block to open another — would split one call's JSON across
 *   two blocks with the same id and make the client execute it twice).
 * - `usage` frames carry no frame of their own: Anthropic reports input tokens
 *   in `message_start` and output tokens in `message_delta`.
 *
 * @param {object} chunk - harness StreamChunk (`text-delta`, `reasoning-delta`,
 *   `tool-call-delta`, `block-end`, `usage`, `finish`; anything else is ignored)
 * @param {object} state - per-stream state, mutated in place
 * @returns {string[]} complete `event: …\ndata: …\n\n` frames
 */
export function anthropicFrames(chunk, state) {
  const frames = []
  if (!isObject(chunk) || !isObject(state)) return frames
  ensureState(state)
  if (state.started !== true) {
    state.started = true
    frames.push(sseFrame('message_start', {
      type: 'message_start',
      message: {
        id: String(state.messageId ?? ''),
        type: 'message',
        role: 'assistant',
        model: String(state.model ?? ''),
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: state.inputTokens, output_tokens: 0 },
      },
    }))
  }

  switch (chunk.type) {
    case 'text-delta': {
      const text = string(chunk.text)
      if (text === '') break
      openStreamingBlock(frames, state, 'text')
      frames.push(contentDelta(state.openIndex, { type: 'text_delta', text }))
      break
    }

    case 'reasoning-delta': {
      const text = string(chunk.text)
      if (text === '') break
      openStreamingBlock(frames, state, 'thinking')
      frames.push(contentDelta(state.openIndex, { type: 'thinking_delta', thinking: text }))
      break
    }

    case 'tool-call-delta': {
      const slot = toolSlot(state, chunk.index)
      const fragment = string(chunk.argumentsDelta)
      if (slot.open === true) {
        if (fragment !== '') frames.push(contentDelta(slot.block, { type: 'input_json_delta', partial_json: fragment }))
        break
      }
      // The name can trail the first argument fragments on a relayed stream;
      // hold the fragments until the call can be announced with a name.
      if (slot.name === '' && typeof chunk.name === 'string' && chunk.name !== '') slot.name = chunk.name
      if (slot.id === '' && typeof chunk.id === 'string' && chunk.id !== '') slot.id = chunk.id
      if (slot.name === '') {
        slot.held += fragment
        break
      }
      // The held prefix goes out before this chunk's own fragment, so the
      // partial_json deltas reassemble in the order the arguments arrived.
      openToolBlock(frames, state, slot)
      if (fragment !== '') frames.push(contentDelta(slot.block, { type: 'input_json_delta', partial_json: fragment }))
      break
    }

    case 'block-end': {
      const block = isObject(chunk.block) ? chunk.block : {}
      if (block.type === 'tool-call') {
        const slot = toolSlot(state, chunk.index)
        if (slot.open === true) {
          closeToolBlock(frames, state, slot)
          break
        }
        // The block never opened: either the call carried no argument delta at
        // all (name only), or its name arrived only here. The block-end carries
        // the assembled arguments, so it replaces any fragments held from a
        // name-less prefix — they are that same string's prefix.
        if (slot.name === '') slot.name = string(block.name)
        if (slot.id === '') slot.id = string(block.id)
        slot.held = string(block.arguments)
        // A call that never learned a name is not executable: the harness
        // downgrades such a turn to max-tokens, and Anthropic's tool_use
        // requires a name, so announcing it would hand the client a call it
        // cannot run.
        if (slot.name === '') {
          slot.held = ''
          break
        }
        openToolBlock(frames, state, slot)
        closeToolBlock(frames, state, slot)
        break
      }
      if (block.type === 'text') {
        if (state.openBlock === 'text') closeStreamingBlock(frames, state)
        break
      }
      if (block.type === 'reasoning') {
        if (state.openBlock === 'thinking') closeStreamingBlock(frames, state)
        break
      }
      break
    }

    case 'usage': {
      const usage = isObject(chunk.usage) ? chunk.usage : {}
      const input = number(usage.inputTokens) ?? number(usage.input_tokens)
      const output = number(usage.outputTokens) ?? number(usage.output_tokens)
      if (input !== undefined) state.inputTokens = input
      if (output !== undefined) state.outputTokens = output
      break
    }

    case 'finish': {
      const reason = isObject(chunk.reason) ? chunk.reason : {}
      // Recorded before anything else: a caller driving this generator over a
      // stream it did not originate (the listener, which has to synthesize an
      // error frame when a turn throws after its headers went out) needs to know
      // the turn already closed its own stream — otherwise it appends a second
      // `message_stop`, which strict clients reject as a protocol error.
      state.finished = true
      closeAllBlocks(frames, state)
      // `error` and `aborted` have no Anthropic stop_reason to report: the
      // protocol answers a turn it could not finish with an error event, and
      // the stream ends there (the message_stop after it is what the client's
      // reader waits for before releasing the request). No message_delta goes
      // out, because a stop_reason would claim the turn ended on purpose.
      if (reason.kind === 'error' || reason.kind === 'aborted') {
        const carried = string(reason.failure?.message)
        const message = carried !== '' ? carried : reason.kind === 'aborted' ? 'request aborted' : 'our free model failed the turn'
        state.stopReason = null
        const failure = carryFailure(reason.failure, reason.kind)
        frames.push(sseFrame('error', { type: 'error', error: forwardFailure({ error: message, failure }, true).error }))
        frames.push(sseFrame('message_stop', { type: 'message_stop' }))
        break
      }
      const stopReason = reason.kind === 'max-tokens'
        ? 'max_tokens'
        : reason.kind === 'tool-calls' || hasToolBlock(state) ? 'tool_use' : 'end_turn'
      state.stopReason = stopReason
      frames.push(sseFrame('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        // `message_start` already carried input_tokens, but the harness reports
        // usage at the end of the turn; repeating the count here keeps a
        // client's final usage from staying at the 0 that went out first.
        usage: state.inputTokens > 0
          ? { input_tokens: state.inputTokens, output_tokens: state.outputTokens }
          : { output_tokens: state.outputTokens },
      }))
      frames.push(sseFrame('message_stop', { type: 'message_stop' }))
      break
    }

    default: break
  }
  return frames
}

/** The usage an outcome carries, in either spelling, as Anthropic counters.
 *  Accepting both lets `anthropicMessage` render an outcome folded by this
 *  module (`input_tokens`/`output_tokens`) or by index.js's OpenAI-side fold
 *  (`prompt_tokens`/`completion_tokens`). */
function usageOf(usage) {
  const input = number(usage?.input_tokens) ?? number(usage?.inputTokens) ?? number(usage?.prompt_tokens)
  const output = number(usage?.output_tokens) ?? number(usage?.outputTokens) ?? number(usage?.completion_tokens)
  return { input: input ?? 0, output: output ?? 0 }
}

/**
 * Tool arguments -> the `input` object of a `tool_use` block.
 *
 * Unparseable arguments become `{}`, and the raw fragment is deliberately not
 * echoed anywhere: Anthropic's `input` is typed as an object, so there is no
 * field that could carry the broken text, and a call with empty input fails
 * loudly at execution time — the model sees an error and can retry — whereas
 * dropping the block would erase a call the model believes it made. The same
 * choice covers JSON that parses to a non-object (a bare string or array):
 * Anthropic's schema rejects it, so it is not passed through.
 */
function parseInput(argumentsText) {
  if (typeof argumentsText !== 'string' || argumentsText.trim() === '') return {}
  try {
    const parsed = JSON.parse(argumentsText)
    return isObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Non-streaming: fold an outcome into one Anthropic Message object.
 *
 * The outcome is the shape `foldAnthropicOutcome` (or index.js's
 * `foldForwardOutcome`) accumulates. Content order follows Anthropic's rule
 * that a thinking block precedes the answer: thinking, then text, then one
 * `tool_use` block per call. The thinking block carries no `signature` — no
 * valid signature exists on this side of the wire, and an empty string would
 * be a lie a replaying client could not verify; the block is informational
 * here, and the plugin never sends it back upstream.
 *
 * An errored outcome still renders a well-formed message (so a caller that
 * ignores `error` gets an object, not `undefined`), with `stop_reason`
 * `end_turn`; the endpoint is expected to check `outcome.error` first and
 * answer with an HTTP error instead.
 *
 * @param {object} outcome - `{text, thinking, toolCalls:[{id,name,arguments}],
 *   usage, truncated, error}`
 * @param {{model?: string, id?: string}} identity - the message id and model
 *   the endpoint minted for this response
 * @returns {object} Anthropic Message
 */
export function anthropicMessage(outcome, { model, id } = {}) {
  const text = string(outcome?.text)
  const thinking = string(outcome?.thinking)
  const calls = Array.isArray(outcome?.toolCalls) ? outcome.toolCalls : []
  const content = []
  if (thinking !== '') content.push({ type: 'thinking', thinking })
  if (text !== '') content.push({ type: 'text', text })
  for (const call of calls) {
    content.push({
      type: 'tool_use',
      id: String(call?.id ?? ''),
      name: String(call?.name ?? ''),
      input: parseInput(call?.arguments),
    })
  }
  const usage = usageOf(outcome?.usage)
  return {
    id: String(id ?? ''),
    type: 'message',
    role: 'assistant',
    model: String(model ?? ''),
    content,
    // A ceiling cut wins over a tool call: the harness downgrades a call whose
    // JSON the ceiling cut mid-string to max-tokens, and reporting `tool_use`
    // for it is how a client ends up executing a truncated call.
    stop_reason: outcome?.truncated === true ? 'max_tokens' : calls.length > 0 ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: usage.input, output_tokens: usage.output },
  }
}

/** Harness usage -> the Anthropic spelling stored on an outcome. */
function toAnthropicUsage(usage) {
  if (!isObject(usage)) return undefined
  const input = number(usage.inputTokens) ?? number(usage.input_tokens) ?? number(usage.prompt_tokens)
  const output = number(usage.outputTokens) ?? number(usage.output_tokens) ?? number(usage.completion_tokens)
  if (input === undefined && output === undefined) return undefined
  const reasoning = number(usage.reasoningTokens)
  return {
    input_tokens: input ?? 0,
    output_tokens: output ?? 0,
    total_tokens: (input ?? 0) + (output ?? 0),
    ...reasoning === undefined || reasoning <= 0 ? {} : { reasoning_tokens: reasoning },
  }
}

/**
 * Fold one harness chunk into the outcome object — the Anthropic-side twin of
 * index.js's `foldForwardOutcome`.
 *
 * The caller seeds the outcome exactly as the OpenAI path does:
 * `{text:'', thinking:'', toolCalls:[], usage:undefined, truncated:false,
 * error:undefined}`. Tool calls merge by the harness block index (the `slot`
 * field), mirroring `foldForwardOutcome`, because a call's fragments arrive as
 * several deltas and its block-end may be the only chunk that carries it.
 *
 * @param {object} outcome - mutated in place and returned
 * @param {object} chunk - harness StreamChunk
 * @returns {object} the same outcome
 */
export function foldAnthropicOutcome(outcome, chunk) {
  switch (chunk?.type) {
    case 'text-delta':
      outcome.text += string(chunk.text)
      break
    case 'reasoning-delta':
      outcome.thinking += string(chunk.text)
      break
    case 'tool-call-delta': {
      let call = outcome.toolCalls.find(candidate => candidate.slot === chunk.index)
      if (call === undefined) {
        call = { slot: chunk.index, id: chunk.id ?? '', name: chunk.name ?? '', arguments: chunk.argumentsDelta ?? '' }
        outcome.toolCalls.push(call)
      } else {
        call.arguments += chunk.argumentsDelta ?? ''
      }
      if (chunk.name) call.name = chunk.name
      if (chunk.id) call.id = chunk.id
      break
    }
    case 'block-end':
      if (chunk.block?.type === 'tool-call') {
        // Match by slot first: the call's deltas were folded under this same
        // block index, and a relayed stream can carry its id late — matching
        // by id alone would miss the slot's entry and fold one call into two
        // (a phantom `tool_use` with an empty id and truncated arguments
        // beside the complete one). The block-end carries the assembled
        // arguments, so a slot match adopts them wholesale — the same
        // replacement the streaming renderer's `held` slot does — while an id
        // match (deltas under another slot) only fills identity fields.
        const bySlot = outcome.toolCalls.find(candidate => candidate.slot === chunk.index)
        if (bySlot !== undefined) {
          bySlot.id = string(chunk.block.id) !== '' ? chunk.block.id : bySlot.id
          bySlot.name = string(chunk.block.name) !== '' ? chunk.block.name : bySlot.name
          if (typeof chunk.block.arguments === 'string') bySlot.arguments = chunk.block.arguments
          break
        }
        const byId = outcome.toolCalls.find(candidate => candidate.id !== '' && candidate.id === chunk.block.id)
        if (byId === undefined) {
          outcome.toolCalls.push({
            slot: chunk.index,
            id: string(chunk.block.id),
            name: string(chunk.block.name),
            arguments: string(chunk.block.arguments),
          })
        }
      }
      break
    case 'usage':
      outcome.usage = toAnthropicUsage(chunk.usage)
      break
    case 'finish':
      if (chunk.reason?.kind === 'max-tokens') outcome.truncated = true
      if (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted') {
        outcome.failure = carryFailure(chunk.reason.failure, chunk.reason.kind)
        outcome.error = outcome.failure.message
      }
      break
    default: break
  }
  return outcome
}

/**
 * Cheap token estimate for `POST /v1/messages/count_tokens`.
 *
 * This is an estimate, not a tokenizer: the plugin ships none, and the free
 * lane bills on its own accounting. The heuristic charges one token per four
 * characters of text (system prompt, message text, thinking, tool arguments and
 * tool results alike), a flat 1024 tokens per image — a base64 payload carries
 * no dimensions to price properly — plus one token per four characters of the
 * serialized tool schemas and 8 tokens of framing per tool. A fixed 16-token
 * request overhead keeps an empty body from answering 0, which a client that
 * divides by the count would turn into an error.
 *
 * @param {object} body - an Anthropic Messages request body (may be partial)
 * @returns {{input_tokens: number}}
 */
export function countTokens(body) {
  let textChars = flattenSystem(body?.system).length
  let images = 0
  const rows = Array.isArray(body?.messages) ? body.messages : []
  for (const row of rows) {
    const blocks = Array.isArray(row?.content)
      ? row.content
      : typeof row?.content === 'string' ? [{ type: 'text', text: row.content }] : []
    for (const block of blocks) {
      if (block?.type === 'text') textChars += string(block.text).length
      else if (block?.type === 'image') images += 1
      else if (block?.type === 'tool_use') textChars += string(block.name).length + JSON.stringify(block.input ?? {}).length
      else if (block?.type === 'tool_result') {
        if (typeof block.content === 'string') textChars += block.content.length
        else if (Array.isArray(block.content)) {
          for (const inner of block.content) {
            if (inner?.type === 'text') textChars += string(inner.text).length
            else if (inner?.type === 'image') images += 1
          }
        }
      } else if (block?.type === 'thinking') textChars += string(block.thinking).length
      else if (block?.type === 'redacted_thinking') textChars += string(block.data).length
    }
  }
  let toolChars = 0
  let toolCount = 0
  for (const tool of Array.isArray(body?.tools) ? body.tools : []) {
    if (!isObject(tool)) continue
    toolCount += 1
    toolChars += string(tool.name).length + string(tool.description).length + JSON.stringify(tool.input_schema ?? {}).length
  }
  const toolTokens = toolCount === 0 ? 0 : Math.ceil(toolChars / CHARS_PER_TOKEN) + toolCount * TOOL_FRAME_TOKENS
  return {
    input_tokens: BASE_TOKENS + Math.ceil(textChars / CHARS_PER_TOKEN) + images * IMAGE_TOKENS + toolTokens,
  }
}
