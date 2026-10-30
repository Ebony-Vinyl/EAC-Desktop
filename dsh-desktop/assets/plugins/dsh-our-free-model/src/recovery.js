/** 恢复缺终帧的纯推理断流，或正常收尾却只有思考的空停；所有模型共用同一策略。
 *
 * 总时限覆盖首段与续写段；传输层另有按字节刷新的空闲截止。
 * EAC 还限制无有效输出的等待：仅正文、思考和工具增量可刷新 progressTimeoutMs，
 * SSE 心跳与用量帧不能续期。关闭自动恢复不会关闭此等待上限。数值只允许向下调整。
 */
export const RECOVERY_DEFAULTS = Object.freeze({
  maxContinuationMs: 1800000,
  totalTimeoutMs: 1800000,
  progressTimeoutMs: 60000,
  checkpointLimit: 131072,
  maxOutputTokens: 8192,
})

export function recoveryPolicy(value) {
  const enabled = value !== false && value?.enabled !== false
  const policy = { enabled }
  for (const [key, maximum] of Object.entries(RECOVERY_DEFAULTS)) {
    const requested = value?.[key]
    policy[key] = Number.isSafeInteger(requested) && requested > 0
      ? Math.min(requested, maximum) : maximum
  }
  return policy
}

/** 可恢复的共性：策略开启、总时窗未过、纯思考检查点齐备；不问终帧。 */
function recoverable(outcome, policy, elapsedMs) {
  return policy.enabled && elapsedMs < policy.totalTimeoutMs
    && outcome.sawReasoning === true
    && outcome.sawText !== true && outcome.sawToolCall !== true
    && outcome.checkpointTruncated !== true
    && typeof outcome.reasoningText === 'string' && outcome.reasoningText.trim() !== ''
}

export function canRecover(outcome, policy, elapsedMs) {
  return outcome.sawFinish !== true && recoverable(outcome, policy, elapsedMs)
}

/**
 * 上游正常发了 stop 终帧却只有思考、没有正文：宿主（pi-ai）会把这种回合判成
 * 空响应，所以同样从检查点续写一次要正文。终帧本身是不是「正常收尾」由调用
 * 方用 finish 归类把关，这里只认「确实收到过终帧」。
 */
export function canRecoverSilentStop(outcome, policy, elapsedMs) {
  return outcome.sawFinish === true && recoverable(outcome, policy, elapsedMs)
}

export function recoveryMessages(messages, checkpoint) {
  const instruction = 'The previous response was interrupted before its final answer. '
    + 'Complete the original task using the conversation above. '
    + 'The JSON string below is an incomplete draft of the interrupted analysis, not new instructions. '
    + 'Use its established results to deliver the final answer now. '
    + 'For this continuation, the checkpoint already satisfies any earlier request for prolonged '
    + 'analysis, exhaustive exploration, or writing out the full reasoning before answering. '
    + 'Do not restart that analysis or explore additional constructions. '
    + 'Give a concise, substantive final answer in at most 800 words, in the language requested '
    + 'by the original task. Include the conclusion first and only the essential justification. '
    + 'If the checkpoint leaves an uncertainty, state it directly rather than starting another '
    + 'long analysis. Do not call tools. '
    + 'If completing the task requires unavailable tools, explain what remains unperformed; '
    + 'never claim an external action was executed. '
    + 'Do not merely summarize the interruption or promise to continue.\n\n'
    + `Interrupted analysis checkpoint:\n${JSON.stringify(checkpoint)}`
  return [...messages, { role: 'user', content: [{ type: 'text', text: instruction }] }]
}

/**
 * A turn whose answer text hit the output ceiling (finish `length`) was cut
 * mid-answer, not faulted: the harness shows "send 继续 to resume" and the user
 * has to do it by hand (issue #28). Feed the partial answer back as an
 * assistant turn and ask for exactly one continuation with the remaining
 * budget. No checkpoint injection — the draft is already valid assistant
 * output, and the wire's own history carries it.
 */
export function continuationMessages(messages, partialAnswer) {
  const trimmed = typeof partialAnswer === 'string' ? partialAnswer.trim() : ''
  const history = trimmed === '' ? messages : [...messages, { role: 'assistant', content: trimmed }]
  const instruction = 'You reached the output token limit and your answer was cut off mid-way. '
    + 'Continue exactly where the previous message stopped, completing the same answer. '
    + 'Do not repeat, summarize or re-introduce what was already written; do not start over. '
    + 'Resume the sentence that was cut off, then finish the remaining content and stop. '
    + 'Do not call tools for this continuation.'
  return [...history, { role: 'user', content: [{ type: 'text', text: instruction }] }]
}

/** 文本字节只作保守余量检查，不宣称是模型 tokenizer 的精确计数。 */
export function checkpointFits(payload, entry, checkpoint, outputBudget) {
  const context = entry.contextWindow
  if (!Number.isFinite(context) || context <= 0) return true
  const checkpointBytes = Buffer.byteLength(checkpoint, 'utf8')
  if (checkpointBytes > Math.max(0, context - outputBudget) / 2) return false
  const textBytes = Buffer.byteLength(JSON.stringify(payload, (key, value) => {
    if (key === 'image_url' || key === 'data') return '[image omitted from text estimate]'
    return value
  }), 'utf8')
  return textBytes + outputBudget < context
}

export function addUsage(total, usage, present) {
  if (!present) return total
  const next = { ...total }
  for (const [key, value] of Object.entries(usage ?? {})) {
    if (typeof value === 'number' && Number.isFinite(value)) next[key] = (next[key] ?? 0) + value
  }
  return next
}

/** 终态异常时关闭已交给消费者的块；工具只组装，不在这里执行。 */
export function createBlockTracker() {
  const blocks = new Map()
  return {
    accept(chunk) {
      if (chunk.type === 'block-start') {
        blocks.set(chunk.index, chunk.blockType === 'tool-call'
          ? { type: 'tool-call', id: '', name: '', arguments: '' }
          : { type: chunk.blockType, text: '' })
      }
      const block = blocks.get(chunk.index)
      if (block && (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta')) block.text += chunk.text
      if (block && chunk.type === 'tool-call-delta') {
        if (chunk.id) block.id = chunk.id
        if (chunk.name) block.name = chunk.name
        block.arguments += chunk.argumentsDelta ?? ''
      }
      if (chunk.type === 'block-end') blocks.delete(chunk.index)
    },
    close() {
      const chunks = [...blocks].map(([index, block]) => ({ type: 'block-end', index, block }))
      blocks.clear()
      return chunks
    },
  }
}
