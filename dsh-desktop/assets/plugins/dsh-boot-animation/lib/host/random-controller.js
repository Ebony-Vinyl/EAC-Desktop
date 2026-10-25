/**
 * RandomController — the ONE random pick, and the ONE place that remembers it.
 *
 * Randomness lives on the host rather than in the browser on purpose. Every
 * client — including an old one that still asks for `/boot.mp4` — then gets the
 * same behaviour, and "do not repeat the last clip" is decidable, because the
 * host is the only party that sees every request. A client-side picker would
 * have to be reimplemented per client and would forget the previous choice on
 * every reload.
 *
 * The rule, exactly as specified: never return the clip that was returned last,
 * unless it is the only playable one.
 */

/**
 * Pick one clip at random, avoiding `lastId` when there is a choice.
 *
 * Pure: the caller supplies the randomness, so a test can drive it with a
 * deterministic source and a production call can pass `Math.random`.
 *
 * @template {{ id: string }} T
 * @param {T[]} clips candidates, already filtered to what can actually play
 * @param {string | null} lastId the previously returned clip, or null
 * @param {() => number} rng returns [0, 1)
 * @returns {T | null} null only when there is nothing to play
 */
export function pickRandom(clips, lastId, rng) {
  if (clips.length === 0) return null
  if (clips.length === 1) return clips[0]
  const candidates = clips.filter((clip) => clip.id !== lastId)
  // `lastId` was the only candidate: falling back to it beats playing nothing.
  const pool = candidates.length === 0 ? clips : candidates
  const raw = rng()
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(raw * pool.length)))
  return pool[index]
}

export class RandomController {
  /** @param {{ rng?: () => number }} [options] */
  constructor(options = {}) {
    this.rng = options.rng ?? Math.random
    /** @type {string | null} */
    this.lastId = null
  }

  /**
   * Choose a clip, and remember it so the next call cannot repeat it.
   * @template {{ id: string }} T
   * @param {T[]} clips
   * @returns {T | null}
   */
  pick(clips) {
    const chosen = pickRandom(clips, this.lastId, this.rng)
    if (chosen !== null) this.lastId = chosen.id
    return chosen
  }

  /** Forget the last pick (used when the playable set changes). */
  reset() {
    this.lastId = null
  }
}
