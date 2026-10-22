/**
 * Combos: one model name that is really an ordered chain.
 *
 * The failure this exists for is not exotic. A quota wall, a region refusal, an
 * expired credential or a 5xx from one upstream all arrive as "your turn died",
 * even though three other lanes on this machine were idle and would have
 * answered. A combo turns that into a retry the user never sees: the chain is
 * walked in order, and the first candidate that produces output wins.
 *
 * A combo is a *virtual catalog entry*. It carries `channel: 'combo'` and a
 * `combo` list of real model ids, so the picker advertises it beside the real
 * models and the forward gateway dials it by name. `combo:` is the prefix, and
 * it is deliberately not a valid provider id — `parseProviderModelId` refuses
 * it, so an aggregate row can never be mistaken for a combo.
 *
 * Two strategies:
 *
 * - `fallback` — always start at the head of the list. Predictable, and the
 *   right choice when the list is a quality ladder.
 * - `round-robin` — start at the next candidate each turn (sticky for
 *   `stickyLimit` consecutive turns), so a chain of equivalent models spreads
 *   its load. The rotation cursor lives in memory: a restart losing it costs
 *   nothing but a different starting point.
 *
 * Capacities are the *intersection*, not the union. A chain that advertises
 * vision because its head supports it hands a fallback an image it cannot read;
 * a chain that advertises a 1M window because its head has one overruns a
 * fallback at 128K. The honest numbers are the ones every candidate can honour.
 *
 * @module src/combos.js
 */

import { createHash } from 'node:crypto'

export const COMBO_CHANNEL = 'combo'
export const COMBO_PREFIX = 'combo:'
export const COMBO_STRATEGIES = ['fallback', 'round-robin']

/** Rotation cursors, keyed by combo id. In-memory on purpose (see the header). */
const rotation = new Map()

export function isComboEntry(entry) {
  return entry?.channel === COMBO_CHANNEL && Array.isArray(entry.combo)
}

/** `My Fast Chain` -> `combo:my-fast-chain`. */
export function comboId(name) {
  const normalized = String(name ?? '').trim().toLowerCase()
  if (normalized === '') return ''
  const slug = normalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  // Non-Latin names still need a stable, URL-safe identity after a reload.
  const identity = slug && !/[^\x20-\x7e]/.test(normalized) ? slug
    : `${slug || 'u'}-${createHash('sha256').update(normalized).digest('hex').slice(0, 16)}`
  return `${COMBO_PREFIX}${identity}`
}

/**
 * Coerce the stored settings value into a list of well-formed combos.
 *
 * A stored combo is user input that survived a JSON file, so every field is
 * treated as untrusted: a non-array `models` becomes empty (and the combo is
 * then dropped, because a chain with no links is a model that cannot answer),
 * a non-string id is dropped, and an unknown strategy falls back to `fallback`
 * rather than being honoured as a typo.
 */
export function normalizeCombos(raw) {
  const rows = Array.isArray(raw) ? raw : []
  const seen = new Set()
  const out = []
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    const id = typeof row.id === 'string' && row.id.startsWith(COMBO_PREFIX) ? row.id : comboId(row.name ?? row.id)
    if (id === '' || seen.has(id)) continue
    const models = [...new Set((Array.isArray(row.models) ? row.models : [])
      .map(value => String(value ?? '').trim())
      .filter(value => value !== '' && value !== id))]
    if (models.length === 0) continue
    seen.add(id)
    out.push({
      id,
      name: String(row.name ?? '').trim() || id.slice(COMBO_PREFIX.length),
      models,
      strategy: COMBO_STRATEGIES.includes(row.strategy) ? row.strategy : 'fallback',
      stickyLimit: Number.isFinite(Number(row.stickyLimit)) && Number(row.stickyLimit) > 0 ? Math.trunc(Number(row.stickyLimit)) : 1,
      enabled: row.enabled !== false,
    })
  }
  return out
}

/**
 * Build the virtual catalog rows for every enabled combo.
 *
 * Models that are not in the catalog *right now* are dropped from the chain
 * rather than kept as a hopeful entry: a chain whose second link does not exist
 * would report "tried 2 candidates" for a turn that only ever had one. The
 * combo itself disappears when fewer than one candidate survives, which is the
 * same rule the picker applies to a lane with no models.
 *
 * @param {Array<object>} combos - from `normalizeCombos`
 * @param {Array<object>} catalog - every real catalog entry
 */
export function buildComboCatalog(combos, catalog) {
  const byId = new Map()
  for (const entry of catalog) if (!isComboEntry(entry)) byId.set(entry.id, entry)
  const out = []
  for (const combo of combos) {
    if (combo.enabled === false) continue
    const members = combo.models.map(id => byId.get(id)).filter(entry => entry !== undefined)
    if (members.length === 0) continue
    out.push({
      id: combo.id,
      name: combo.name,
      channel: COMBO_CHANNEL,
      combo: members.map(entry => entry.id),
      strategy: combo.strategy,
      stickyLimit: combo.stickyLimit,
      // Intersection, not union — see the module header.
      vision: members.every(entry => entry.vision === true),
      reasoning: members.some(entry => entry.reasoning === true),
      contextWindow: Math.min(...members.map(entry => number(entry.contextWindow) ?? 131072)),
      maxOutput: Math.min(...members.map(entry => number(entry.maxOutput) ?? 32768)),
      canDisableThinking: members.every(entry => entry.canDisableThinking !== false),
      regionSensitive: false,
      wire: 'chat',
      /** Which lanes this chain can reach, for the detail line. */
      lanes: [...new Set(members.map(entry => entry.channel ?? 'free'))],
    })
  }
  return out
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined
}

/**
 * Resolve a combo row into the ordered candidate entries for one turn.
 *
 * `fallback` returns the list as stored. `round-robin` rotates the starting
 * point and then keeps it for `stickyLimit` turns, which is the behaviour the
 * upstream router settled on: a strict per-turn rotation defeats prompt caching
 * on every provider in the chain, and a strictly sticky cursor makes the other
 * candidates decoration.
 *
 * @param {object} entry - a combo catalog row
 * @param {Array<object>} catalog
 * @param {{peek?: boolean}} [options] - `peek` computes the order without consuming a turn
 */
export function comboChain(entry, catalog, options = {}) {
  const ids = Array.isArray(entry?.combo) ? entry.combo : []
  const byId = new Map()
  for (const row of catalog) byId.set(row.id, row)
  const members = ids.map(id => byId.get(id)).filter(row => row !== undefined)
  if (members.length <= 1 || entry.strategy !== 'round-robin') return members
  const limit = Number.isFinite(Number(entry.stickyLimit)) && Number(entry.stickyLimit) > 0 ? Math.trunc(Number(entry.stickyLimit)) : 1
  const cursor = rotation.get(entry.id) ?? { index: 0, used: 0 }
  const index = Math.min(Math.max(cursor.index, 0), members.length - 1)
  const ordered = [...members.slice(index), ...members.slice(0, index)]
  if (options.peek !== true) {
    const used = cursor.used + 1
    rotation.set(entry.id, used >= limit ? { index: (index + 1) % members.length, used: 0 } : { index, used })
  }
  return ordered
}

/** Drop rotation cursors for combos that no longer exist, so the map cannot grow forever. */
export function pruneRotation(combos) {
  const live = new Set(combos.map(combo => combo.id))
  for (const key of rotation.keys()) if (!live.has(key)) rotation.delete(key)
}

/** Test seam: the rotation map is process state. */
export function resetRotation() {
  rotation.clear()
}
