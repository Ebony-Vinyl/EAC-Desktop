/**
 * Harness message vocabulary <-> upstream wire shapes, plus the SSE readers that
 * turn provider events back into harness `StreamChunk`s.
 *
 * Three provider shapes are in play because the free lane is not one API:
 * `chat` (OpenAI Chat Completions), `responses` (OpenAI Responses) and
 * `messages` (Anthropic Messages). Which one a model answers on is fixed by
 * {@link module:src/upstream~endpointFor}.
 *
 * @module src/messages.js
 */

import { MAX_TOOL_NAME_LEN, baseModelId, restoreToolName } from './upstream.js'

/** Content types an image lane can carry, matched against the verified media type. */
const IMAGE_MEDIA = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** Text of a content block list, joining every text-bearing block. */
function textOf(blocks) {
  const parts = []
  for (const block of blocks ?? []) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

/**
 * Normalise a message's content into a block list.
 *
 * The harness always supplies blocks, but this projector is reused by the forward
 * listener, where an OpenAI caller legitimately sends a bare string.
 */
function blocksOf(content) {
  if (typeof content === 'string') return content === '' ? [] : [{ type: 'text', text: content }]
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return { type: 'text', text: part }
      if (part?.type === 'text' || part?.type === 'input_text' || part?.type === 'output_text') return { type: 'text', text: String(part.text ?? '') }
      return part
    }).filter(block => block !== null && typeof block === 'object')
  }
  return []
}

function hasBlocks(blocks, type) {
  return Array.isArray(blocks) && blocks.some(block => block?.type === type)
}

/** A user image block's data URL, or undefined when it cannot travel. */
function imageDataUrl(block, resolveImage) {
  if (block?.offloaded === true) return undefined
  return resolveImage?.(block.attachment) ?? (typeof block.attachment?.url === 'string' ? block.attachment.url : undefined)
}

/**
 * The tool results one message carries, in whichever vocabulary the kernel wrote it.
 *
 * dsh changed shape between session formats: before V4 a tool answer was a
 * `user` message whose content held a `tool-result` wrapper block, and V4 made it
 * a first-class `tool` message whose content *is* the result. Both generations
 * are installed in the field, and a projector that reads only one of them ships
 * every tool-using turn upstream with its results missing — which the model
 * cannot notice, so it re-issues the same call until the user stops it.
 */
function toolResultsOf(message) {
  if (message?.role === 'tool') {
    const id = callIdOf(message)
    return id === null ? [] : [{ callId: id, content: blocksOf(message.content), isError: message.isError === true }]
  }
  const out = []
  for (const block of blocksOf(message?.content)) {
    if (block?.type !== 'tool-result') continue
    const id = String(block.toolCallId ?? message?.source?.callId ?? '')
    if (id === '') continue
    out.push({ callId: id, content: blocksOf(block.content), isError: block.isError === true })
  }
  return out
}

/**
 * Drop tool calls that were never answered, and answers with no call.
 *
 * Every supported wire enforces that a tool call is followed by its result, and
 * a turn interrupted between the two — the tool failed to start, the user
 * aborted, the harness crashed — leaves exactly that in the durable history.
 * Replaying it is not merely untidy: the free lane answers `400
 * [invalid_request_error]`, which then fails every later turn in that session,
 * not just the one that broke. Repairing here covers all three wires at once.
 */
export function repairToolPairing(messages) {
  const list = messages ?? []
  const answered = new Set()
  for (const message of list) {
    for (const result of toolResultsOf(message)) answered.add(result.callId)
  }

  const keptCalls = new Set()
  const out = []
  for (const message of list) {
    const results = toolResultsOf(message)
    if (results.length > 0) {
      // Resolvable here because a call always precedes its own answer.
      if (message.role === 'tool') {
        if (keptCalls.has(results[0].callId)) out.push(message)
        continue
      }
      const kept = new Set(results.filter(result => keptCalls.has(result.callId)).map(result => result.callId))
      const blocks = blocksOf(message.content)
      const rest = blocks.filter(block => block?.type !== 'tool-result'
        || kept.has(String(block.toolCallId ?? message.source?.callId ?? '')))
      if (rest.length === blocks.length) out.push(message)
      else if (rest.length > 0) out.push({ ...message, content: rest })
      continue
    }
    // A tool answer with no call id to key on answers nothing, and an empty
    // `tool_call_id` on the wire is a 400 for the whole turn.
    if (message?.role === 'tool') continue
    if (message?.role !== 'assistant') {
      out.push(message)
      continue
    }
    const blocks = blocksOf(message.content)
    const toolBlocks = blocks.filter(block => block?.type === 'tool-call')
    // A call with no name is not executable, and one that reached the host was
    // answered `Error: unknown tool ""` — an *answered* call, so the answered-id
    // test alone kept it in the history forever and every later turn 400'd on
    // every model (issue #92). A nameless call is dropped like an unanswered
    // one; its result then fails the kept-calls test below and goes with it.
    const calls = toolBlocks.filter(block => answered.has(String(block.id ?? '')) && String(block.name ?? '') !== '')
    for (const call of calls) keptCalls.add(String(call.id))
    if (calls.length === toolBlocks.length) {
      // Untouched when nothing was dropped, including the all-text case.
      if (calls.length > 0 || blocks.some(block => block?.type === 'text' && block.text)) out.push(message)
      continue
    }
    if (calls.length === 0) {
      // An assistant turn whose only content was calls that never landed says
      // nothing the model may keep believing. Text does survive — but the dead
      // calls still go, or the wire answers 400 for every later turn too.
      if (blocks.some(block => block?.type === 'text' && block.text)) {
        out.push({ ...message, content: blocks.filter(block => block?.type !== 'tool-call') })
      }
      continue
    }
    out.push({ ...message, content: blocks.filter(block => block?.type !== 'tool-call' || calls.includes(block)) })
  }

  return out
}

function callIdOf(message) {
  const id = String(message?.toolCallId ?? message?.source?.callId ?? '')
  return id === '' ? null : id
}

/**
 * Project harness messages onto OpenAI Chat Completions.
 *
 * Assistant reasoning is never replayed upstream; only visible text and tool
 * calls are. Tool results are first-class `role: 'tool'` messages keyed by the
 * provider call id they answer.
 */
export function toChatMessages(messages, resolveImage, warnings) {
  const out = []
  const followUp = []
  const flushFollowUp = () => {
    if (followUp.length > 0) out.push({ role: 'user', content: followUp.splice(0) })
  }
  for (const message of messages ?? []) {
    const results = toolResultsOf(message)
    // A parallel call batch spans several V4 tool messages (or V3 wrappers).
    // Every result must precede image/user content, including across messages.
    if (results.length === 0) flushFollowUp()
    let blocks = blocksOf(message.content)
    if (results.length > 0) {
      // `role: 'tool'` carries text only, so an image a tool returned travels as
      // the user turn after it — the same split the kernel's own adapter makes,
      // and the reason a `read_image` result is not silently lost.
      for (const result of results) {
        const images = []
        for (const block of result.content) {
          if (block?.type !== 'image') continue
          const url = imageDataUrl(block, resolveImage)
          if (url !== undefined) images.push({ type: 'image_url', image_url: { url } })
          else if (warnings) warnings.push('image-dropped')
        }
        const text = textOf(result.content)
        out.push({ role: 'tool', tool_call_id: result.callId, content: text || (images.length > 0 ? '(see attached image)' : '(no output)') })
        if (images.length > 0) {
          followUp.push({ type: 'text', text: `The result of tool call ${result.callId} is ${images.length} image(s), attached below.` }, ...images)
        }
      }
      blocks = blocks.filter(block => block?.type !== 'tool-result')
    }
    switch (message.role) {
      case 'system':
      case 'developer': {
        const text = textOf(blocks)
        if (text) out.push({ role: 'system', content: text })
        break
      }
      case 'user': {
        const parts = []
        for (const block of blocks) {
          if (block?.type === 'text' && block.text) parts.push({ type: 'text', text: block.text })
          else if (block?.type === 'image') {
            const url = imageDataUrl(block, resolveImage)
            if (url !== undefined) parts.push({ type: 'image_url', image_url: { url } })
            else if (warnings) warnings.push('image-dropped')
          }
        }
        if (parts.length === 0) {
          const fallback = textOf(blocks)
          if (fallback) out.push({ role: 'user', content: fallback })
          break
        }
        if (results.length > 0) followUp.push(...parts)
        else out.push({
          role: 'user',
          content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts,
        })
        break
      }
      case 'assistant': {
        const text = textOf(blocks)
        const calls = []
        for (const block of blocks) {
          if (block?.type === 'tool-call') {
            calls.push({
              id: String(block.id ?? ''),
              type: 'function',
              function: { name: String(block.name ?? ''), arguments: typeof block.arguments === 'string' ? block.arguments : '{}' },
            })
          }
        }
        if (!text && calls.length === 0) break
        const entry = { role: 'assistant', content: text || null }
        if (calls.length > 0) entry.tool_calls = calls
        out.push(entry)
        break
      }
      case 'tool': break
      default: break
    }
  }
  flushFollowUp()
  return out
}

/** A Claude `image` block from a resolved image URL, or undefined when it cannot travel. */
function claudeImageBlock(url, warnings) {
  if (url === undefined) {
    if (warnings) warnings.push('image-dropped')
    return undefined
  }
  const comma = String(url).indexOf(',')
  const head = comma === -1 ? '' : String(url).slice(0, comma)
  const media = head.match(/data:([^;]+)/)?.[1]
  if (media === undefined || !IMAGE_MEDIA.has(media)) {
    if (warnings) warnings.push('image-dropped')
    return undefined
  }
  return { type: 'image', source: { type: 'base64', media_type: media, data: String(url).slice(comma + 1) } }
}

/** Project harness messages onto the Anthropic Messages shape. */
export function toClaudeMessages(messages, resolveImage, warnings) {
  const out = []
  let systemText = ''
  // One turn per role, merged: the kernel's own Messages adapter concatenates a
  // result onto the preceding wire turn, and a pre-V4 history answers tool calls
  // as separate user messages that would otherwise land as consecutive user
  // turns — which is the shape the `messages` wire rejects.
  const push = (role, blocks) => {
    const previous = out[out.length - 1]
    if (previous?.role === role) previous.content.push(...blocks)
    else out.push({ role, content: [...blocks] })
  }
  for (const message of messages ?? []) {
    const results = toolResultsOf(message)
    if (message.role === 'system' || message.role === 'developer') {
      const text = textOf(blocksOf(message.content))
      if (text) systemText = systemText ? `${systemText}\n\n${text}` : text
      continue
    }
    if (results.length > 0) {
      const lead = []
      for (const result of results) {
        const inner = []
        for (const block of result.content) {
          if (block?.type === 'text' && block.text) inner.push({ type: 'text', text: block.text })
          else if (block?.type === 'image') {
            const image = claudeImageBlock(imageDataUrl(block, resolveImage), warnings)
            if (image !== undefined) inner.push(image)
          }
        }
        lead.push({
          type: 'tool_result', tool_use_id: result.callId,
          content: inner.length > 0 ? inner : [{ type: 'text', text: '(no output)' }],
          is_error: result.isError,
        })
      }
      push('user', lead)
      // A V4 tool message's content *is* the result, and all of it just went out
      // inside `tool_result`. Falling through would append the same text a second
      // time to that very user turn — and a returned image with its whole base64
      // payload twice, which the upstream is then billed for twice.
      if (message.role === 'tool') continue
    }
    const blocks = blocksOf(message.content).filter(block => block?.type !== 'tool-result')
    const content = []
    for (const block of blocks) {
      if (block?.type === 'text' && block.text) content.push({ type: 'text', text: block.text })
      else if (block?.type === 'tool-call') {
        let input = {}
        try { input = JSON.parse(block.arguments || '{}') } catch { input = {} }
        content.push({ type: 'tool_use', id: String(block.id ?? ''), name: String(block.name ?? ''), input })
      } else if (block?.type === 'image') {
        const image = claudeImageBlock(imageDataUrl(block, resolveImage), warnings)
        if (image !== undefined) content.push(image)
      }
    }
    if (content.length === 0) continue
    push(message.role === 'assistant' ? 'assistant' : 'user', content)
  }
  return { system: systemText || undefined, messages: out }
}

/** Project harness messages onto the OpenAI Responses input item list. */
export function toResponseInput(messages, resolveImage, warnings) {
  const out = []
  const followUp = []
  const flushFollowUp = () => {
    if (followUp.length > 0) out.push({ type: 'message', role: 'user', content: followUp.splice(0) })
  }
  for (const message of messages ?? []) {
    const results = toolResultsOf(message)
    if (results.length === 0) flushFollowUp()
    if (results.length > 0) {
      for (const result of results) {
        const images = []
        for (const block of result.content) {
          if (block?.type !== 'image') continue
          const url = imageDataUrl(block, resolveImage)
          if (url !== undefined) images.push({ type: 'input_image', image_url: url })
          else if (warnings) warnings.push('image-dropped')
        }
        const text = textOf(result.content)
        out.push({
          type: 'function_call_output', call_id: result.callId,
          output: text || (images.length > 0 ? '(see attached image)' : '(no output)'),
        })
        // `output` is text on this wire, so a returned image travels as the user
        // item after it rather than being dropped on the floor.
        if (images.length > 0) {
          followUp.push({ type: 'input_text', text: `The result of tool call ${result.callId} is ${images.length} image(s), attached below.` }, ...images)
        }
      }
    }
    if (message.role === 'tool') continue
    const blocks = blocksOf(message.content).filter(block => block?.type !== 'tool-result')
    if (message.role === 'system' || message.role === 'developer') {
      const text = textOf(blocks)
      if (text) out.push({ type: 'message', role: 'system', content: [{ type: 'input_text', text }] })
      continue
    }
    if (message.role === 'assistant') {
      const text = textOf(blocks)
      if (text) out.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] })
      for (const block of blocks) {
        if (block?.type === 'tool-call') {
          out.push({ type: 'function_call', call_id: String(block.id ?? ''), name: String(block.name ?? ''), arguments: typeof block.arguments === 'string' ? block.arguments : '{}' })
        }
      }
      continue
    }
    const parts = []
    for (const block of blocks) {
      if (block?.type === 'text' && block.text) parts.push({ type: 'input_text', text: block.text })
      else if (block?.type === 'image') {
        const url = imageDataUrl(block, resolveImage)
        if (url !== undefined) parts.push({ type: 'input_image', image_url: url })
        else if (warnings) warnings.push('image-dropped')
      }
    }
    if (parts.length > 0) {
      if (results.length > 0) followUp.push(...parts)
      else out.push({ type: 'message', role: 'user', content: parts })
    }
  }
  flushFollowUp()
  // Reasoning items from earlier turns carry encrypted content only the issuing
  // account can open; the pooled免密 credential rotates accounts, so echoing them
  // back is a guaranteed 400. They are dropped on the way out by construction.
  return out
}

/** Harness tool schemas -> the shape each provider expects. */
export function toToolDefs(tools, style) {
  const list = []
  for (const tool of tools ?? []) {
    // Both spellings have to work here. The harness hands over flat
    // `{name, description, parameters}` defs, but a caller that already speaks
    // OpenAI — the forward listener's own caller, or anything re-feeding this
    // with `{type:'function', function:{…}}` — used to lose every tool to the
    // `if (!name) continue` below, silently: the request went upstream with an
    // empty tool list and only the fingerprint gate's placeholders came back.
    const source = tool && typeof tool.function === 'object' && tool.function !== null && !Array.isArray(tool.function)
      ? tool.function
      : tool
    const name = String(source?.name ?? '').trim()
    if (!name) continue
    const parameters = source.parameters && typeof source.parameters === 'object' && !Array.isArray(source.parameters)
      ? source.parameters
      : { type: 'object', properties: {} }
    const description = typeof source.description === 'string' ? source.description : ''
    if (style === 'claude') list.push({ name: name.slice(0, MAX_TOOL_NAME_LEN), description, input_schema: parameters })
    else if (style === 'flat') list.push({ type: 'function', name: name.slice(0, MAX_TOOL_NAME_LEN), description, parameters })
    else list.push({ type: 'function', function: { name: name.slice(0, MAX_TOOL_NAME_LEN), description, parameters } })
  }
  return list
}

/** Does this content list need an image-capable model? */
export function needsVision(messages) {
  return (messages ?? []).some(message => hasBlocks(message.content, 'image') && message.content.some(block => block?.type === 'image' && block.offloaded !== true))
}

export { baseModelId, restoreToolName }
