/**
 * Plugin-owned durable state: user settings, usage history, probe results, and
 * the forward proxy's key ring.
 *
 * Storage is a plain JSON file under the harness home rather than a harness
 * service on purpose. The settings seam changed shape between the two kernel
 * lines this plugin has to run on (the older one exposes a registrable
 * namespace, the newer one projects volatile plugin config), and the storage
 * domain needs composition rows a bare profile may not mount. A file the plugin
 * owns behaves identically on both, and usage history is high-cardinality
 * telemetry that does not belong in a configuration document anyway.
 *
 * Writes are coalesced and land through a temp file + rename, so a crash mid
 * write cannot leave a truncated store.
 *
 * @module src/store.js
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/** Same resolution the harness home-paths helper uses: `$DSH_HOME` else `~/.dsh`. */
export function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return path.join(os.homedir(), '.dsh')
}

export const DATA_DIR_NAME = 'our-free-model'

/** Bumped when the shape or the meaning of a stored field changes. */
export const STATS_VERSION = 3

export class JsonStore {
  /**
   * @param {string} file - absolute path
   * @param {object} initial - value used when the file does not exist yet
   * @param {{log?: (message: string) => void}} [options] - write-failure channel;
   *   without it a flush that cannot write (disk full, permissions) stays silent
   */
  constructor(file, initial, { log } = {}) {
    this.file = file
    this.value = initial
    this.dirty = false
    this.timer = undefined
    this.disposed = false
    this.log = log
    this.writeFailed = false
    this.load()
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        this.value = { ...this.value, ...parsed }
      }
    } catch {
      // Absent is normal; unreadable is not. Keep the damaged file: without this
      // the next scheduled flush renames a fresh default over it and the user's
      // settings — the forward key, the acknowledged announcements — are gone with
      // nothing on disk to recover and nothing in the log to explain.
      try {
        if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`)
      } catch { /* a home we cannot write to is not this file's problem */ }
    }
  }

  get() {
    return this.value
  }

  /** Merge a patch in and schedule the write. Returns the new value. */
  update(patch) {
    if (this.disposed) return this.value
    this.value = { ...this.value, ...patch }
    this.schedule()
    return this.value
  }

  /** Mutate through a callback; used for read-modify-write on nested state. */
  edit(mutate) {
    if (this.disposed) return this.value
    const next = mutate(structuredClone(this.value))
    if (next !== undefined) this.value = next
    this.schedule()
    return this.value
  }

  schedule(delayMs = 800) {
    if (this.disposed) return
    this.dirty = true
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.flush()
    }, delayMs)
    // Telemetry must never hold the process open.
    this.timer.unref?.()
  }

  flush() {
    if (!this.dirty || this.disposed) return
    this.dirty = false
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      const temp = `${this.file}.${process.pid}.tmp`
      fs.writeFileSync(temp, JSON.stringify(this.value, undefined, 2), { mode: 0o600 })
      fs.renameSync(temp, this.file)
      this.writeFailed = false
    } catch (error) {
      // fail-soft: the next mutation retries, and nothing downstream depends on
      // it — but a home that cannot be written to loses every statistic and
      // every acknowledged setting, so the first failure gets said out loud
      // instead of rotting silently (repeat failures stay quiet: one line per
      // incident, not one per scheduled flush).
      // Re-arm `dirty`: it was cleared before the attempt, so dispose()'s
      // final flush would otherwise skip a write that never landed and drop
      // the session's last changes silently.
      this.dirty = true
      if (!this.writeFailed) {
        this.writeFailed = true
        this.log?.(`our-free-model: could not persist ${path.basename(this.file)} (${error?.message ?? error}); changes are kept in memory only`)
      }
    }
  }

  dispose() {
    if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined }
    // Persist what this generation changed, THEN lock the store: late callbacks
    // from a hot-reloaded-away generation (an in-flight feed poll, a pending
    // update check) must never write over the successor generation's state.
    // The disposal order makes this safe — the successor's stores are created
    // only after the previous generation's disposers have run.
    this.flush()
    this.disposed = true
    this.dirty = false
  }
}

/** `YYYY-MM-DD` in the machine's own calendar, which is what a heatmap needs. */
export function dayKey(at = Date.now()) {
  const date = new Date(at)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export const SETTINGS_INITIAL = {
  version: 1,
  /** Master switch: when off the routes stay registered but serve nothing. */
  enabled: true,
  /** Show region-limited models in the picker as soon as they answer. */
  exposeRegionModels: true,
  /** Advertisement only: retain catalog entries and historical model resolution. */
  hiddenModelIds: [],
  hideFreeModels: false,
  hideEacModels: false,
  /** Minutes between background availability re-probes. */
  probeIntervalMinutes: 15,
  /** Serve the OpenAI-compatible forward listener for other local harnesses. */
  forward: {
    enabled: false,
    host: '127.0.0.1',
    port: 18899,
    /** Reach that listener from other machines on the network; off by default,
     *  binds a routable address, and demands a key of its own (`forwardLanKey`). */
    lan: { enabled: false, port: 0 },
  },
  /** Route inference/probe traffic through an outlet. `mode: 'subscription'`
   *  spawns a local mihomo that load-balances a Clash subscription; `mode:
   *  'client'` dials one http/https/socks5/socks5h URL directly. Off by
   *  default — requests go straight out until this is turned on. */
  egress: { enabled: false, mode: 'subscription', url: '', mihomoPath: '' },
  /** Expose the absorbed channels' OpenAI gateway (the pack's loopback
   *  listener) to other machines under this plugin's own key. Off by default:
   *  a LAN listener is a door, and doors stay shut until asked for. */
  chanGateway: {
    relay: { enabled: false, host: '127.0.0.1', port: 18326, key: '' },
  },
  /** Cap a turn's output so a slow lane cannot run away. */
  defaultMaxTokens: 32768,
  /** 所有模型默认允许一次纯推理检查点续写，false 可关闭。 */
  streamRecovery: true,
  /** Token savers. Tool-output compaction is on by default — it is invisible to
   *  the model's reasoning (the compacted text is what the model reads) and the
   *  result is auditable in the transcript. Prompt-level shaping changes the
   *  assistant's voice, so every level starts `off`. */
  tokenSaver: {
    enabled: true,
    rtk: true,
    prompts: { caveman: 'off', ponytail: 'off' },
  },
  /** The aggregate lane: third-party providers reached with the user's own key.
   *  Keys live in this 0600 file, never in a shared settings document, and the
   *  API masks them on the way out. */
  aggregate: {
    enabled: true,
    providers: {},
  },
  /** Named fallback chains. A combo is a virtual model whose answer comes from
   *  the first link that produces output; see src/combos.js. */
  combos: [],
  /** The five local answers that avoid a provider call entirely: a quota probe,
   *  a shell command prefix, a session title, a suggestion, a filepath list.
   *  They are pure request-shape matches, so a false positive would answer a real
   *  question with a canned string — each is individually switchable, and the
   *  detector is conservative enough to be off for anything else. */
  localOptimize: { enabled: true, quota: true, prefix: true, title: true, suggestion: true, filepath: true },
  /** Acknowledged announcement copy version. */
  announcementAck: '',
  /** Last full catalog refresh timestamp. */
  catalogSyncedAt: 0,
  /** Owner override for the announcement/update feed location. `{repo}` expands
   *  to the plugin repository slug; empty means the shipped GitHub sources. */
  feedUrl: '',
  /** Minutes between announcement-feed polls; floored at 5. */
  feedPollMinutes: 30,
  /** Raise OS-level notifications for new announcements and updates (the
   *  browser asks for permission on the user's click). */
  notifyOs: false,
  /** Announcement ids the user has acknowledged. */
  announcementsAcked: [],
  /** Hours between automatic update checks; 0 disables them entirely. */
  updateCheckHours: 6,
  /** Version whose update availability has already been pushed. */
  updateNotifiedFor: '',
  /** Watch the installed package and hot-reload on change (development aid). */
  autoReloadWatch: false,
  /** Who owns the installed bytes: `self` updates in-app from the repository;
   *  `managed` — written by a distribution pack's installer, or passed as the
   *  bundle config `distribution` — stands the self-updater, the announcement
   *  feed and the hot reload down. The settings API never accepts this field,
   *  so an install that shipped managed stays managed. */
  distribution: 'self',
  /** When the running code was hot-reloaded into place, and how many times. */
  reloadedAt: 0,
  reloadCount: 0,
  /** Version installed by the in-app upgrader, for the settings page. */
  installedVersion: '',
}

const validHiddenModelId = value => typeof value === 'string' && value.length > 0
  && value.length <= 300 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value)

export function publicModelVisibility(settings) {
  return {
    hiddenModelIds: [...new Set((Array.isArray(settings?.hiddenModelIds) ? settings.hiddenModelIds : [])
      .filter(validHiddenModelId))].slice(0, 1000),
    hideFreeModels: settings?.hideFreeModels === true,
    hideEacModels: settings?.hideEacModels === true,
  }
}

/** Reject the entire API patch before any setting is written. */
export function validateModelVisibility(patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw Object.assign(new TypeError('settings must be a JSON object'), { statusCode: 400 })
  }
  const result = {}
  for (const key of ['hideFreeModels', 'hideEacModels', 'hiddenModelIds']) {
    if (!Object.hasOwn(patch, key)) continue
    const value = patch[key]
    if (key === 'hiddenModelIds'
      ? !Array.isArray(value) || value.length > 1000 || value.some(id => !validHiddenModelId(id))
      : typeof value !== 'boolean') {
      throw Object.assign(new TypeError(`${key} must be ${key === 'hiddenModelIds' ? 'an array of at most 1000 nonempty model ids (up to 300 characters each)' : 'a boolean'}`), { statusCode: 400 })
    }
    result[key] = Array.isArray(value) ? [...new Set(value)] : value
  }
  return result
}

export function isModelHidden(entry, settings) {
  return (Array.isArray(settings?.hiddenModelIds) && settings.hiddenModelIds.includes(entry.id))
    || (settings?.hideFreeModels === true && (!entry.channel || entry.channel === 'anonymous' || entry.channel === 'kilo'))
    || (settings?.hideEacModels === true && entry.channel === 'eac')
}

export const STATS_INITIAL = {
  version: STATS_VERSION,
  days: {},
  models: {},
  requests: 0,
  failedRequests: 0,
  samples: [],
  logical: { turns: 0, failed: 0, recovered: 0, models: {} },
  /** Lifetime token-saver totals; `calls` counts every request the pipeline ran
   *  on, including the ones where nothing was compressible. */
  savings: { bytesBefore: 0, bytesAfter: 0, saved: 0, blocks: 0, calls: 0, promptCalls: 0 },
}

/**
 * Two bounds on what counts as a measurable decode window.
 *
 * A real recorded sample published 63 000 tok/s: 63 output tokens inside a 1 ms
 * window that opened after a 2 977 ms first-token wait. `windowTokens` in
 * src/stream.js removes the unstreamed-reasoning inflation, and these two catch
 * the rest — a window too short to time at all, and one so fast that the frames
 * must have been coalesced rather than decoded. Measured sustained output on
 * this lane runs at tens of tok/s, so both bounds sit far outside anything
 * genuine, and a call tripping either is not a slow measurement: it is no
 * measurement, and it is dropped instead of averaged in.
 */
export const MIN_DECODE_MS = 250
export const MAX_CREDIBLE_TPS = 250

/**
 * Classify one completed call's decode window.
 * @param {number} decodeMs - first observed frame to finish
 * @param {number} tokens - output tokens attributable to that window
 * @param {boolean} ok
 * @returns {{measurable: boolean, decodeMs: number, tps: number|null}}
 */
export function decodeWindow(decodeMs, tokens, ok) {
  const ms = Number.isFinite(decodeMs) && decodeMs > 0 ? decodeMs : 0
  const count = Number.isFinite(tokens) ? tokens : 0
  if (ok !== true || count <= 0 || ms < MIN_DECODE_MS) return { measurable: false, decodeMs: 0, tps: null }
  const tps = (count / ms) * 1000
  if (!Number.isFinite(tps) || tps > MAX_CREDIBLE_TPS) return { measurable: false, decodeMs: 0, tps: null }
  return { measurable: true, decodeMs: ms, tps: Math.round(tps) }
}

/**
 * Accumulate one completed call into the store's day/model buckets and keep a
 * bounded ring of per-call latency samples for the speed charts.
 */
export function recordUsage(stats, record) {
  return stats.edit(state => {
    const day = dayKey(record.at)
    const days = { ...(state.days ?? {}) }
    const bucket = days[day] ?? { total: 0, models: {} }
    const perModel = { ...(bucket.models ?? {}) }
    const previous = perModel[record.model] ?? {
      input: 0, output: 0, reasoning: 0, cacheRead: 0, calls: 0, failed: 0,
      ttftMs: 0, ttftSamples: 0, decodeMs: 0, decodeTokens: 0,
    }
    const measured = decodeWindow(record.decodeMs, record.decodeTokens, record.ok)
    const ttftMs = Number.isFinite(record.ttftMs) && record.ok === true ? record.ttftMs : undefined
    perModel[record.model] = {
      input: previous.input + record.input,
      output: previous.output + record.output,
      reasoning: previous.reasoning + record.reasoning,
      cacheRead: previous.cacheRead + record.cacheRead,
      calls: previous.calls + 1,
      failed: previous.failed + (record.ok ? 0 : 1),
      ttftMs: previous.ttftMs + (ttftMs ?? 0),
      ttftSamples: previous.ttftSamples + (ttftMs === undefined ? 0 : 1),
      decodeMs: previous.decodeMs + measured.decodeMs,
      decodeTokens: previous.decodeTokens + (measured.measurable ? record.decodeTokens : 0),
    }
    days[day] = { ...bucket, models: perModel, total: bucket.total + record.input + record.output }
    const models = { ...(state.models ?? {}) }
    const lifetime = models[record.model] ?? {
      input: 0, output: 0, reasoning: 0, cacheRead: 0, calls: 0, failed: 0,
    }
    models[record.model] = {
      input: (lifetime.input ?? 0) + record.input,
      output: (lifetime.output ?? 0) + record.output,
      reasoning: (lifetime.reasoning ?? 0) + record.reasoning,
      cacheRead: (lifetime.cacheRead ?? 0) + record.cacheRead,
      calls: (lifetime.calls ?? 0) + 1,
      failed: (lifetime.failed ?? 0) + (record.ok === true ? 0 : 1),
    }
    const samples = [...(state.samples ?? []), {
      at: record.at, model: record.model, ok: record.ok === true,
      input: record.input, output: record.output,
      ttftMs: ttftMs === undefined ? null : Math.round(ttftMs),
      tps: measured.tps,
      decodeMs: measured.decodeMs,
      decodeTokens: measured.measurable ? record.decodeTokens : 0,
      effort: record.effort ?? '',
      origin: record.origin ?? 'chat',
      // A call the gateway cut mid-stream, and a call that reached its finish
      // token but never sent a usage frame, both land as 0/0. With no marker on
      // the row they are indistinguishable from a genuinely empty completion, and
      // there is then nothing to audit a "that turn vanished" report against
      // (issue #10).
      ...record.truncated === true ? { truncated: true } : {},
      ...record.noUsage === true ? { noUsage: true } : {},
      ...typeof record.recoveryId === 'string' ? { recoveryId: record.recoveryId } : {},
      ...Number.isSafeInteger(record.attempt) ? { attempt: record.attempt } : {},
      ...Number.isFinite(record.elapsedMs) ? { elapsedMs: record.elapsedMs } : {},
      ...record.recoveryAttempt === true ? { recoveryAttempt: true } : {},
      ...record.recoveryScheduled === true ? { recoveryScheduled: true } : {},
      ...record.recovered === true ? { recovered: true } : {},
      ...record.aborted === true ? { aborted: true } : {},
      ...savingsSample(record.savings),
    }].slice(-400)
    return {
      ...state,
      days,
      models,
      requests: (state.requests ?? 0) + 1,
      failedRequests: (state.failedRequests ?? 0) + (record.ok === true ? 0 : 1),
      samples,
      savings: accumulateSavings(state.savings, record.savings),
    }
  })
}

/**
 * Fold one call's token-saver report into the lifetime accumulator.
 *
 * Counted here rather than at the pipeline's exit so the number the panel shows
 * is derived from the same rows the usage charts are: a saved-byte total that
 * included requests the store never recorded would drift away from the call
 * count beside it, and the first question anyone asks of a savings figure is
 * "out of how many calls".
 *
 * The shape is written even when a record carries no savings, so a stats file
 * from before this feature gains the field on its next call instead of the panel
 * having to guess between `undefined` and zero.
 */
export function accumulateSavings(total, savings) {
  const base = total ?? { bytesBefore: 0, bytesAfter: 0, saved: 0, blocks: 0, calls: 0, promptCalls: 0 }
  const saved = Number(savings?.saved) || 0
  return {
    bytesBefore: (Number(base.bytesBefore) || 0) + (Number(savings?.bytesBefore) || 0),
    bytesAfter: (Number(base.bytesAfter) || 0) + (Number(savings?.bytesAfter) || 0),
    saved: (Number(base.saved) || 0) + saved,
    blocks: (Number(base.blocks) || 0) + (Number(savings?.blocks) || 0),
    calls: (Number(base.calls) || 0) + 1,
    promptCalls: (Number(base.promptCalls) || 0) + (Array.isArray(savings?.prompt) && savings.prompt.length > 0 ? 1 : 0),
  }
}

/** The per-sample marker, present only when a call actually saved something. */
function savingsSample(savings) {
  const saved = Number(savings?.saved) || 0
  if (saved <= 0) return {}
  return { saved, ...Array.isArray(savings?.prompt) && savings.prompt.length > 0 ? { savedPrompt: true } : {} }
}

/** Record one user-visible turn, separately from its physical upstream attempts. */
export function recordTurn(stats, record) {
  return stats.edit(state => {
    const previous = state.logical ?? {}
    const models = { ...(previous.models ?? {}) }
    const row = models[record.model] ?? { turns: 0, failed: 0, recovered: 0 }
    const failed = record.ok === true ? 0 : 1
    const recovered = record.recovered === true ? 1 : 0
    models[record.model] = {
      turns: row.turns + 1,
      failed: row.failed + failed,
      recovered: row.recovered + recovered,
    }
    return {
      ...state,
      logical: {
        ...previous,
        turns: (previous.turns ?? 0) + 1,
        failed: (previous.failed ?? 0) + failed,
        recovered: (previous.recovered ?? 0) + recovered,
        models,
      },
    }
  })
}

/**
 * v1 added every decode window it was handed to the same accumulator, so its
 * speed totals are garbage rather than history and cannot be un-polluted row by
 * row. Token totals and the heatmap survive; the derived speed totals reset and
 * repopulate from fresh calls. Per-sample first-token latency is real for
 * completed calls, so those samples keep it — v1 stored a failed call's whole
 * latency there, which is not a time-to-first-token.
 */
export function migrateStats(value) {
  if (value?.version === STATS_VERSION) return value
  const version = Number.isSafeInteger(value?.version) ? value.version : 0
  const resetSpeedTotals = version < 2
  const days = {}
  for (const [day, bucket] of Object.entries(value?.days ?? {})) {
    const models = {}
    for (const [model, row] of Object.entries(bucket.models ?? {})) {
      models[model] = resetSpeedTotals
        ? { ...row, decodeMs: 0, decodeTokens: 0, ttftMs: 0, ttftSamples: 0 }
        : { ...row }
    }
    days[day] = { ...bucket, models }
  }
  const logicalModels = {}
  const modelFailures = {}
  let logicalTurns = 0
  let logicalFailed = 0
  let failedRequests = 0
  for (const bucket of Object.values(days)) for (const [model, row] of Object.entries(bucket.models ?? {})) {
    const current = logicalModels[model] ?? { turns: 0, failed: 0, recovered: 0 }
    logicalModels[model] = { turns: current.turns + (row.calls ?? 0), failed: current.failed + (row.failed ?? 0), recovered: current.recovered }
    logicalTurns += row.calls ?? 0
    logicalFailed += row.failed ?? 0
    failedRequests += row.failed ?? 0
    modelFailures[model] = (modelFailures[model] ?? 0) + (row.failed ?? 0)
  }
  const lifetimeModels = {}
  for (const [model, row] of Object.entries(value?.models ?? {})) {
    lifetimeModels[model] = { ...row, failed: Number.isSafeInteger(row.failed) ? row.failed : modelFailures[model] ?? 0 }
  }
  const samples = (value?.samples ?? []).map(sample => resetSpeedTotals
    ? {
        ...sample,
        tps: null,
        decodeMs: 0,
        decodeTokens: 0,
        ttftMs: sample.ok === true && Number.isFinite(sample.ttftMs) ? sample.ttftMs : null,
      }
    : sample)
  return {
    ...value,
    version: STATS_VERSION,
    days,
    models: lifetimeModels,
    // A stats file written before the token savers existed carries no savings
    // history at all. Zeroes are the honest reading: those calls really did ship
    // uncompressed bodies, so back-filling a number would invent a saving that
    // never happened.
    savings: value?.savings ?? { bytesBefore: 0, bytesAfter: 0, saved: 0, blocks: 0, calls: 0, promptCalls: 0 },
    failedRequests: version >= 3 && Number.isSafeInteger(value?.failedRequests) ? value.failedRequests : failedRequests,
    failedRequestsEstimated: version >= 3 && Number.isSafeInteger(value?.failedRequests) ? value.failedRequestsEstimated === true : true,
    logical: version >= 3 && value?.logical !== undefined ? value.logical : {
      turns: logicalTurns,
      failed: logicalFailed,
      recovered: 0,
      models: logicalModels,
      estimated: true,
    },
    samples,
  }
}

/** Trim day buckets older than `keepDays`, keeping the payload chart-sized. */
export function pruneDays(state, keepDays = 120) {
  const keys = Object.keys(state.days ?? {}).sort()
  if (keys.length <= keepDays) return state
  const drop = new Set(keys.slice(0, keys.length - keepDays))
  const days = {}
  for (const key of keys) if (!drop.has(key)) days[key] = state.days[key]
  return { ...state, days }
}
