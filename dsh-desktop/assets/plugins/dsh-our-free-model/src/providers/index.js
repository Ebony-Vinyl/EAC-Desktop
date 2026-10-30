/**
 * Provider registry for the aggregate lane.
 *
 * The plugin already owns three model lanes whose ids it mints itself: the
 * anonymous free lane, the EAC co-paid lane and the Kilo channel. This module
 * adds a fourth, orthogonal namespace — upstream providers a user reaches with
 * their own key, or, for the keyless and local ones, with no account at all.
 * The data lives in `registry.json` so a provider can be added, corrected or
 * dropped in one diffable file; nothing in this module reaches the network, and
 * a record's `source` field names which of the two vetted catalogs it came from.
 *
 * Composite ids are `provider/model`, e.g. `nvidia_nim/nvidia/nemotron-3-super-120b-a12b`
 * (model ids may themselves contain slashes — `openai/gpt-oss-20b` is one model).
 * The registry's provider ids never collide with the ids the other lanes mint:
 * the free lane's ids carry no slash, and the channel lanes' `org/model` rows are
 * routed by their `channel` field before any parsing. One prefix is shared with
 * the EAC lane's rows (`openai/gpt-oss-20b` starts with the registry's `openai`
 * provider), so a caller that must be certain an id came from the aggregate lane
 * has to track that provenance itself — the parser can only reject prefixes that
 * name no provider.
 *
 * `registry.json` is read with `node:fs` rather than an import attribute: the
 * assertion keyword for JSON modules changed between the Node lines this plugin
 * supports (`assert` was replaced by `with`), and a plain parse at module load is
 * the one form every supported line accepts — the same reason `src/store.js`
 * parses JSON by hand.
 *
 * @module src/providers/index.js
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** The three wire formats the registry can name. */
export const FORMAT_VALUES = Object.freeze(['openai-chat', 'openai-responses', 'anthropic-messages'])

/** How a provider is made available; `none` covers the keyless and local rows. */
export const AUTH_KINDS = Object.freeze(['apiKey', 'none', 'oauth', 'adc'])

/**
 * Category values in the order `registry.json` sorts by (alphabetical, so a
 * regenerated file diffs only where the data changed). A picker is free to rank
 * them differently for display.
 */
export const CATEGORY_VALUES = Object.freeze(['apikey', 'free', 'free-tier', 'local', 'oauth'])

const REGISTRY_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'registry.json')

/** Freeze the shared data so one caller cannot hand another a mutated record. */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

/** The parsed `registry.json` array, sorted by category then id. */
export const PROVIDERS = deepFreeze(JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8')))

/** Every registry id — the set `parseProviderModelId` validates prefixes against. */
export const PROVIDER_IDS = Object.freeze(new Set(PROVIDERS.map(provider => provider.id)))

const BY_ID = new Map(PROVIDERS.map(provider => [provider.id, provider]))

/**
 * Per-provider lowercase haystack for `listProviders({ search })`, built once so
 * repeated filtering in a settings page never re-walks the model lists.
 */
const SEARCH_TEXT = new Map(PROVIDERS.map(provider => [provider.id, [
  provider.id,
  provider.name,
  provider.website,
  provider.notes,
  provider.auth.env ?? '',
  ...provider.models.map(model => `${model.id} ${model.name}`),
].join(' ').toLowerCase()]))

/** Accept either a record or an id and return the record, or null when unknown. */
function resolve(provider) {
  if (typeof provider === 'string') return BY_ID.get(provider.trim()) ?? null
  if (provider !== null && typeof provider === 'object' && typeof provider.id === 'string') {
    return BY_ID.get(provider.id) ?? null
  }
  return null
}

/** One provider record by id, or null. */
export function getProvider(id) {
  return typeof id === 'string' ? BY_ID.get(id.trim()) ?? null : null
}

/**
 * Filter providers for a picker. Every option is optional and independent;
 * `search` matches id, name, website, notes, credential env and model ids.
 *
 * @param {{category?: string, format?: string, authKind?: string, search?: string}} [options]
 * @returns {Array<object>}
 */
export function listProviders({ category, format, authKind, search } = {}) {
  const needle = typeof search === 'string' ? search.trim().toLowerCase() : ''
  return PROVIDERS.filter(provider => {
    if (category !== undefined && provider.category !== category) return false
    if (format !== undefined && provider.format !== format) return false
    if (authKind !== undefined && provider.auth.kind !== authKind) return false
    if (needle === '') return true
    return SEARCH_TEXT.get(provider.id).includes(needle)
  })
}

/**
 * Compose the aggregate lane's id for one provider/model pair. Returns null when
 * the provider is unknown or the model id is empty, so a caller can never mint an
 * id that `parseProviderModelId` would refuse to read back.
 *
 * @param {string} providerId
 * @param {string} modelId
 * @returns {string|null}
 */
export function providerModelId(providerId, modelId) {
  const provider = typeof providerId === 'string' ? BY_ID.get(providerId.trim()) : undefined
  const model = typeof modelId === 'string' ? modelId.trim() : ''
  if (provider === undefined || model === '') return null
  return `${provider.id}/${model}`
}

/**
 * Read a composite id back. The prefix must name a registry provider — anything
 * else is null, which is what keeps the parser from claiming another lane's ids.
 *
 * @param {string} composite
 * @returns {{providerId: string, modelId: string}|null}
 */
export function parseProviderModelId(composite) {
  if (typeof composite !== 'string') return null
  const text = composite.trim()
  const slash = text.indexOf('/')
  if (slash <= 0) return null
  const providerId = text.slice(0, slash)
  const modelId = text.slice(slash + 1).trim()
  if (modelId === '' || !BY_ID.has(providerId)) return null
  return { providerId, modelId }
}

/**
 * Minimal correct headers for one provider on its declared wire.
 *
 * Source-declared transport headers (the keyless OpenCode pool's
 * `x-opencode-client`, MiniMax's `anthropic-beta`) come first so the protocol
 * and credential headers below always win a collision. A key is only attached
 * for `apiKey` providers: `none` rows must not send an authorization header,
 * and `oauth`/`adc` credentials are minted by their own flow and injected by the
 * caller.
 *
 * @param {object|string} provider - a record or a provider id
 * @param {string} [apiKey]
 * @returns {Record<string, string>}
 */
export function defaultHeaders(provider, apiKey) {
  const record = resolve(provider)
  if (record === null) return {}
  const headers = {}
  for (const [name, value] of Object.entries(record.headers ?? {})) headers[name.toLowerCase()] = value
  if (record.format === 'anthropic-messages') headers['anthropic-version'] = '2023-06-01'
  headers['content-type'] = 'application/json'
  const key = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (key !== '' && record.auth.kind === 'apiKey') {
    if (record.format === 'anthropic-messages') headers['x-api-key'] = key
    else headers.authorization = `Bearer ${key}`
  }
  return headers
}

/** Wire suffix per format: where a completion is posted on an OpenAI-style base. */
const CHAT_PATHS = Object.freeze({
  'openai-chat': '/chat/completions',
  'openai-responses': '/responses',
  'anthropic-messages': '/messages',
})

/**
 * Full URL for one chat completion, or null when the record carries no base URL
 * (Azure OpenAI's endpoint is user-supplied).
 *
 * `modelId` is deliberately unused: every wire in this registry carries the model
 * in the body, but Azure-style deployments name it in the path, so the parameter
 * stays in the signature the aggregate lane already calls.
 *
 * @param {object|string} provider - a record or a provider id
 * @param {string} [modelId]
 * @returns {string|null}
 */
export function chatEndpoint(provider, modelId) {
  const record = resolve(provider)
  if (record === null) return null
  const base = typeof record.baseUrl === 'string' ? record.baseUrl.trim().replace(/\/+$/, '') : ''
  const suffix = CHAT_PATHS[record.format]
  if (base === '' || suffix === undefined) return null
  return `${base}${suffix}`
}

/**
 * Full URL for the provider's model listing, or null when the sources do not
 * declare one. Only listings that were read from a source are carried: a guessed
 * URL is worse than none, because the caller can always ask the provider for
 * nothing instead of asking the wrong host.
 *
 * @param {object|string} provider - a record or a provider id
 * @returns {string|null}
 */
export function modelsEndpoint(provider) {
  const record = resolve(provider)
  if (record === null || typeof record.modelsUrl !== 'string') return null
  const url = record.modelsUrl.trim()
  return url === '' ? null : url
}
