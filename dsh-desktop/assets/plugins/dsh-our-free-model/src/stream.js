/**
 * Provider SSE -> harness `StreamChunk` projection for all three wire shapes the
 * free lane answers on.
 *
 * The harness contract (packages/llm/llm/src/types.ts StreamChunk) is a flat
 * indexed block protocol: every block is opened with `block-start`, fed with
 * deltas, and closed with `block-end` carrying the assembled block. Block
 * indices are allocated in arrival order, which is what the provider does with
 * reasoning-then-text on this lane anyway.
 *
 * Token accounting follows the harness's disjoint-count rule: `inputTokens` is
 * uncached input only, so the OpenAI `prompt_tokens` total has its cache hits
 * subtracted back out.
 *
 * @module src/stream.js
 */

import crypto from 'node:crypto'
import { classifyFailure } from './http.js'
import { restoreToolName } from './upstream.js'

/** DeepSeek v4-family models occasionally leak internal DSML control markup
 * into the visible content at the reasoning→action boundary (observed live
 * 2026-10-04: `\n\n<｜DSML｜ calls>\n` streamed as content right before a
 * legitimate tool call — the serving stack failed to intercept that token on
 * that sampling). Scrub `<｜DSML｜…>` fragments from the visible text as it
 * flows; a tail that could still complete into the opening is held back until
 * the next delta resolves it, and the close flush spills (or drops) what is
 * left. A user quoting the token verbatim in an answer loses those characters —
 * the trade is deliberate: leaking control tokens routinely is worse. */
const DSML_OPENING = '<｜DSML｜'
const DSML_TAG = /<｜DSML｜[^>]*>/g

function createDsmlScrubber() {
  let held = ''
  return {
    push(delta) {
      let text = held + delta
      held = ''
      const cut = text.lastIndexOf('<')
      if (cut !== -1) {
        const tail = text.slice(cut)
        if (DSML_OPENING.startsWith(tail) || (tail.startsWith(DSML_OPENING) && !tail.includes('>'))) {
          held = tail
          text = text.slice(0, cut)
        }
      }
      return text.replace(DSML_TAG, '')
    },
    flush() {
      const out = held
      held = ''
      if (out === '' || DSML_OPENING.startsWith(out) || (out.startsWith(DSML_OPENING) && !out.includes('>'))) return ''
      return out.replace(DSML_TAG, '')
    },
  }
}

/** Mint a tool-call id for providers that stream arguments without one. */
function mintToolCallId() {
  return `call_${crypto.randomBytes(12).toString('hex')}`
}

class BlockSink {
  constructor(yieldChunk, startIndex, checkpointLimit, onProgress) {
    this.emit = yieldChunk
    this.next = startIndex
    this.onProgress = typeof onProgress === 'function' ? onProgress : () => {}
    /** @type {Map<string, {index:number, kind:string, text:string, id?:string, name?:string, args?:string}>} */
    this.open = new Map()
    this.usage = undefined
    this.sawReasoning = false
    this.sawToolCall = false
    this.reasoningText = ''
    /** Concatenated answer text, capped like the reasoning checkpoint — feeds
     * the max-tokens continuation without buffering more than one cap's worth. */
    this.answerText = ''
    this.answerLimit = checkpointLimit
    this.checkpointLimit = checkpointLimit
    this.checkpointTruncated = false
    this.brokenToolCall = false
    this.lastToolKey = undefined
    this.dsml = createDsmlScrubber()
  }

  /**
   * Resolve the block a Chat tool delta belongs to.
   *
   * `tool_calls[].index` is the wire's accumulator key and is what real servers
   * send; keying calls without one to a constant merged every parallel call
   * into a single block with the ids overwriting each other. The call id —
   * present on exactly the shapes that omit the index — separates them, and a
   * bare arguments continuation continues the call in front of it.
   */
  toolKey(call) {
    if (call.index !== undefined && call.index !== null) {
      this.lastToolKey = `c${call.index}`
      return this.lastToolKey
    }
    if (typeof call.id === 'string' && call.id !== '') {
      for (const [key, block] of this.open) {
        if (block.kind === 'tool-call' && block.id === call.id) { this.lastToolKey = key; return key }
      }
      this.lastToolKey = `cid:${call.id}`
      return this.lastToolKey
    }
    return this.lastToolKey ?? 'c0'
  }

  /** Open (or fetch) the block a given stream slot maps to. */
  slot(key, kind) {
    if (kind === 'tool-call') this.sawToolCall = true
    const existing = this.open.get(key)
    if (existing !== undefined) return existing
    // A tool call without a provider id would come back next turn with an empty
    // toolCallId, which the pairing repair then drops on both sides — the model
    // never sees its own result and re-issues the call forever. Mint a stable
    // stand-in; a provider id arriving later still overrides it.
    const block = { index: this.next++, kind, text: '', args: '', id: kind === 'tool-call' ? mintToolCallId() : '', name: '' }
    this.open.set(key, block)
    this.emit({ type: 'block-start', index: block.index, blockType: kind === 'reasoning' ? 'reasoning' : kind === 'tool-call' ? 'tool-call' : 'text' })
    return block
  }

  text(key, delta) {
    if (delta === undefined || delta === null || delta === '') return
    const scrubbed = this.dsml.push(delta)
    if (scrubbed === '') return
    this.sawText = true
    if (this.answerText.length < this.answerLimit) {
      this.answerText += this.answerText.length + scrubbed.length > this.answerLimit
        ? scrubbed.slice(0, this.answerLimit - this.answerText.length)
        : scrubbed
    }
    const block = this.slot(key, 'text')
    block.text += scrubbed
    this.emit({ type: 'text-delta', index: block.index, text: scrubbed })
  }

  reasoning(key, delta) {
    if (delta === undefined || delta === null || delta === '') return
    this.sawReasoning = true
    const text = String(delta)
    const remaining = this.checkpointLimit - this.reasoningText.length
    if (text.length > remaining) this.checkpointTruncated = true
    this.reasoningText += text.slice(0, remaining)
    const block = this.slot(key, 'reasoning')
    block.text += delta
    this.emit({ type: 'reasoning-delta', index: block.index, text: delta })
  }

  toolStart(key, id, name) {
    const block = this.slot(key, 'tool-call')
    const priorId = block.id
    const priorName = block.name
    if (id) block.id = id
    if (name) block.name = name
    // A named call can precede its arguments without emitting a delta.
    if (typeof block.name === 'string' && block.name.trim() !== ''
      && (block.name !== priorName || block.id !== priorId)) this.onProgress()
  }

  toolArgs(key, delta) {
    this.sawToolCall = true
    if (!delta) return
    const block = this.slot(key, 'tool-call')
    block.args += delta
    // Arguments can arrive before the wire has named the call (a Claude-relay
    // stream does exactly this). The harness re-reads every chunk through a
    // lossless-JSON snapshot, which rejects an own `undefined` field outright —
    // so an unknown name is omitted from the delta, never sent as undefined.
    const name = typeof block.name === 'string' && block.name !== '' ? { name: block.name } : {}
    this.emit({ type: 'tool-call-delta', index: block.index, id: block.id ?? '', ...name, argumentsDelta: delta })
  }

  closeAll() {
    const spill = this.dsml.flush()
    let spilled = false
    for (const block of this.open.values()) {
      if (block.kind === 'text' && !spilled && spill !== '') {
        spilled = true
        block.text += spill
        this.emit({ type: 'text-delta', index: block.index, text: spill })
      }
      if (block.kind === 'text' && block.text !== '') this.emit({ type: 'block-end', index: block.index, block: { type: 'text', text: block.text } })
      else if (block.kind === 'reasoning' && block.text !== '') this.emit({ type: 'block-end', index: block.index, block: { type: 'reasoning', text: block.text } })
      else if (block.kind === 'tool-call') {
        // Arguments that never parse are an unexecutable call. The gateway
        // reports finish "tool_calls" even when the output ceiling cut the JSON
        // mid-string (verified live 2026-09-25), so the finish token alone
        // cannot be trusted; the adapter downgrades such a turn to max-tokens,
        // which makes the harness's assembler prune the call instead of
        // executing it and looping on the model's retry.
        try { JSON.parse(block.args === '' ? '{}' : block.args) } catch { this.brokenToolCall = true }
        // So is a call that never learned its name (issue #92): a relayed model
        // leaked its tool markup mid-text, the gateway half-parsed it into an
        // empty-named call shell, and the harness executed the nameless call as
        // `Error: unknown tool ""` — an *answered* poison pill repairToolPairing
        // keeps forever, failing every later turn on every model. Downgrade the
        // turn exactly like the unparseable-arguments case above.
        if (typeof block.name !== 'string' || block.name === '') this.brokenToolCall = true
        this.emit({
          type: 'block-end', index: block.index,
          // A call that never learned its id or name still has to close with
          // strings: the same lossless-JSON snapshot rejects `undefined`.
          block: { type: 'tool-call', id: block.id ?? '', name: block.name ?? '', arguments: block.args === '' ? '{}' : block.args },
        })
      }
    }
    this.open.clear()
  }
}

/**
 * Turn one provider `usage` object into the harness's disjoint TokenUsage.
 *
 * `prompt_tokens_details` is optional in the OpenAI schema, and the harness's
 * durable session log rejects a non-finite number outright — so an absent cache
 * count has to default to zero before the subtraction, not afterwards. Reading
 * `undefined` off the optional field turned `inputTokens` into `NaN`, which any
 * gateway that omits the details block would have handed the kernel on
 * every single call.
 */
export function mapUsage(usage) {
  if (!usage || typeof usage !== 'object') return undefined
  const prompt = number(usage.prompt_tokens ?? usage.input_tokens)
  const completion = number(usage.completion_tokens ?? usage.output_tokens)
  const cached = number(usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens) ?? 0
  const cacheWrite = number(usage.prompt_tokens_details?.cache_write_tokens)
  const reasoning = number(usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens)
  if (prompt === undefined && completion === undefined) return undefined
  const out = {
    inputTokens: Math.max(0, (prompt ?? 0) - cached),
    outputTokens: completion ?? 0,
  }
  if (cached > 0) out.cacheReadTokens = cached
  if (cacheWrite > 0) out.cacheWriteTokens = cacheWrite
  if (reasoning > 0) out.reasoningTokens = reasoning
  out.totalTokens = (prompt ?? 0) + (completion ?? 0)
  return out
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * The names a gateway may file streamed thinking under, in the order this
 * reader prefers them.
 *
 * `reasoning` is what this lane sends today. `reasoning_content` and
 * `reasoning_text` are the two other spellings in the wild — and the three of
 * them are exactly what pi-ai reads — so a turn whose thinking arrived under
 * one of the latter used to reach the harness as a turn with no thinking at
 * all: no reasoning block on screen, an empty `reasoningText` that keeps the
 * recovery path from firing, and a client left to call the answer empty.
 * `thinking` is the Anthropic chat-wire spelling some relays emit on the chat
 * endpoint too (issue #66: a lane whose only visible frames were reasoning
 * ones arriving under a name this reader skipped).
 */
const REASONING_FIELDS = ['reasoning', 'reasoning_content', 'reasoning_text', 'thinking']

/**
 * The thinking this frame carries, in whichever spelling it used.
 *
 * Only the first non-empty spelling is taken: some gateways report the same
 * text under two names at once (`reasoning_content` beside `reasoning`), and
 * reading every name would double the block and inflate the accounting.
 */
function reasoningOf(delta) {
  for (const field of REASONING_FIELDS) {
    const value = delta[field]
    if (typeof value === 'string' && value !== '') return value
  }
  if (Array.isArray(delta.reasoning_details)) {
    let text = ''
    for (const part of delta.reasoning_details) if (typeof part?.text === 'string') text += part.text
    if (text !== '') return text
  }
  return undefined
}

/**
 * Consume one parsed Chat Completions SSE payload.
 * @returns optional usage, and the provider finish token when present.
 */
function feedChat(sink, payload, renameMap, onFinish) {
  if (payload.usage) onFinish(mapUsage(payload.usage), 'usage')
  for (const choice of payload.choices ?? []) {
    const delta = choice.delta ?? {}
    const reasoning = reasoningOf(delta)
    if (reasoning !== undefined) sink.reasoning('r', reasoning)
    if (typeof delta.content === 'string') sink.text('t', delta.content)
    for (const call of delta.tool_calls ?? []) {
      sink.sawToolCall = true
      const key = sink.toolKey(call)
      const name = call.function?.name
      if (typeof name === 'string' && name !== '') sink.toolStart(key, call.id ?? '', restoreToolName(name, renameMap))
      else if (call.id) sink.toolStart(key, call.id, '')
      if (call.function?.arguments) sink.toolArgs(key, call.function.arguments)
    }
    if (choice.finish_reason) onFinish(undefined, 'finish', choice.finish_reason)
  }
}

/** Consume one parsed Anthropic Messages SSE event. */
function feedClaude(sink, event, onFinish, renameMap) {
  if (event.type === 'content_block_start') {
    const block = event.content_block
    if (block?.type === 'tool_use') sink.toolStart(`b${event.index}`, block.id ?? '', restoreToolName(block.name ?? '', renameMap))
    return
  }
  if (event.type === 'content_block_delta') {
    const part = event.delta
    if (part?.type === 'text_delta') sink.text(`b${event.index}`, part.text)
    else if (part?.type === 'thinking_delta') sink.reasoning(`b${event.index}`, part.thinking)
    else if (part?.type === 'input_json_delta') sink.toolArgs(`b${event.index}`, part.partial_json)
    return
  }
  if (event.type === 'message_start') {
    const usage = event.message?.usage
    if (usage) {
      const mapped = mapUsage({
        prompt_tokens: number(usage.input_tokens),
        completion_tokens: number(usage.output_tokens),
        prompt_tokens_details: { cached_tokens: number(usage.cache_read_input_tokens), cache_write_tokens: number(usage.cache_creation_input_tokens) },
      })
      if (mapped) onFinish(mapped, 'usage')
    }
    return
  }
  if (event.type === 'message_delta') {
    const usage = event.usage
    if (usage && number(usage.output_tokens) !== undefined) {
      onFinish({ outputTokens: number(usage.output_tokens) }, 'usage')
    }
    const stop = event.delta?.stop_reason
    if (stop) onFinish(undefined, 'finish', stop)
    return
  }
  // `message_stop` is the Messages wire's own end-of-turn frame. A stream that
  // carried it was closed on purpose, so it must not be read as a cut one even in
  // the rare case where the stop_reason frame was the one that went missing.
  if (event.type === 'message_stop') onFinish(undefined, 'finish', undefined)
}

/** Consume one parsed OpenAI Responses SSE event. */
function feedResponses(sink, event, onFinish, renameMap) {
  switch (event.type) {
    case 'response.output_item.added': {
      const item = event.item
      if (item?.type === 'function_call') sink.toolStart(`i${event.output_index}`, item.call_id ?? item.id ?? '', restoreToolName(item.name ?? '', renameMap))
      return
    }
    case 'response.content_part.added':
      return
    case 'response.output_text.delta':
      sink.text(`t${event.output_index}`, event.delta)
      return
    case 'response.reasoning_summary_text.delta':
    case 'response.output_reasoning.text.delta':
      sink.reasoning(`r${event.item_id ?? 'r'}`, event.delta)
      return
    case 'response.function_call_arguments.delta':
      sink.toolArgs(`i${event.output_index}`, event.delta)
      return
    // Every deliberate ending this wire has, not only the happy one. Reading just
    // `response.completed` as terminal made `response.incomplete` — the frame a
    // turn that hit the output ceiling ends on — look like a stream the gateway
    // cut, so issue #10's check retried a finished turn twice and then failed it.
    // The status still decides the finish token, so each ending maps to its own
    // harness reason; a bare sentinel frame carries none and only marks the end.
    case 'response.completed':
    case 'response.incomplete':
    case 'response.failed':
    case 'response.done': {
      const response = event.response
      if (response?.usage) {
        const mapped = mapUsage({
          prompt_tokens: number(response.usage.input_tokens),
          completion_tokens: number(response.usage.output_tokens),
          prompt_tokens_details: { cached_tokens: number(response.usage.input_tokens_details?.cached_tokens) },
          completion_tokens_details: { reasoning_tokens: number(response.usage.output_tokens_details?.reasoning_tokens) },
        })
        if (mapped) onFinish(mapped, 'usage')
      }
      const status = response?.status ?? (event.type === 'response.failed' ? 'failed'
        : event.type === 'response.incomplete' ? 'incomplete'
          : event.type === 'response.completed' ? 'completed' : undefined)
      const incomplete = response?.incomplete_details?.reason
      onFinish(undefined, 'finish', incomplete === 'max_output_tokens' ? 'length' : status === 'completed' ? 'stop' : status)
      return
    }
    default: return
  }
}

/** Map a provider finish token onto the harness finish reason. */
export function finishReason(token) {
  if (token === 'tool_calls' || token === 'tool_use' || token === 'function_call') return { kind: 'tool-calls' }
  if (token === 'length' || token === 'max_tokens' || token === 'max_output_tokens' || token === 'incomplete') return { kind: 'max-tokens' }
  return { kind: 'stop' }
}

/**
 * Output tokens that can honestly be divided by the measured window.
 *
 * Some models on this lane are billed for reasoning they never stream: measured
 * live, one call reported 422 output tokens of which 291 were reasoning, while
 * zero reasoning frames arrived. Those 291 were produced before the first frame
 * the window starts at, so counting them attributes a whole thinking phase to
 * the seconds the answer text took and published 349 tok/s for a 108 tok/s
 * answer. When reasoning did stream, the window covers it and the full count is
 * the right numerator.
 */
export function windowTokens(usage, sawReasoning) {
  const output = number(usage?.outputTokens) ?? 0
  if (sawReasoning) return output
  return Math.max(0, output - (number(usage?.reasoningTokens) ?? 0))
}

/**
 * Read one streamed response, yielding harness chunks as they are produced.
 *
 * Chunk emission stays synchronous inside the parsing of one payload, and the
 * outbox is drained after every payload, so the generator needs no racing or
 * polling to keep deltas flowing.
 *
 * @param {AsyncIterable<string>} lines - decoded `data:` payloads
 * @param {'chat'|'messages'|'responses'} wire
 * @param {Map<string, string>} renameMap - fingerprint spelling -> caller spelling
 * @param {() => number} [now] - clock stamping the first delivered delta
 * @param {object} [options] - 本次读取的索引与续写检查点限制
 * @param {number} [options.startIndex=0] - 新块的起始索引
 * @param {number} [options.checkpointLimit=131072] - 推理检查点的最大字符串长度
 * @param {(snapshot: object) => void} [options.onState] - 发布本次读取的已知状态
 * @param {() => void} [options.onProgress] - Meaningful tool metadata arrived before arguments.
 * @yields {object} harness StreamChunk
 * @returns {Promise<{ usage: object, finish?: string, sawFinish: boolean, sawUsage: boolean, sawToolCall: boolean, sawReasoning: boolean, firstDeltaAt?: number, nextIndex: number, reasoningText: string, checkpointTruncated: boolean }>}
 */
export async function * readStream(lines, wire, renameMap, now = () => Date.now(), options = {}) {
  const outbox = []
  const startIndex = Number.isSafeInteger(options?.startIndex) && options.startIndex >= 0 ? options.startIndex : 0
  const checkpointLimit = Number.isSafeInteger(options?.checkpointLimit) && options.checkpointLimit >= 0 ? options.checkpointLimit : 131072
  const sink = new BlockSink(chunk => outbox.push(chunk), startIndex, checkpointLimit, options?.onProgress)
  const state = { usage: undefined, finish: undefined, sawFinish: false, sawUsage: false, sawToolCall: false, firstDeltaAt: undefined, sawReasoning: false, sawText: false, brokenToolCall: false }
  const snapshot = () => ({
    ...state,
    nextIndex: sink.next,
    reasoningText: sink.reasoningText,
    answerText: sink.answerText,
    checkpointTruncated: sink.checkpointTruncated,
    usage: state.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  })
  const publishState = () => {
    if (typeof options?.onState === 'function') options.onState(snapshot())
  }

  const onFinish = (usage, kind, token) => {
    if (kind === 'usage' && usage !== undefined) {
      state.sawUsage = true
      const carried = state.usage
      // A usage report that names no input side is `message_delta` on the Messages
      // wire: it carries only the output count, and taking it whole dropped the
      // prompt counts `message_start` had already given for every Claude turn.
      state.usage = carried !== undefined && usage.inputTokens === undefined
        ? { ...carried, ...usage, totalTokens: Math.max(0, (carried.totalTokens ?? 0) - (carried.outputTokens ?? 0)) + (usage.outputTokens ?? 0) }
        : usage
    }
    // Which frame said so, not what it said: a stream that reached any of the
    // three wires' terminal events was closed by the model running out, while one
    // that never did was closed by something else, and only the second is a fault.
    if (kind !== 'finish') return
    state.sawFinish = true
    // A terminal frame that names no reason (`message_stop`, a `response.done`
    // carrying no response) marks the end but must not erase the finish token a
    // status-carrying frame already gave — losing it turned `length` into `stop`.
    if (token !== undefined) state.finish = token
  }

  try {
    for await (const raw of lines) {
      if (typeof raw !== 'string') continue
      const text = raw.trim()
      if (!text.startsWith('{')) continue
      let payload
      try { payload = JSON.parse(text) } catch { continue }
      if ((payload.type === 'response.failed' || payload.response?.status === 'failed') && payload.response?.error) {
        throw classifyFailure(undefined, { error: payload.response.error })
      }
      if (payload.type === 'error' || payload.error) {
        // Classify an in-stream refusal exactly as an error *envelope* is
        // classified, because everything downstream decides off `code`. This throw
        // used to carry only `llmCode`, which nothing reads: the failure reached
        // `toFailure` unrecognized and came out as `TRANSPORT` — a retryable code —
        // so the harness re-sent a turn whose partial answer had already been
        // streamed, and a mid-turn geography refusal never reached the re-probe
        // that watches for `CODE.region`.
        const failure = payload.error ?? payload
        const classified = classifyFailure(undefined, payload)
        if (typeof failure.message !== 'string') classified.message = 'upstream error'
        throw Object.assign(classified, { upstream: payload })
      }
      if (state.firstDeltaAt === undefined && carriesDelta(payload, wire)) state.firstDeltaAt = now()
      if (wire === 'chat') feedChat(sink, payload, renameMap, onFinish)
      else if (wire === 'messages') feedClaude(sink, payload, onFinish, renameMap)
      else feedResponses(sink, payload, onFinish, renameMap)
      if (sink.sawReasoning) state.sawReasoning = true
      if (sink.sawText) state.sawText = true
      if (sink.brokenToolCall) state.brokenToolCall = true
      if (sink.sawToolCall) state.sawToolCall = true
      publishState()
      while (outbox.length > 0) yield outbox.shift()
    }

    sink.closeAll()
    if (sink.brokenToolCall) state.brokenToolCall = true
    publishState()
    while (outbox.length > 0) yield outbox.shift()
    return snapshot()
  } catch (error) {
    publishState()
    throw error
  }
}

function carriesDelta(payload, wire) {
  if (wire === 'chat') return (payload.choices ?? []).some(choice => {
    const delta = choice.delta ?? {}
    // Every shape `feedChat` reads has to start the window here too: a spelling
    // it consumes while this test missed it made the first observed frame the
    // first *visible* one, which on a reasoning-heavy model is minutes after
    // decoding began.
    return (typeof delta.content === 'string' && delta.content !== '')
      || reasoningOf(delta) !== undefined
      || (delta.tool_calls ?? []).length > 0
  })
  if (wire === 'responses') return (typeof payload.delta === 'string' && payload.delta !== '') || payload.type === 'response.output_item.added'
  return payload.type === 'content_block_delta' || payload.type === 'content_block_start'
}
