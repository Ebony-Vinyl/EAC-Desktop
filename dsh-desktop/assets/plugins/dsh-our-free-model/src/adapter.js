/**
 * The provider adapter.
 *
 * It satisfies the harness adapter contract structurally — `registerAdapter`
 * validates by calling the methods, not by an `instanceof` test — which is what
 * lets this plugin mount on more than one kernel line without importing a
 * version-pinned adapter base class.
 *
 * Two routes are published from one adapter instance, because the harness groups
 * the model picker strictly by provider route and offers no other grouping
 * field: `our-free-model` carries what this egress can use right now, and
 * `our-free-model-region` carries what the gateway refuses on this egress. A
 * group with no models is dropped from the picker by the client, so a user whose
 * VPN unlocks the region-gated models sees one group, and a user without sees
 * the second group labelled as such.
 *
 * @module src/adapter.js
 */

import { applyFingerprint, baseModelId, endpointFor, mintRequestId, sessionForConversation, wireFor } from './upstream.js'
import { toChatMessages, toClaudeMessages, toResponseInput, toToolDefs, repairToolPairing } from './messages.js'
import { CODE, UpstreamError, postStreamed } from './http.js'
import { postSealedStreamed } from './eac.js'
import { postKiloStreamed } from './kilo.js'
import { postAggregateStreamed, isAggregateEntry } from './aggregate.js'
import { finishReason, readStream, windowTokens } from './stream.js'
import { DEFAULT_LEVEL, MIN_BUDGET, budgetFor, defaultEffortFor, effortPatchFor, effortsFor, hasDeclaredEffortMenu, resolveLevel } from './effort.js'
import { createChannel } from './channel.js'
import { recoveryPolicy, canRecover, canRecoverSilentStop, recoveryMessages, continuationMessages, checkpointFits, addUsage, createBlockTracker } from './recovery.js'
import { isEacEntry, isKiloEntry } from './catalog.js'
import { isComboEntry, comboChain } from './combos.js'
import { applyTokenSavers, saverConfig } from './token-saver/index.js'
import { classifyFailure, describeVerdict, shouldAdvance } from './route/classify.js'
import { FALLBACK_IMAGE_PRICING } from './image-pricing.js'

export const ROUTE_MAIN = 'our-free-model'
export const ROUTE_REGION = 'our-free-model-region'

/** Group headings — the only strings the picker shows as a section title. */
export const ROUTE_LABELS = {
  [ROUTE_MAIN]: 'Our Free Model',
  [ROUTE_REGION]: 'Our Free Model · region-limited',
}

const STYLE_FOR_WIRE = { chat: 'chat', responses: 'flat', messages: 'claude' }

export class FreeModelAdapter {
  /**
   * @param {object} dependencies
   * @param {() => {catalog: Array<object>, membership: Record<string, string[]>, settings: object, attributionUserAgent: string}} dependencies.state
   * @param {(ref: object) => string | undefined} [dependencies.resolveImage]
   * @param {(record: object) => void} dependencies.recordUsage
   * @param {(record: object) => void} [dependencies.recordTurn]
   * @param {(message: string) => void} [dependencies.warn]
   */
  constructor(dependencies) {
    this.deps = dependencies
  }

  providerInfo(provider) {
    return { id: provider, name: ROUTE_LABELS[provider] ?? provider }
  }

  /**
   * A fully resolved policy, not a configuration fragment.
   *
   * Both the 0.1.5 and 0.1.7 kernels store this object verbatim instead of
   * running it through their policy resolver, and the backoff scheduler reads the
   * delay fields off the top level. Reporting them nested under `backoff` makes
   * every scheduled delay `NaN`, which the durable session log then rejects —
   * turning a recoverable transient failure into an aborted turn.
   */
  providerRetryPolicy() {
    return Object.freeze({
      mode: 'normal',
      maxRetries: 2,
      // A regional refusal is a property of the egress, not a transient fault;
      // retrying it only spends quota. It is deliberately absent here. So is
      // RATE_LIMIT: this lane's 429 carries a *growing* retry-after, and the two
      // automatic retries turned every quota wall into three walls — the same
      // turn, paid thrice, arriving later (issue #13).
      retryableCodes: Object.freeze(['EMPTY_RESPONSE', 'SERVER', 'TIMEOUT', 'TRANSPORT']),
      initialDelayMs: 700,
      maxDelayMs: 8000,
      jitterRatio: 0.2,
    })
  }

  /**
   * Resolve provider-side request-image pricing for one exact model route.
   *
   * 宿主 spill-policy 遇到 undefined 会放弃整条含图结果的落盘（issue #151）。
   * 免费出口没有统一视觉计价协议，提供同步估算以支持预算与落盘。
   *
   * Must stay synchronous: the token meter resolves it per measurement, with no
   * I/O window (issue #42).
   *
   * @param {string} _provider - a route passed to `registerAdapter()` for this instance.
   * @param {string} _model - exact model id passed to GenerateOptions.model.
   * @returns {typeof FALLBACK_IMAGE_PRICING} 视觉 Token 估算，不是厂商真实消耗。
   */
  imageRequestPricing(_provider, _model) {
    return FALLBACK_IMAGE_PRICING
  }

  /** Models this route advertises right now. */
  async listModels(provider) {
    const state = this.deps.state()
    const ids = new Set(state.membership[provider] ?? [])
    return state.catalog
      .filter(entry => ids.has(entry.id))
      .map(entry => ({
        provider,
        id: entry.id,
        name: entry.name,
        description: describe(entry, state.settings),
        inputModalities: entry.vision ? ['text', 'image'] : ['text'],
      }))
  }

  async resolveModel(provider, model) {
    const state = this.deps.state()
    const entry = state.catalog.find(candidate => candidate.id === baseModelId(model))
    if (entry === undefined) {
      return {
        provider,
        id: baseModelId(model),
        name: baseModelId(model),
        context: { contextWindow: 131072 },
        defaultMaxTokens: 8192,
      }
    }
    const ceiling = Math.min(entry.maxOutput, state.settings.defaultMaxTokens ?? 32768)
    const efforts = effortsFor(entry, undefined, state.settings.defaultMaxTokens)
    return {
      provider,
      id: entry.id,
      name: entry.name,
      inputModalities: entry.vision ? ['text', 'image'] : ['text'],
      context: { contextWindow: entry.contextWindow },
      defaultMaxTokens: ceiling,
      ...efforts === undefined ? {} : { reasoning: { efforts, defaultEffort: defaultEffortFor(entry) } },
    }
  }

  /**
   * Bind model metadata and the dispatch closure to one state snapshot, so a
   * catalog refresh arriving mid-turn cannot mix one generation's capacities
   * with another's endpoint table.
   */
  async prepareCall(provider, model) {
    const snapshot = this.deps.state()
    const entry = snapshot.catalog.find(candidate => candidate.id === baseModelId(model)) ?? null
    return {
      model: await this.resolveModel(provider, model),
      stream: options => this.stream(options, entry, snapshot),
    }
  }

  /**
   * @param {object} options - GenerateOptions
   * @param {object|null} pinned - catalog row frozen by `prepareCall`, if any
   * @param {object} [snapshot] - state generation frozen by `prepareCall`
   */
  stream(options, pinned, snapshot = this.deps.state()) {
    const controller = new AbortController()
    const onAbort = () => controller.abort(options.signal?.reason)
    if (options.signal?.aborted === true) onAbort()
    else options.signal?.addEventListener('abort', onAbort, { once: true })
    const iterator = this.runStream({ ...options, signal: controller.signal }, pinned, snapshot)
    const cleanup = () => options.signal?.removeEventListener('abort', onAbort)
    const step = async (method, value) => {
      try {
        const row = await iterator[method](value)
        if (row.done) cleanup()
        return row
      } catch (error) {
        cleanup()
        throw error
      }
    }
    // 原生生成器把 return 排在 pending next 后；先取消请求才能立即退出。
    return {
      [Symbol.asyncIterator]() { return this },
      next: value => step('next', value),
      return: value => { controller.abort(); cleanup(); return step('return', value) },
      throw: error => { controller.abort(error); cleanup(); return step('throw', error) },
    }
  }

  /**
   * One turn: a combo walks its chain, everything else is a single model.
   *
   * A combo is a virtual model, so it reaches here as a pinned catalog row like
   * any other; the only difference is that its row carries a chain instead of an
   * endpoint. Resolving that here — rather than at the picker or the gateway —
   * means both callers get the failover for free.
   */
  async * runStream(options, pinned, snapshot) {
    const modelId = baseModelId(options.model)
    const entry = pinned ?? snapshot.catalog.find(candidate => candidate.id === modelId) ?? null
    if (entry !== null && isComboEntry(entry)) {
      yield * this.runCombo(options, entry, snapshot)
      return
    }
    yield * this.runSingle(options, entry, snapshot, {})
  }

  /**
   * Walk a combo's chain until one candidate produces output.
   *
   * The commit rule is the whole design. Chunks are held in a buffer until the
   * first answer-bearing delta, so a candidate that fails before that point is
   * discarded whole: the caller never saw a byte of it, and switching models is
   * invisible. Reasoning deltas are deliberately *not* a commit — "thought for a
   * minute, then hit a quota wall" is the single most valuable case to fail over,
   * and the held thinking is dropped along with the rest of the discarded try.
   *
   * Once an answer delta has been handed over the answer is the caller's, and a
   * later failure ends the turn the normal way — the single-model recovery path
   * inside `runSingle` still gets its continuation attempt first.
   */
  async * runCombo(options, entry, snapshot) {
    const settings = snapshot.settings ?? {}
    const started = Date.now()
    const rejectedTurn = attempts => {
      this.deps.recordTurn?.({ at: started, model: entry.id, ok: false, recovered: false, attempts, origin: 'harness' })
    }
    if (settings.enabled === false) {
      rejectedTurn(0)
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'our free model is switched off in its settings page', code: 'CONFIG_DISABLED' } } }
      return
    }
    const candidates = comboChain(entry, snapshot.catalog)
    if (candidates.length === 0) {
      rejectedTurn(0)
      yield { type: 'finish', reason: { kind: 'error', failure: { message: `the chain "${entry.name}" has no model available on this egress`, code: CODE.server } } }
      return
    }
    const tried = []
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index]
      const iterator = this.runSingle(options, candidate, snapshot, {
        wire: wireOf(candidate),
        turnModel: entry.id,
        recordTurn: false,
        allowAdvance: true,
      })
      let committed = false
      let result
      const held = []
      while (true) {
        const row = await iterator.next()
        if (row.done === true) { result = row.value; break }
        if (committed) { yield row.value; continue }
        held.push(row.value)
        if (commitsAnswer(row.value)) {
          committed = true
          for (const chunk of held) yield chunk
          held.length = 0
        }
      }
      if (committed) {
        this.deps.recordTurn?.({ at: started, model: entry.id, ok: result?.ok === true, recovered: result?.recovered === true, attempts: index + 1, origin: 'harness' })
        return
      }
      if (result?.advance !== true) {
        // Not a candidate fault — an abort, or a failure that arrived after the
        // single-model recovery budget was spent. Hand the caller the real
        // ending instead of pretending another model could have saved it.
        for (const chunk of held) yield chunk
        rejectedTurn(index + 1)
        return
      }
      const reason = result.verdict === null || result.verdict === undefined ? 'failed' : describeVerdict(result.verdict)
      tried.push(`${candidate.id} (${reason})`)
      this.deps.warn?.(`our-free-model: chain "${entry.name}" advanced past ${candidate.id} — ${reason}`)
    }
    rejectedTurn(candidates.length)
    yield { type: 'finish', reason: { kind: 'error', failure: {
      message: `the chain "${entry.name}" exhausted every candidate: ${tried.join('; ')}`,
      code: CODE.server,
    } } }
  }

  /**
   * One model's turn — the original single-lane path.
   *
   * @param {object} [plan] - `{ wire?, turnModel?, recordTurn?, allowAdvance? }`.
   *   `turnModel` re-attributes the logical turn, so a combo's link is recorded
   *   physically under its own id while the turn belongs to the chain;
   *   `recordTurn: false` leaves the turn record to the caller; `allowAdvance`
   *   makes a pre-output failure report itself as advanceable instead of ending
   *   the turn outright.
   * @returns the turn's own summary, which only a combo caller reads.
   */
  async * runSingle(options, entry, snapshot, plan = {}) {
    const settings = snapshot.settings ?? {}
    const started = Date.now()
    const turnModel = plan.turnModel ?? baseModelId(options.model)
    const recordRejectedTurn = () => {
      if (plan.recordTurn === false) return
      this.deps.recordTurn?.({
        at: started,
        model: turnModel,
        ok: false,
        recovered: false,
        attempts: 0,
        origin: 'harness',
      })
    }

    if (settings.enabled === false) {
      recordRejectedTurn()
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'our free model is switched off in its settings page', code: 'CONFIG_DISABLED' } } }
      return { advance: false, verdict: null, ok: false }
    }
    if (entry === null) {
      recordRejectedTurn()
      yield { type: 'finish', reason: { kind: 'error', failure: { message: `our free model does not serve "${options.model}" on this egress`, code: CODE.server } } }
      return { advance: false, verdict: null, ok: false }
    }

    const sealed = isEacEntry(entry)
    const kilo = isKiloEntry(entry)
    const aggregate = isAggregateEntry(entry)
    // The absorbed channels speak the Chat wire regardless of what their ids
    // resemble; only the free lane splits endpoints per model, and an aggregate
    // row carries the wire its provider actually serves.
    const wire = plan.wire ?? wireOf(entry)
    const style = STYLE_FOR_WIRE[wire]
    const warnings = []
    const resolveImage = this.deps.resolveImage
    const messages = repairToolPairing(options.messages ?? [])
    const budget = budgetFor(options.reasoningEffort, entry, options.maxTokens, settings.defaultMaxTokens)
    const declared = toToolDefs(options.tools, style)
    const policy = recoveryPolicy(settings.streamRecovery)
    const session = sessionForConversation(options.sessionId)
    const recoveryId = mintRequestId()
    let attemptMessages = messages
    let attemptBudget = budget
    let nextIndex = 0
    let totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    const blocks = createBlockTracker()
    let turnRecorded = false
    const finishTurn = (ok, recovered = false, attempts = 1) => {
      if (turnRecorded) return
      turnRecorded = true
      if (plan.recordTurn === false) return
      this.deps.recordTurn?.({
        at: started,
        model: turnModel,
        ok,
        recovered,
        attempts,
        origin: 'harness',
      })
    }

    // One pipeline report per dispatch build, so the usage record can carry what
    // the token savers measured for the body that actually shipped.
    let attemptSavings = null

    // 一次逻辑回合的丢弃内容告警只由首个 payload 收集。检查点估算和续写段都要另建
    // 一份 payload，共用同一个数组会让 `image-dropped` 按 build 次数重复累积，还会
    // 让已经交出去的首段样本跟着后面的 build 一起变长。
    const payloadFor = (input, ceiling, sink, savingsSink) => {
      const payload = buildPayload(wire, entry.id, input, options, ceiling, resolveImage, sink)
      if (declared.length > 0) payload.tools = declared
      if (typeof options.temperature === 'number' && Number.isFinite(options.temperature)) payload.temperature = options.temperature
      if (wire !== 'responses' && Array.isArray(options.stop) && options.stop.length > 0) payload.stop = options.stop
      // ⚠️ 续写回合**不再**下发 `tool_choice: 'none'`：v2 门禁见到 `none` 一律
      // 403 FreeTierError（旧实现靠它压住工具调用）。压制手段改为续写指令本身
      // ——`recoveryMessages()` 的正文里已经写着「Do not call tools」，这条提示
      // 是 v1 时代就有的，不依赖 tool_choice。
      // A declared thinking menu means the selected level is the real control
      // on the wire: it rides the request as the model's own effort field (a
      // JSON merge patch, ZCode's declaration shape). The free lane's own ids
      // now declare menus too (see `src/catalog.js`), so the gate is the entry
      // rather than the lane — an entry without a menu still keeps the free
      // lane's token-budget behaviour, untouched.
      if (sealed || kilo || hasDeclaredEffortMenu(entry)) {
        const patch = effortPatchFor(options.reasoningEffort, entry)
        if (patch !== null) Object.assign(payload, patch)
      }
      if (sealed) applySealedPacingHint(payload)
      // The token savers run last, after every other mutation, so the byte counts
      // they report and the fingerprint's rename map both describe the body that
      // actually ships. Applied on estimation builds too — the checkpoint size
      // gate has to measure the payload it is gating, not a fatter draft of it.
      const savings = applyTokenSavers(payload, wire, saverConfig(settings))
      if (savingsSink !== undefined) savingsSink.report = savings
      return payload
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (options.signal?.aborted === true) {
        finishTurn(false, false, attempt)
        if (attempt > 0) yield { type: 'usage', usage: totalUsage }
        yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'request aborted', code: CODE.aborted } } }
        return { advance: false, verdict: null, ok: false }
      }
      const attemptStarted = Date.now()
      const recovering = attempt === 1
      const savingsSink = {}
      const payload = payloadFor(attemptMessages, attemptBudget, recovering ? [] : warnings, savingsSink)
      attemptSavings = savingsSink.report ?? null
      // The absorbed channels have no tool-name gate; their models see the
      // caller's tools exactly as declared, so the fingerprint pass is free-lane
      // only. The aggregate lane is somebody else's gateway entirely — renaming
      // its tools to this lane's gate placeholders would break the caller's calls.
      const renameMap = sealed || kilo || aggregate ? new Map() : applyFingerprint(payload, wire === 'messages' ? 'claude' : style === 'flat')
      const controller = new AbortController()
      const onAbort = () => controller.abort(options.signal?.reason)
      options.signal?.addEventListener('abort', onAbort, { once: true })
      const remainingMs = Math.max(1, policy.totalTimeoutMs - (attemptStarted - started))
      let expired = false
      const timeoutMs = recovering ? Math.min(policy.maxContinuationMs, remainingMs) : remainingMs
      const timer = policy.enabled ? setTimeout(() => {
        expired = true
        controller.abort()
      }, timeoutMs) : undefined
      timer?.unref?.()
      const channel = createChannel()
      let progressTimer
      let progressExpired = false
      const renewProgress = () => {
        if (!sealed || progressExpired) return
        clearTimeout(progressTimer)
        progressTimer = setTimeout(() => {
          progressExpired = true
          channel.push(new UpstreamError('EAC returned no text, reasoning or tool progress within the waiting limit; the request was stopped and will not be retried automatically', 'NO_PROGRESS'))
          controller.abort()
        }, policy.progressTimeoutMs)
        progressTimer.unref?.()
      }
      renewProgress()
      const request = (sealed
        ? postSealedTurn(this.deps, payload, controller.signal, value => channel.push(value))
        : kilo
          ? postKiloStreamed({ body: payload, signal: controller.signal, onData: value => channel.push(value) })
          : aggregate
            ? postAggregateStreamed({
              config: settings.aggregate ?? {},
              providerId: entry.providerId,
              modelId: entry.modelId,
              body: payload,
              signal: controller.signal,
              onData: value => channel.push(value),
            })
            : postStreamed({
          path: endpointFor(entry.id), body: payload, session,
          attributionUserAgent: snapshot.attributionUserAgent,
          signal: controller.signal,
          onData: value => channel.push(value),
        }))
        .then(() => channel.push(undefined))
        .catch(error => channel.push(error instanceof Error ? error : new Error(String(error))))
      let firstDeltaAt
      let delivered = false
      let sawAnswer = false
      let recorded = false
      let continuationScheduled = false
      let partialOutcome
      let usageAdded = false
      const record = (ok, outcome, extra = {}) => {
        if (recorded) return
        recorded = true
        const usage = outcome?.sawUsage === true ? outcome.usage : undefined
        this.deps.recordUsage({
          at: attemptStarted,
          model: entry.id,
          effort: resolveLevel(options.reasoningEffort, entry)?.id ?? '',
          ok,
          input: usage?.inputTokens ?? 0,
          output: usage?.outputTokens ?? 0,
          reasoning: usage?.reasoningTokens ?? 0,
          cacheRead: usage?.cacheReadTokens ?? 0,
          decodeTokens: ok ? windowTokens(usage, outcome?.sawReasoning === true) : 0,
          ttftMs: firstDeltaAt === undefined ? undefined : firstDeltaAt - attemptStarted,
          decodeMs: firstDeltaAt === undefined ? 0 : Date.now() - firstDeltaAt,
          origin: 'harness',
          recoveryId,
          attempt,
          elapsedMs: Date.now() - attemptStarted,
          ...recovering ? { recoveryAttempt: true } : {},
          ...outcome?.sawUsage === true ? {} : { noUsage: true },
          ...warnings.length === 0 ? {} : { warnings },
          ...savingsFields(attemptSavings),
          ...extra,
        })
      }
      /**
       * Whether another model could answer this failure.
       *
       * Three things veto it, and each one is a different kind of "no": the
       * caller did not ask for a chain, the caller walked away, or this model
       * already put an *answer* on the wire — a switch after that point would
       * splice two models' prose together in front of the user.
       *
       * The veto reads `sawAnswer`, not `delivered`, on purpose. `delivered`
       * also covers reasoning deltas, but a combo holds those in its own
       * buffer and drops them whole when it advances — the user never saw
       * them, so they must not pin the chain to a model that hit a quota wall
       * after a minute of thinking ("thought for a minute, then hit the wall"
       * is the single most valuable case to fail over). Answer-bearing output
       * — visible text or a streamed tool call — is what `commitsAnswer`
       * commits on, and once committed the combo ignores `advance` anyway, so
       * this predicate and the commit rule stay two views of one definition.
       */
      const advanceVerdict = (code, message, status) => {
        if (plan.allowAdvance !== true || options.signal?.aborted === true || sawAnswer) return { advance: false, verdict: null }
        const verdict = classifyFailure({ status, code, message })
        return { advance: shouldAdvance(verdict) || code === CODE.client || code === CODE.region, verdict }
      }
      try {
        const reader = readStream(channel.read(), wire, renameMap, () => Date.now(), {
          startIndex: nextIndex, checkpointLimit: policy.checkpointLimit,
          onState: value => { partialOutcome = value },
          onProgress: renewProgress,
        })
        let outcome
        try {
          while (true) {
            const row = await reader.next()
            if (row.done) { outcome = row.value; break }
            if (options.signal?.aborted === true) throw new UpstreamError('request aborted', CODE.aborted)
            const chunk = row.value
            if (((chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') && typeof chunk.text === 'string' && chunk.text.trim() !== '')
              || (chunk.type === 'tool-call-delta' && ((typeof chunk.argumentsDelta === 'string' && chunk.argumentsDelta.trim() !== '') || (typeof chunk.name === 'string' && chunk.name.trim() !== '')))) renewProgress()
            if (chunk.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text.trim() !== '') sawAnswer = true
            // 续写禁用工具；网关不遵守时也不把工具块交给宿主执行。
            if (recovering && (chunk.blockType === 'tool-call' || chunk.type === 'tool-call-delta' || chunk.block?.type === 'tool-call')) {
              throw new UpstreamError('our free model continuation unexpectedly requested a tool', 'STREAM_CUT')
            }
            if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta' || chunk.type === 'tool-call-delta') {
              delivered = true
              if (firstDeltaAt === undefined) firstDeltaAt = Date.now()
            }
            blocks.accept(chunk)
            yield chunk
          }
        } finally {
          await reader.return()
        }
        nextIndex = outcome.nextIndex
        totalUsage = addUsage(totalUsage, outcome.usage, outcome.sawUsage)
        usageAdded = true
        if (options.signal?.aborted === true) {
          record(false, outcome, { aborted: true })
          finishTurn(false, false, attempt + 1)
          yield { type: 'usage', usage: totalUsage }
          yield { type: 'finish', reason: { kind: 'aborted', failure: { message: 'request aborted', code: CODE.aborted } } }
          return { advance: false, verdict: null, ok: false }
        }
        const reason = outcome.brokenToolCall === true ? { kind: 'max-tokens' } : finishReason(outcome.finish)
        // finishReason 是兜底映射，failed/cancelled 也会落成 stop：正常收尾的判定必须显式查原 token。
        const elapsed = Date.now() - started
        const interrupted = canRecover(outcome, policy, elapsed)
        // 正文撞输出上限被截断（finish=length）：把已出正文回灌成 assistant 轮、
        // 用剩余预算自动续写一次，替代宿主提示的「发送继续」手动接力（#28）。
        // 只在首段触发（recovering 段自己也撞墙就如实报 max-tokens，不无限续），
        // 且不与断流/空停续写共用 attempt 名额以外的路径。
        const maxTokensCut = policy.enabled && !recovering && reason.kind === 'max-tokens' && outcome.brokenToolCall !== true
          && outcome.sawText === true && outcome.sawToolCall !== true
          && typeof outcome.answerText === 'string' && outcome.answerText.trim() !== ''
        const silentStop = !interrupted && !maxTokensCut && reason.kind === 'stop'
          // 无 token 的正常收尾（message_stop / response.done 不带 status）也算停收；failed、length 这类有 token 的收尾仍被挡在外面。
          && (outcome.finish === undefined || ['stop', 'end_turn', 'stop_sequence'].includes(outcome.finish))
          && canRecoverSilentStop(outcome, policy, elapsed)
        if (!recovering && (interrupted || silentStop || maxTokensCut)) {
          const remainingTokens = budget - (outcome.sawUsage ? outcome.usage.outputTokens ?? 0 : 0)
          const continuationBudget = Math.min(remainingTokens, policy.maxOutputTokens)
          const nextMessages = maxTokensCut
            ? continuationMessages(messages, outcome.answerText)
            : recoveryMessages(messages, outcome.reasoningText)
          if (continuationBudget >= MIN_BUDGET
            && checkpointFits(payloadFor(nextMessages, continuationBudget, []), entry, maxTokensCut ? outcome.answerText : outcome.reasoningText, continuationBudget)) {
            record(false, outcome, { truncated: true, recoveryScheduled: true })
            this.deps.warn?.(maxTokensCut
              ? 'our-free-model: the answer hit the output token ceiling; continuing once from where it stopped'
              : silentStop
                ? 'our-free-model: a stopped turn held only its reasoning; continuing once from its checkpoint'
                : 'our-free-model: interrupted reasoning; continuing once from its checkpoint')
            attemptMessages = nextMessages
            attemptBudget = continuationBudget
            continuationScheduled = true
            continue
          }
        }
        const failedEnding = outcome.finish === 'failed' || outcome.finish === 'cancelled'
        const normalEnding = outcome.finish === undefined || ['stop', 'end_turn', 'stop_sequence'].includes(outcome.finish)
        if (outcome.sawFinish !== true || failedEnding || (recovering && (!sawAnswer
          || outcome.sawToolCall === true || reason.kind !== 'stop' || !normalEnding))) {
          const seconds = Math.round((Date.now() - started) / 1000)
          const code = recovering || delivered || outcome.sawToolCall === true ? 'STREAM_CUT'
            : failedEnding ? CODE.server : CODE.transport
          const message = recovering
            ? `our free model continuation ended without a complete answer after ${seconds}s; automatic recovery exhausted`
            : failedEnding ? `our free model upstream response ended with status ${outcome.finish}`
            : delivered || outcome.sawToolCall === true
              ? `our free model closed the stream after ${seconds}s, before its finish token; automatic recovery was not safe`
              : 'our free model closed the stream before its finish token, without answering; retrying'
          record(false, outcome, { truncated: true })
          finishTurn(false, false, attempt + 1)
          yield { type: 'usage', usage: totalUsage }
          yield { type: 'finish', reason: { kind: 'error', failure: { message, code } } }
          return { ok: false, ...advanceVerdict(code, message, undefined) }
        }
        if (outcome.sawText !== true && outcome.sawToolCall !== true && outcome.sawReasoning !== true && reason.kind === 'stop') {
          record(false, outcome)
          finishTurn(false, false, attempt + 1)
          yield { type: 'usage', usage: totalUsage }
          yield { type: 'finish', reason: { kind: 'error', failure: { message: 'our free model returned an empty response', code: CODE.empty } } }
          return { ok: false, ...advanceVerdict(CODE.empty, 'empty response') }
        }
        record(true, outcome, recovering ? { recovered: reason.kind === 'stop' } : {})
        finishTurn(true, recovering && reason.kind === 'stop', attempt + 1)
        yield { type: 'usage', usage: totalUsage }
        yield { type: 'finish', reason }
        if (warnings.length > 0) this.deps.warn?.(`our-free-model: dropped unsupported content for ${entry.id}: ${warnings.join(', ')}`)
        return { advance: false, verdict: null, ok: true, recovered: recovering && reason.kind === 'stop' }
      } catch (error) {
        if (error?.code === CODE.region) this.deps.onRegionBlocked?.(entry.id)
        const aborted = options.signal?.aborted === true
        let failure = toFailure(error)
        if (sealed && failure.code === CODE.server) failure = { ...failure, code: 'EAC_UPSTREAM_FAILED' }
        if ((delivered || partialOutcome?.sawToolCall === true) && this.providerRetryPolicy().retryableCodes.includes(failure.code)) {
          failure = { ...failure, code: 'STREAM_CUT' }
        }
        if (!aborted && (recovering || expired)) {
          failure = { ...failure, code: recovering || delivered || partialOutcome?.sawToolCall === true ? 'STREAM_CUT' : CODE.timeout,
            message: expired
              ? `our free model reached its ${Math.round(timeoutMs / 1000)}s time limit before its finish token${recovering ? ', during the continuation from its checkpoint' : ''}`
              : `our free model continuation failed: ${failure.message}` }
        }
        if (!aborted && progressExpired) failure = {
          code: 'NO_PROGRESS',
          message: `EAC returned no text, reasoning or tool progress for ${policy.progressTimeoutMs / 1000}s; the request was stopped and will not be retried automatically`,
        }
        if (!usageAdded) totalUsage = addUsage(totalUsage, partialOutcome?.usage, partialOutcome?.sawUsage)
        record(false, partialOutcome, { ...(recovering || expired) ? { truncated: true } : {}, ...aborted ? { aborted: true } : {} })
        finishTurn(false, false, attempt + 1)
        for (const chunk of blocks.close()) yield chunk
        if (recovering || partialOutcome?.sawUsage === true) yield { type: 'usage', usage: totalUsage }
        yield { type: 'finish', reason: { kind: aborted ? 'aborted' : 'error', failure } }
        return {
          ok: false,
          ...(aborted || progressExpired)
            ? { advance: false, verdict: null }
            : advanceVerdict(failure.code, failure.message, failure.status),
        }
      } finally {
        clearTimeout(timer)
        clearTimeout(progressTimer)
        options.signal?.removeEventListener('abort', onAbort)
        controller.abort()
        await request
        if (!recorded) record(false, partialOutcome, { aborted: true })
        if (!continuationScheduled && !turnRecorded) finishTurn(false, false, attempt + 1)
      }
    }
  }
}

/** The co-paid reasoning models can burn minutes in the thinking channel on
 * turns that need seconds (observed: an entire small token budget spent on
 * reasoning for a one-line answer, first visible byte minutes late). The
 * effort menu owns the hard depth; this one-line prompt asks for pacing so a
 * turn does not sit silent while the model over-explores. Applied on every
 * sealed build, so the continuation and recovery payloads carry it too. */
const SEALED_PACING_HINT =
  'Avoid overthinking: keep your reasoning brief and proportionate to the task.'

function applySealedPacingHint(payload) {
  if (Array.isArray(payload.messages)) {
    const system = payload.messages.find(message => message?.role === 'system' && typeof message.content === 'string')
    if (system !== undefined) {
      system.content = system.content === '' ? SEALED_PACING_HINT : `${system.content}\n\n${SEALED_PACING_HINT}`
      return
    }
    payload.messages.unshift({ role: 'system', content: SEALED_PACING_HINT })
    return
  }
  if (typeof payload.system === 'string') {
    payload.system = payload.system === '' ? SEALED_PACING_HINT : `${payload.system}\n\n${SEALED_PACING_HINT}`
  }
}

/**
 * One co-paid-lane turn: unlock the sealed credential for this request frame
 * and hand it straight to the lane's poster. A host the gate refuses — or a
 * seal that does not open — is a non-retryable configuration state, not a
 * transport fault: `LANE_LOCKED` is deliberately outside the retryable set so
 * a locked host fails its turn once, with a plain message and no retry storm.
 */
async function postSealedTurn(deps, payload, signal, onData) {
  const credential = await Promise.resolve(deps.sealedCredential?.())
  if (credential === null || credential === undefined) throw new UpstreamError('this model lane is not available on this host', 'LANE_LOCKED')
  return postSealedStreamed({ credential, body: payload, signal, onData })
}

function buildPayload(wire, modelId, messages, options, budget, resolveImage, warnings) {
  if (wire === 'responses') {
    const input = toResponseInput(messages, resolveImage, warnings)
    return {
      model: modelId,
      input: input.length > 0 ? input : [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: '...' }] }],
      stream: true,
      store: false,
      max_output_tokens: budget,
    }
  }
  if (wire === 'messages') {
    const shaped = toClaudeMessages(messages, resolveImage, warnings)
    return {
      model: modelId,
      messages: shaped.messages,
      stream: true,
      max_tokens: budget,
      ...shaped.system === undefined ? {} : { system: shaped.system },
    }
  }
  const chat = toChatMessages(messages, resolveImage, warnings)
  return {
    model: modelId,
    messages: typeof options.system === 'string' && options.system !== ''
      ? [{ role: 'system', content: options.system }, ...chat]
      : chat,
    stream: true,
    max_tokens: budget,
  }
}

/**
 * Shape one thrown error into the harness's `LlmFailure` vocabulary.
 *
 * The harness writes this object straight into a durable session event, and that
 * log rejects anything that does not survive a lossless JSON round trip — an
 * Error instance, a `NaN`, an explicit `undefined` field. A rejected append
 * aborts the whole turn, so a malformed failure is strictly worse than a sparse
 * one: only the whitelisted fields are carried, each validated, and each dropped
 * rather than emitted in a degraded form.
 */
function toFailure(error) {
  const message = typeof error?.message === 'string' && error.message.length > 0
    ? error.message
    : String(error ?? 'our free model request failed')
  const code = typeof error?.code === 'string' && error.code.length > 0 ? error.code : CODE.transport
  const status = error?.status
  const retryAfter = error?.providerRetryAfterMs
  return {
    message,
    code,
    ...Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {},
    ...Number.isFinite(retryAfter) && retryAfter > 0 ? { providerRetryAfterMs: Math.trunc(retryAfter) } : {},
  }
}

/**
 * Which wire serves one catalog row.
 *
 * The absorbed channels speak the Chat wire regardless of what their ids
 * resemble; an aggregate row carries the wire its provider actually serves; the
 * free lane splits its endpoints per model id.
 */
function wireOf(entry) {
  if (isAggregateEntry(entry)) return entry.wire ?? 'chat'
  if (isEacEntry(entry) || isKiloEntry(entry)) return 'chat'
  return wireFor(entry.id)
}

/**
 * Does this chunk carry an answer the caller would have to un-see?
 *
 * A combo may only abandon a candidate while the answer is still entirely
 * inside its own buffer. Reasoning deltas are excluded on purpose: thinking is
 * not the answer, and "thought for a minute, then hit a quota wall" is the
 * most valuable failure to fail over — the held thinking is dropped with the
 * rest of the discarded attempt, so the caller never learns it happened. A
 * `block-end` for a reasoning block is the tail of that same reasoning stream
 * (`closeAll` emits it when the SSE loop ends), so it does not commit either;
 * letting it commit would pin the chain one chunk before the failure it
 * exists to survive. Text commits only when it carries visible content, the
 * same bar `sawAnswer` uses, so whitespace noise cannot pin a chain either.
 */
function commitsAnswer(chunk) {
  if (chunk === null || typeof chunk !== 'object') return false
  if (chunk.type === 'text-delta') return typeof chunk.text === 'string' && chunk.text.trim() !== ''
  if (chunk.type === 'tool-call-delta') return true
  if (chunk.type !== 'block-end') return false
  if (chunk.block?.type === 'reasoning') return false
  if (chunk.block?.type === 'text') return typeof chunk.block.text === 'string' && chunk.block.text.trim() !== ''
  return true
}

/** What the token savers measured for one dispatched body, as usage-record fields. */
function savingsFields(report) {
  if (report === null || report === undefined) return {}
  const saved = Number(report.saved) || 0
  const promptInjected = report.prompt?.injected === true
  if (saved === 0 && promptInjected !== true) return {}
  return {
    savings: {
      saved,
      bytesBefore: Number(report.bytesBefore) || 0,
      // Carried alongside the other two, not derived from them later: the panel
      // shows "before → after", and an after of 0 beside a before of 2599 reads
      // as "the body became empty" rather than "this field was never recorded".
      bytesAfter: Number(report.bytesAfter) || 0,
      blocks: Array.isArray(report.rtk?.hits) ? report.rtk.hits.length : 0,
      ...promptInjected ? { prompt: report.prompt.families ?? [] } : {},
    },
  }
}

/**
 * The `/model` popup's detail line. The composer renders only the model name, so
 * the capacities that matter for choosing a model — modality, window, whether an
 * effort menu exists — have to fit here.
 *
 * A model that cannot switch its thinking off names the shared ceiling outright:
 * on that lane the rung is not only the answer's budget, and a picker that
 * implied otherwise is how "why is it cut off at 8K when my ceiling is 32K" gets
 * asked.
 */
function describe(entry, settings) {
  const parts = [entry.vision ? 'vision + text input' : 'text input', `${Math.round(entry.contextWindow / 1024)}K context`]
  // A chain's own detail line: which models it will try, in order. Without it a
  // combo in the picker looks like one more model with no endpoint behind it.
  if (isComboEntry(entry)) {
    parts.push(`${entry.combo.length}-model chain: ${entry.combo.join(' -> ')}`)
    if (entry.strategy === 'round-robin') parts.push('rotating start')
    return parts.join(' · ')
  }
  if (entry.reasoning === true) {
    // A declared menu is the model's own level list on the wire — naming the
    // levels is the honest detail line; "budget" would describe the free lane's
    // ladder, which is exactly what a menu model does not use.
    if (Array.isArray(entry.efforts) && entry.efforts.length > 0) {
      parts.push(`thinking levels: ${entry.efforts.join(' / ')}`)
    } else {
      const rung = Math.round(budgetFor(DEFAULT_LEVEL, entry, undefined, settings?.defaultMaxTokens) / 1024)
      parts.push(entry.canDisableThinking === false
        ? `thinking always on · ${rung}K default ceiling, shared with the answer`
        : 'tunable thinking budget')
    }
  }
  return parts.join(' · ')
}
