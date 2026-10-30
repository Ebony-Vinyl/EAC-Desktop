/**
 * The recommended-projects page's live numbers.
 *
 * The page's copy is the client's — it is localized and it moves with the
 * product. What cannot be baked into either half is the number the whole page
 * is built to move: how many stars each recommended repository has, and when it
 * last changed. A count frozen at release time reads as abandoned the day after
 * it ships, so the host asks GitHub directly, keeps the last answer on disk,
 * and fails open in both directions: an unreachable GitHub serves the last good
 * numbers (or none, on a first run) instead of an error, and a malformed answer
 * is dropped rather than half-applied.
 *
 * This rides the direct fetch, not the user's outlet: the outlet exists for the
 * model lanes, and a broken proxy must not take the recommendation page down
 * with it — the same reason the announcement feed bypasses it.
 *
 * @module src/picks.js
 */

import fs from 'node:fs'
import path from 'node:path'

/** The repositories the page advertises, in display order. */
export const PICK_REPOS = Object.freeze([
  Object.freeze({ id: 'eac-desktop', repo: 'Ebony-Vinyl/EAC-Desktop' }),
  Object.freeze({ id: 'eac-pack', repo: 'Ebony-Vinyl/EAC-Pack' }),
  Object.freeze({ id: 'eac-design-world', repo: 'Ebony-Vinyl/EAC-design-world' }),
])

/**
 * Where the counts come from. The preview harness points this at a local stub so
 * a screenshot run never leaves the machine (same seam, same reason, as
 * `OUR_FREE_MODEL_BASE` in src/upstream.js).
 */
export const PICKS_API_BASE = process.env.OFM_PICKS_API_BASE ?? 'https://api.github.com'

/** A good answer is reused for six hours; a failed one is retried in fifteen minutes. */
const FRESH_MS = 6 * 60 * 60_000
const RETRY_MS = 15 * 60_000
const REQUEST_TIMEOUT_MS = 10_000
/**
 * How long a cold route may wait for the first answer before serving what it
 * has. The page must never hang on GitHub; it may, however, spend a moment
 * longer to arrive with real numbers instead of dashes.
 */
export const VIEW_WAIT_MS = 4_000

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

function count(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : undefined
}

function stamp(value) {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : undefined
}

/** One repo's row from the GitHub answer, or `undefined` when it is not one. */
function parseRepo(id, repo, payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const stars = count(payload.stargazers_count)
  if (stars === undefined) return undefined
  const forks = count(payload.forks_count)
  const pushedAt = stamp(payload.pushed_at)
  return {
    id,
    repo,
    stars,
    ...forks === undefined ? {} : { forks },
    ...pushedAt === undefined ? {} : { pushedAt },
    stale: false,
  }
}

/**
 * The star counts behind the recommended-projects page.
 *
 * `view()` is what the route calls: it answers from cache while a copy is
 * fresh, refreshes in the background while a copy is merely stale, and gives a
 * cold start a bounded head start on its first fetch. `refresh()` forces the
 * fetch and coalesces concurrent callers onto one round trip per repo.
 *
 * @param {object} [deps]
 * @param {ReadonlyArray<{id: string, repo: string}>} [deps.repos]
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {string} [deps.cacheFile] - where the last good answer is kept
 * @param {() => number} [deps.now]
 * @param {(message: string) => void} [deps.log]
 */
export function createPickStats({ repos = PICK_REPOS, fetchImpl = fetch, cacheFile = '', now = Date.now, log = () => {} } = {}) {
  const wanted = repos.filter(row => REPO_PATTERN.test(String(row?.repo ?? '')))
  let state = { at: 0, ok: false, repos: [] }
  let inflight = null

  function readDisk() {
    if (cacheFile === '') return
    try {
      const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
      if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.repos)) return
      const at = Number(parsed.at)
      if (!Number.isFinite(at) || at <= 0) return
      const rows = parsed.repos.map(row => {
        if (row === null || typeof row !== 'object') return undefined
        const stars = count(row.stars)
        if (stars === undefined || typeof row.repo !== 'string') return undefined
        const forks = count(row.forks)
        const pushedAt = Number(row.pushedAt)
        return {
          id: String(row.id ?? ''),
          repo: row.repo,
          stars,
          ...forks === undefined ? {} : { forks },
          ...Number.isFinite(pushedAt) && pushedAt > 0 ? { pushedAt } : {},
          stale: row.stale === true,
        }
      }).filter(row => row !== undefined)
      // A cache written for a different roster must not mask the repos the page
      // asks about today, so it only counts when it covers exactly those rows.
      if (rows.length !== wanted.length || !wanted.every(row => rows.some(cached => cached.id === row.id))) return
      state = { at, ok: rows.some(row => row.stale !== true), repos: rows }
    } catch { /* an unreadable cache is the same as no cache */ }
  }

  function writeDisk() {
    if (cacheFile === '') return
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
      const temp = `${cacheFile}.${process.pid}.tmp`
      fs.writeFileSync(temp, JSON.stringify({ at: state.at, repos: state.repos }), { mode: 0o600 })
      fs.renameSync(temp, cacheFile)
    } catch (error) {
      log(`pick stats: could not keep the cache (${error?.message ?? error})`)
    }
  }

  async function fetchOne(row) {
    const previous = state.repos.find(entry => entry.id === row.id)
    try {
      const response = await fetchImpl(`${PICKS_API_BASE}/repos/${row.repo}`, {
        redirect: 'error',
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-our-free-model' },
        signal: AbortSignal.timeout ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined,
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const parsed = parseRepo(row.id, row.repo, await response.json())
      if (parsed === undefined) throw new Error('no star count in the answer')
      return parsed
    } catch (error) {
      log(`pick stats: ${row.repo} -> ${error?.message ?? error}`)
      // Keep this repo's last good numbers rather than blanking its card; the
      // `stale` flag is what the page tells the user instead of a silent lie.
      return previous !== undefined ? { ...previous, stale: true } : { id: row.id, repo: row.repo, stale: true }
    }
  }

  const snapshot = () => ({ fetchedAt: state.at, ok: state.ok, repos: state.repos.map(row => ({ ...row })) })

  function refresh() {
    if (inflight !== null) return inflight
    const request = Promise.all(wanted.map(row => fetchOne(row)))
      .then(rows => {
        state = { at: now(), ok: rows.some(row => row.stale !== true), repos: rows }
        writeDisk()
        return snapshot()
      })
      .catch(error => {
        log(`pick stats: refresh failed (${error?.message ?? error})`)
        return snapshot()
      })
      .finally(() => { inflight = null })
    inflight = request
    return request
  }

  async function view() {
    const age = now() - state.at
    if (state.at > 0 && age < (state.ok ? FRESH_MS : RETRY_MS)) return snapshot()
    const pending = refresh()
    if (state.at > 0) return snapshot()
    // Cold start: nothing on disk and nothing in memory. Wait — bounded — for
    // the first answer so the page's first paint usually carries real numbers.
    await Promise.race([
      pending.then(() => undefined, () => undefined),
      new Promise(resolve => {
        const timer = setTimeout(resolve, VIEW_WAIT_MS)
        timer.unref?.()
      }),
    ])
    return snapshot()
  }

  readDisk()

  return { view, refresh, snapshot }
}
