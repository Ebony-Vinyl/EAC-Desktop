/**
 * Model catalog for the free lane.
 *
 * Two sources, deliberately layered so no single one can break the plugin:
 *
 * 1. the upstream listing itself (`/inference/v1/models`) — the authoritative set
 *    of ids the gateway will currently name;
 * 2. a vetted local capability table (context window / vision / reasoning),
 *    because the upstream listing discloses an id and nothing else.
 *
 * @module src/catalog.js
 */

import { baseModelId, isResponsesModel } from './upstream.js'

/** Ids that are free-tier without carrying the `-free` suffix. */
/** Free-tier ids the listing does not mark with a `-free` suffix. `big-pickle`
 *  is the lane's own long-standing free id (9router keeps the same id in its
 *  `KNOWN_FREE_OPENCODE_MODELS` for exactly this reason); models.dev prices it
 *  at 0/0. */
const ALWAYS_FREE = new Set(['union-alpha', 'space-bunny-free', 'big-pickle'])

/**
 * Local capability baseline. `contextWindow`/`maxOutput` are the provider's
 * published capacities; `vision` is what this lane actually accepted under a
 * direct image-input probe, not what a model card claims.
 *
 * ## The free lane declares real thinking levels (2026-10-17)
 *
 * The lane's own probe on 2026-09-24 concluded that `reasoning_effort` was
 * ignored here, so thinking strength was built as an output-token ladder
 * instead (see {@link module:src/effort.js}). A re-probe on 2026-10-17 found
 * that conclusion no longer holds: the gateway now **validates** the field
 * (an undeclared value answers `400 invalid_value` with the accepted set, e.g.
 * `none|minimal|low|medium|high|xhigh|max`) and the level measurably moves the
 * reasoning volume — on `deepseek-v4.1-flash-free`, medians over three samples
 * ran none 0, low 793, high 700, xhigh 1405, max 1906.
 *
 * So an entry that declares `efforts` carries the model's own level menu and
 * its level rides the wire as `reasoning_effort`, exactly like the absorbed
 * channels — `effortPatch` uses `$effort` as the selected level's placeholder,
 * and `effortOffPatch` replaces it for the off rung. The declared set is the
 * model's own contract (models.dev's `reasoning_options`); a level outside it
 * would be a value the upstream may reject, so it is not offered.
 *
 * An entry with no `efforts` keeps the free lane's token-budget ladder: its
 * reasoning cannot be levelled on the wire, and a rung that only cut the answer
 * would be a control the model never promised to honour.
 */
export const CAPABILITIES = [
  { match: /^mimo.*v2\.6/, vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 131072, canDisableThinking: false },
  { match: /^mimo.*v2\.5/, vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 131072, canDisableThinking: false },
  { match: /^mimo/, vision: true, reasoning: true, contextWindow: 262144, maxOutput: 131072 },
  { match: /^muse.?spark/, vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 131072 },
  { match: /^nemotron/, vision: false, reasoning: true, contextWindow: 128000, maxOutput: 32768 },
  { match: /^ling/, vision: false, reasoning: true, contextWindow: 128000, maxOutput: 32768 },
  { match: /^space.?bunny/, vision: true, reasoning: true, contextWindow: 262144, maxOutput: 65536 },
  { match: /^union/, vision: true, reasoning: false, contextWindow: 262144, maxOutput: 131072 },
  { match: /^deepseek/, vision: false, reasoning: true, contextWindow: 128000, maxOutput: 64000 },
  { match: /^jev/, vision: false, reasoning: false, contextWindow: 32768, maxOutput: 4096 },
]

/**
 * Per-id overrides for the ids the lane actually serves today, where the family
 * pattern above would mis-state the model. Keyed by exact base id, consulted
 * before {@link CAPABILITIES}, so a pattern can stay the family-wide default.
 *
 * ## Where these numbers come from (the 9router / models.dev convention)
 *
 * The gateway's listing discloses an id and nothing else, and this lane's own
 * probes are expensive and rate-limited. 9router answers the same question by
 * reading models.dev's `opencode` entry for every id it serves — the same
 * source the official CLI uses (`packages/core/src/models-dev.ts`) — and so
 * does this plugin's channel-pack side (`vendor/channel-pack/src/
 * opencode-capability.ts`). This table adopts that convention for the free
 * lane's own catalog: `modalities.input` gives `vision`, `limit.context` /
 * `limit.output` give the window and output ceiling, and `reasoning_options`
 * gives the thinking menu.
 *
 * ### The level menu is the declared `effort.values`, and only that
 *
 * 9router's `thinkingLevels.js` derives its picker from `reasoning_options`
 * the same way, and its `normalizeEfforts` (channel-pack) is explicit that
 * only `type:'effort'` produces levels — `toggle` and `budget_tokens` produce
 * **none**, because the wire's one expression is `reasoning_effort` and a
 * fabricated rung is a value the upstream may reject (it **validates** the
 * field: an undeclared value answers `400 invalid_value` naming the accepted
 * set). So a `toggle`-only model declares no menu here and keeps the free
 * lane's token ladder; a `budget_tokens` model does the same.
 *
 * ### Where this table departs from models.dev, and why
 *
 * - `contextWindow`: models.dev publishes `200000` for the `-free` ids, but
 *   the same upstream accepted a ~1M-token prompt on `deepseek-v4.1-flash-free`
 *   (1025229 prompt tokens, 200) and on `glm-5.3-flash-free` (900694, 200), so
 *   the published figure is a floor, not the wire's limit. The served window
 *   is used, matching what `deepseek-v4.1-flash` (the paid id) publishes.
 * - `disabled` rung: offered only where the model's own `effort.values`
 *   includes `none`. GLM 5.3 Flash does not list `none`, and four samples at
 *   `none` still spent a median 552 reasoning tokens — an Off rung there would
 *   be a control the model does not honour.
 * - `space-bunny-free` declares `low…max` with no `none`; a `none` request is
 *   rejected outright, so its menu has no Off rung either.
 * - `vision` for `longcat-2.5-preview-free` follows the channel-pack's
 *   measured override (models.dev lists `image`, but an image request 500s).
 */
const FREE_ID_OVERRIDES = {
  // models.dev: effort low|high|max; limit 200000/32000 (floor — see above).
  'deepseek-v4.1-flash-free': {
    vision: true, contextWindow: 1048576, maxOutput: 384000,
    efforts: ['disabled', 'low', 'high', 'max'], effortDefault: 'high',
    effortPatch: { reasoning_effort: '$effort' },
    effortOffPatch: { reasoning_effort: 'none' },
  },
  // models.dev: effort low|high|max. No `none` in the set, and thinking does
  // not switch off in practice, so the menu starts at low.
  'glm-5.3-flash-free': {
    vision: true, contextWindow: 1048576, maxOutput: 131072,
    efforts: ['low', 'high', 'max'], effortDefault: 'high',
    effortPatch: { reasoning_effort: '$effort' },
  },
  // models.dev: effort none|minimal|low|medium|high|xhigh; 1M window.
  'nemotron-3.5-super-vl-free': {
    vision: true, contextWindow: 1048576, maxOutput: 131072,
    efforts: ['disabled', 'minimal', 'low', 'medium', 'high', 'xhigh'], effortDefault: 'high',
    effortPatch: { reasoning_effort: '$effort' },
    effortOffPatch: { reasoning_effort: 'none' },
  },
  // models.dev: effort low|medium|high|xhigh|max; 1M window, 524288 output.
  'space-bunny-free': {
    vision: true, contextWindow: 1048576, maxOutput: 524288,
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'], effortDefault: 'high',
    effortPatch: { reasoning_effort: '$effort' },
  },
  // models.dev: 1M window, 131072 output, reasoning_options `toggle` only →
  // no level menu, so the free lane's token ladder applies.
  'longcat-2.5-preview-free': {
    vision: false, contextWindow: 1048576, maxOutput: 131072,
  },
  // models.dev: 200000/32000, no reasoning_options. The lane accepted a
  // 265360-token prompt, so the window is the served one.
  'big-pickle': { vision: true, contextWindow: 262144, maxOutput: 131072 },
}

/** Human-facing display names, so a raw upstream id never reaches the picker. */
const DISPLAY_NAMES = {
  'mimo-v2.6-flash-free': 'MiMo V2.6 Flash',
  'mimo-v2.5-free': 'MiMo V2.5',
  'muse-spark-1.3-contributor-free': 'Muse Spark 1.3',
  'muse-spark-1.2-contributor-free': 'Muse Spark 1.2',
  'nemotron-3-ultra-free': 'Nemotron 3 Ultra',
  'nemotron-3.5-lightning-free': 'Nemotron 3.5 Lightning',
  'ling-3.0-flash-fin-free': 'Ling 3.0 Flash Fin',
  'space-bunny-free': 'Space Bunny',
  'union-alpha': 'Union Alpha',
  'deepseek-v4-flash-free': 'DeepSeek V4 Flash',
  'deepseek-v4.1-flash-free': 'DeepSeek V4.1 Flash',
  'glm-5.3-flash-free': 'GLM 5.3 Flash',
  'jev-1.13-free': 'Jev 1.13',
}

/** Ids whose regional availability is known to be egress-dependent. */
const REGION_SENSITIVE = [/^muse.?spark/]

/**
 * Is this id on the免密 lane? The gateway's listing mixes paid and free ids;
 * only these answer without a per-user key.
 */
export function isFreeLane(modelId) {
  const base = baseModelId(modelId)
  if (ALWAYS_FREE.has(base)) return true
  return /(?:^|[-_])free(?:$|[-_.])/.test(base)
}

/** Look up the baseline capacities for one model id. An exact id override for a
 *  model the lane serves today wins over the family-wide pattern. */
export function capabilitiesFor(modelId) {
  const base = baseModelId(modelId)
  const override = FREE_ID_OVERRIDES[base]
  if (override !== undefined) return { reasoning: true, ...override }
  for (const entry of CAPABILITIES) if (entry.match.test(base)) return entry
  return { vision: false, reasoning: true, contextWindow: 131072, maxOutput: 32768 }
}

export function isRegionSensitive(modelId) {
  const base = baseModelId(modelId)
  return REGION_SENSITIVE.some(pattern => pattern.test(base))
}

/** Title-case a bare upstream id into something a picker can show. */
export function displayModelName(modelId) {
  const base = baseModelId(modelId)
  const known = DISPLAY_NAMES[base]
  if (known !== undefined) return known
  const words = base
    .replace(/[-_.]+/g, ' ')
    .replace(/(\d)\s+/g, '$1 ')
    .trim()
    .split(' ')
    .map(word => (/^\d/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ')
  return words
}

/**
 * Merge the upstream listing with the local capability table.
 *
 * @param {string[]} ids - raw upstream model ids
 * @returns {Array<object>} catalog entries in listing order
 */
export function buildCatalog(ids) {
  const seen = new Set()
  const entries = []
  for (const raw of ids) {
    const id = String(raw ?? '').trim()
    if (id === '' || !isFreeLane(id)) continue
    const base = baseModelId(id)
    if (seen.has(base)) continue
    seen.add(base)
    const caps = capabilitiesFor(base)
    entries.push({
      id: base,
      name: displayModelName(base),
      wire: isResponsesModel(base) ? 'responses' : 'chat',
      vision: caps.vision === true,
      reasoning: caps.reasoning !== false,
      contextWindow: number(caps.contextWindow) ?? 131072,
      maxOutput: number(caps.maxOutput) ?? 32768,
      canDisableThinking: Array.isArray(caps.efforts)
        ? caps.efforts.includes('disabled')
        : caps.canDisableThinking !== false,
      regionSensitive: isRegionSensitive(base),
      // A model that declares its own thinking menu carries it end to end, the
      // same shape the absorbed channels use: the level is the real control on
      // the wire. Without a menu the free lane's token-budget ladder applies.
      ...Array.isArray(caps.efforts) ? {
        efforts: [...caps.efforts],
        effortDefault: caps.effortDefault,
        ...caps.effortPatch === undefined ? {} : { effortPatch: caps.effortPatch },
        ...caps.effortOffPatch === undefined ? {} : { effortOffPatch: caps.effortOffPatch },
      } : {},
    })
  }
  return entries
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined
}

/** Parse the gateway's `{"data":[{"id":…}]}` listing. */
export function parseListing(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : Array.isArray(payload) ? payload : []
  return rows.map(row => (typeof row === 'string' ? row : row?.id)).filter(id => typeof id === 'string' && id !== '')
}

// ── the co-paid lane ──────────────────────────────────────────────────────────
//
// A second producer whose ids are namespaced upstream ids (`org/model`) and
// whose entries carry `channel: 'eac'` end to end: the adapter routes them to
// their own wire, the probe skips them, and the pages show the channel tag.
// Display names are the model's own name under the channel tag — the org
// prefix is routing detail, never a name the picker shows.

export const EAC_CHANNEL = 'eac'
export const EAC_TAG = 'EAC'

const EAC_DISPLAY_NAMES = {
  // The OpenCode free lane is relayed server-side; the org prefix is routing
  // detail, so the picker shows the model's own name with the lane's Free mark.
  'opencode/deepseek-v4.1-flash-free': 'DeepSeek V4.1 Flash Free',
  'opencode/glm-5.3-flash-free': 'GLM 5.3 Flash Free',
  'deepseek-ai/deepseek-v4.1-flash': 'DeepSeek V4.1 Flash',
  'moonshotai/kimi-k2.6': 'Kimi K2.6',
  'moonshotai/kimi-k3': 'Kimi K3',
  'openai/gpt-oss-20b': 'GPT-OSS 20B',
  'z-ai/glm-5.3': 'GLM 5.3',
  'z-ai/glm-5.3-flash': 'GLM 5.3 Flash',
}

/**
 * Capacities per model: published specs cross-checked against this lane where
 * the relay allowed a probe (2026-10-03), and the thinking-level menu copied
 * from ZCode's built-in provider config (`config/provider/zcode-builtin.json`,
 * the `modelRules`/`modelApiRules`/`providerSiteRules` buckets) — the same
 * per-model declaration shape that product ships: a list of levels plus a
 * JSON merge patch the level maps onto the request body. `vision` records what
 * the relay actually accepted under a direct image-input probe — DeepSeek V4.1
 * Flash and GLM 5.3 Flash answered a 1×1 image with its colour; the Kimi
 * models carry native vision encoders per their model cards but the relay's
 * kimi routes were down during the probe, so their flag follows the published
 * spec. These numbers bound the client-side truncation estimates and the sent
 * max_tokens; the relay enforces its own ceilings on the wire.
 *
 * `efforts`/`effortDefault`/`effortPatch` mirror ZCode's declaration for the
 * model families it names; `effortPatch` uses `$effort` as the selected
 * level's placeholder, and `effortOffPatch` (when present) replaces the patch
 * for the off level. Models ZCode does not declare (kimi-k2.6, gpt-oss-20b)
 * fall back to the family-standard `reasoning_effort` field.
 */
const EAC_CAPABILITIES = [
  // The OpenCode free lane. models.dev declares reasoning_options
  // [{type:"effort", values:["low","high","max"]}] for both ids, and the upstream
  // answers on its OpenAI wire, so the selected level rides `reasoning_effort`
  // verbatim. `disabled` maps to the upstream's own off value ("none"), which
  // zeroes the reasoning tokens — a level that is enforced, not a hint.
  // Capacities are the underlying model's own, not the free listing's rounded
  // floor: both are the same model the canonical entries below describe, so the
  // numbers are copied from them (1M window; 384K / 131K output) and were
  // re-checked against the upstream, which accepts max_tokens up to 384000.
  {
    match: /^opencode\/deepseek-v4/,
    vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 384000,
    efforts: ['disabled', 'low', 'high', 'max'], effortDefault: 'high',
    effortPatch: { reasoning_effort: '$effort' },
    effortOffPatch: { reasoning_effort: 'none' },
  },
  {
    match: /^opencode\/glm-5\.3-flash/,
    vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 131072,
    efforts: ['low', 'high', 'max'], effortDefault: 'high',
    effortPatch: { reasoning_effort: '$effort' },
  },
  {
    match: /^deepseek-ai\/deepseek-v4/,
    vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 384000,
    efforts: ['disabled', 'low', 'high', 'max'], effortDefault: 'high',
    effortPatch: { reasoning_effort: '$effort' },
    effortOffPatch: { reasoning: { enabled: false } },
  },
  {
    match: /^moonshotai\/kimi-k3/,
    vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 131072,
    efforts: ['low', 'high', 'max'], effortDefault: 'high',
    effortPatch: { reasoning_effort: '$effort' },
  },
  {
    match: /^moonshotai\/kimi/,
    vision: true, reasoning: true, contextWindow: 262144, maxOutput: 98304,
    efforts: ['low', 'high', 'max'], effortDefault: 'high',
    effortPatch: { reasoning_effort: '$effort' },
  },
  {
    match: /^z-ai\/glm-5\.3-flash/,
    vision: true, reasoning: true, contextWindow: 1048576, maxOutput: 131072,
    efforts: ['low', 'high', 'max'], effortDefault: 'high',
    effortPatch: { thinking: { type: 'enabled' }, output_config: { effort: '$effort' } },
  },
  {
    match: /^z-ai\/glm-5/,
    vision: false, reasoning: true, contextWindow: 1048576, maxOutput: 131072,
    efforts: ['low', 'high', 'max'], effortDefault: 'high',
    effortPatch: { thinking: { type: 'enabled' }, output_config: { effort: '$effort' } },
  },
  {
    match: /^openai\/gpt-oss/,
    vision: false, reasoning: true, contextWindow: 131072, maxOutput: 32768,
    efforts: ['low', 'medium', 'high'], effortDefault: 'medium',
    effortPatch: { reasoning_effort: '$effort' },
  },
]

/**
 * Ids the EAC page leads with. The two OpenCode free models are pinned to the
 * top of their group and carry the NEW / 爆 badges and the 高速 tag.
 */
const EAC_FEATURED = new Set([
  'opencode/deepseek-v4.1-flash-free',
  'opencode/glm-5.3-flash-free',
])

/** `org/model` → the model's own name under the channel tag. */
export function eacDisplayName(modelId) {
  const base = String(modelId ?? '').trim()
  const bare = base.includes('/') ? base.slice(base.indexOf('/') + 1) : base
  const known = EAC_DISPLAY_NAMES[base]
  const pretty = known ?? bare
    .replace(/[-_.]+/g, ' ')
    .trim()
    .split(' ')
    .map(word => (/^\d/.test(word) ? word : word.toUpperCase() === word ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ')
  return `${EAC_TAG} ${pretty}`
}

function eacCapabilitiesFor(modelId) {
  for (const entry of EAC_CAPABILITIES) if (entry.match.test(modelId)) return entry
  return { vision: false, reasoning: true, contextWindow: 131072, maxOutput: 32768 }
}

/**
 * Build the co-paid lane's catalog rows from its raw listing ids.
 *
 * Every row is one chat-wire model that always thinks (the relay streams
 * reasoning whether or not the caller asks for it) and never sees images.
 */
export function buildEacCatalog(ids) {
  const seen = new Set()
  const entries = []
  for (const raw of ids) {
    const id = String(raw ?? '').trim()
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    const caps = eacCapabilitiesFor(id)
    entries.push({
      id,
      name: eacDisplayName(id),
      // The card's small line under the name. The `id` keeps its `org/` prefix —
      // that is what keeps this row distinct from the free lane's same-named
      // model during the merge — but the prefix is routing detail, so the line
      // shows the model's own id.
      label: id.includes('/') ? id.slice(id.indexOf('/') + 1) : id,
      channel: EAC_CHANNEL,
      wire: 'chat',
      vision: caps.vision === true,
      reasoning: caps.reasoning !== false,
      contextWindow: number(caps.contextWindow) ?? 131072,
      maxOutput: number(caps.maxOutput) ?? 32768,
      canDisableThinking: Array.isArray(caps.efforts) ? caps.efforts.includes('disabled') : false,
      regionSensitive: false,
      // Featured rows sort to the top of the EAC page and carry the marks the
      // client renders; the fields are additive, so every other row is untouched.
      ...EAC_FEATURED.has(id) ? { pinned: true, isNew: true, hot: true, fast: true } : {},
      // The model's declared thinking menu, copied from ZCode's built-in config.
      ...Array.isArray(caps.efforts) ? { efforts: [...caps.efforts], effortDefault: caps.effortDefault } : {},
      ...caps.effortPatch === undefined ? {} : { effortPatch: caps.effortPatch },
      ...caps.effortOffPatch === undefined ? {} : { effortOffPatch: caps.effortOffPatch },
    })
  }
  return entries
}

/** Is this catalog row from the co-paid lane? */
export function isEacEntry(entry) {
  return entry?.channel === EAC_CHANNEL
}

// ── the Kilo channel ──────────────────────────────────────────────────────────
//
// A third producer whose ids are Kilo gateway ids (`org/model`, mostly with a
// `:free` suffix) and whose entries carry `channel: 'kilo'` end to end: the
// adapter routes them to their own wire, the probe skips them (their presence
// in the roster is the verdict — the listing named them this round), and the
// pages show the channel tag. No credential exists on this lane, so there is
// nothing to seal, gate, or leak; the cost is stated upstream instead —
// free-pool prompts may be logged by the provider (README, 免责声明).

export const KILO_CHANNEL = 'kilo'
export const KILO_TAG = 'Kilo'

/**
 * The thinking menu the free pool honours, verified live on 2026-10-06.
 *
 * The gateway speaks OpenRouter's unified `reasoning` object: `effort` picks a
 * level, `enabled: false` switches thinking off. Level runs measured on
 * `nemotron-3.5-lightning` (`reasoning_tokens`: off 0/0/0, low ≈216–252,
 * medium ≈220–428) — the parameter is accepted and forwarded on every probed
 * family, so the menu is the model's own control exactly like the EAC lane's,
 * not a token ladder wearing an effort name.
 *
 * Two families refuse the off rung outright — stepfun and liquid answer HTTP
 * 400 "Reasoning is mandatory for this endpoint and cannot be disabled", and
 * the two auto-routers accept the parameter but keep thinking anyway (verified
 * on `kilo-auto/off`), so their menus omit `disabled` rather than promise a
 * rung that fails the turn. `inkling-small` could not be probed (daily rate
 * limit) and stays conservative with them; ling-3.1 and laguna-xs inherit the
 * off rung from their verified siblings (ling-3.0-sante, laguna-s).
 */
const KILO_EFFORT_PATCH = { reasoning: { effort: '$effort' } }
const KILO_EFFORT_OFF_PATCH = { reasoning: { enabled: false } }
const KILO_REASONING_MANDATORY = [/^stepfun\//, /^liquid\//, /^thinkingmachines\//]
const KILO_NO_DISABLE_IDS = new Set(['kilo-auto/free', 'openrouter/free'])

/** The declared thinking menu for one listing row, EAC shape, or {} when the
 *  row does not declare reasoning support at all. */
function kiloEffortMenuFor(row) {
  const params = Array.isArray(row?.supported_parameters) ? row.supported_parameters : []
  if (!params.includes('reasoning')) return {}
  const id = String(row?.id ?? '')
  const canDisable = !KILO_REASONING_MANDATORY.some(pattern => pattern.test(id))
    && !KILO_NO_DISABLE_IDS.has(id)
  return {
    efforts: canDisable ? ['disabled', 'low', 'medium', 'high'] : ['low', 'medium', 'high'],
    // Parity with the EAC lane: the menu's own default is its top level.
    effortDefault: 'high',
    effortPatch: KILO_EFFORT_PATCH,
    ...canDisable ? { effortOffPatch: KILO_EFFORT_OFF_PATCH } : {},
    canDisableThinking: canDisable,
  }
}

/**
 * Is this raw listing row on Kilo's free pool? Everything else on that gateway
 * is a paid id that answers 401 keyless, and a picker full of guaranteed
 * refusals is worse than a short roster.
 */
export function isKiloFreeRow(row) {
  return row?.isFree === true && typeof row?.id === 'string' && row.id.trim() !== ''
}

/**
 * The picker name: the listing's own name with the vendor prefix and the
 * `(free)` qualifier stripped, under the channel tag — `NVIDIA: Nemotron 3
 * Ultra (free)` → `Kilo Nemotron 3 Ultra`. The `org/` prefix is routing
 * detail, never a name the picker shows.
 */
export function kiloDisplayName(row) {
  const raw = typeof row?.name === 'string' ? row.name.trim() : ''
  const bare = (raw !== '' ? raw : String(row?.id ?? ''))
    .replace(/^[^:]{1,40}:\s+/, '')
    .replace(/\s*\(free\)\s*$/i, '')
    .trim()
  const pretty = bare !== '' ? bare : String(row?.id ?? '')
    .replace(/[-_.]+/g, ' ').trim()
    .split(' ')
    .map(word => (/^\d/.test(word) ? word : word.toUpperCase() === word ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ')
  return `${KILO_TAG} ${pretty}`
}

function kiloEntryOf(row) {
  const context = number(row?.context_length) ?? number(row?.top_provider?.context_length) ?? 131072
  const output = number(row?.top_provider?.max_completion_tokens) ?? 32768
  const modalities = Array.isArray(row?.architecture?.input_modalities) ? row.architecture.input_modalities : []
  const menu = kiloEffortMenuFor(row)
  return {
    id: String(row.id).trim(),
    name: kiloDisplayName(row),
    channel: KILO_CHANNEL,
    wire: 'chat',
    vision: modalities.includes('image'),
    reasoning: true,
    contextWindow: context,
    maxOutput: output,
    // With a declared menu the thinking level itself is the control (a real
    // effort field on the wire); without one the free lane's token-budget
    // ladder applies and the model's streaming thinking cannot be switched off.
    canDisableThinking: menu.canDisableThinking === true,
    regionSensitive: false,
    ...menu.efforts === undefined ? {} : {
      efforts: [...menu.efforts],
      effortDefault: menu.effortDefault,
      effortPatch: menu.effortPatch,
      ...menu.effortOffPatch === undefined ? {} : { effortOffPatch: menu.effortOffPatch },
    },
  }
}

/**
 * Build the Kilo channel's catalog rows from its raw listing rows.
 * Rows that are not on the free pool, or that repeat an id, are dropped.
 */
export function buildKiloCatalog(rows) {
  const seen = new Set()
  const entries = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isKiloFreeRow(row)) continue
    const entry = kiloEntryOf(row)
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    entries.push(entry)
  }
  return entries
}

/**
 * Rebuild the channel's rows from the persisted cache (`kiloRows` in the
 * catalog store) — the same objects `buildKiloCatalog` produced, re-validated
 * field by field so a damaged store degrades to a shorter roster instead of a
 * malformed one.
 */
export function reviveKiloCatalog(stored) {
  const seen = new Set()
  const entries = []
  for (const row of Array.isArray(stored) ? stored : []) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue
    if (typeof row.id !== 'string' || row.id.trim() === '' || row.channel !== KILO_CHANNEL) continue
    const entry = {
      ...kiloEntryOf({ ...row, name: typeof row.name === 'string' && row.name !== '' ? row.name : row.id }),
      name: typeof row.name === 'string' && row.name !== '' ? row.name : kiloDisplayName({ id: row.id }),
      contextWindow: number(row.contextWindow) ?? 131072,
      maxOutput: number(row.maxOutput) ?? 32768,
      vision: row.vision === true,
    }
    // The persisted rows are built entries, not listing rows, so the declared
    // thinking menu travels with them (validated field by field) instead of
    // being re-derived from a `supported_parameters` array they never had.
    if (Array.isArray(row.efforts) && row.efforts.length > 0) {
      entry.efforts = row.efforts.filter(level => typeof level === 'string')
      entry.effortDefault = typeof row.effortDefault === 'string' ? row.effortDefault : entry.effortDefault
      if (row.effortPatch !== undefined && row.effortPatch !== null && typeof row.effortPatch === 'object') entry.effortPatch = row.effortPatch
      if (row.effortOffPatch !== undefined && row.effortOffPatch !== null && typeof row.effortOffPatch === 'object') entry.effortOffPatch = row.effortOffPatch
      entry.canDisableThinking = entry.efforts.includes('disabled')
    }
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    entries.push(entry)
  }
  return entries
}

/** Is this catalog row from the Kilo channel? */
export function isKiloEntry(entry) {
  return entry?.channel === KILO_CHANNEL
}
