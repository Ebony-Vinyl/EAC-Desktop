/**
 * Terse-response and minimal-code system prompts, at the intensity levels the
 * upstream RTK skill defines.
 *
 * Two independent families live here:
 *
 * - **caveman** (`off`, `lite`, `full`, `ultra`, `wenyan-lite`, `wenyan`,
 *   `wenyan-ultra`) compresses the *answer*: grammar and pleasantries are
 *   traded for output tokens.
 * - **ponytail** (`off`, `lite`, `full`, `ultra`) compresses the *work*: it
 *   biases the model toward the smallest change that solves the request.
 *
 * Both are behavioural prompts, and every level is assembled from the same
 * shared boundaries — code, paths, commands, errors and URLs stay exact;
 * security warnings and irreversible actions drop the terse register; the
 * user's language is preserved; the model never names the style. A level that
 * dropped one of those boundaries would save tokens by making answers wrong or
 * unsafe, so the texts are ported verbatim from the upstream skill sources
 * (`open-sse/rtk/cavemanPrompts.js`, `open-sse/rtk/ponytailPrompt.js`), and the
 * test pins every level's exact length so a paraphrase cannot slip in
 * unnoticed.
 *
 * `off` is a real level — it is what a settings page selects — and resolves to
 * `null`, never to an empty string: appending `''` to a system message would
 * still add a separator and a blank line to the request.
 *
 * @module src/token-saver/prompts.js
 */

/** Caveman levels, in the order a settings menu should offer them. */
export const CAVEMAN_LEVELS = ['off', 'lite', 'full', 'ultra', 'wenyan-lite', 'wenyan', 'wenyan-ultra']

/** Ponytail levels, in the order a settings menu should offer them. */
export const PONYTAIL_LEVELS = ['off', 'lite', 'full', 'ultra']

// ── caveman ──────────────────────────────────────────────────────────────────
// The shared lines are one constant each, exactly as upstream: they are the
// safety boundaries every level must carry, and copying them per level would
// let one level drift out of step with the others.

const SHARED_BOUNDARIES = "Code blocks, file paths, commands, errors, URLs: keep exact. Security warnings, irreversible action confirmations, multi-step ordered sequences: write normal. Resume terse style after."

const SHARED_EXAMPLES = "Not: \"Sure! I'd be happy to help you with that. The issue you're experiencing is likely caused by...\" Yes: \"Bug in auth middleware. Token expiry check use `<` not `<=`. Fix:\""

const SHARED_AUTO_CLARITY = "Auto-Clarity: drop caveman for security warnings, irreversible actions, multi-step sequences where fragment ambiguity risks misread, or when user repeats a question. Resume after the clear part."

const SHARED_PERSISTENCE = "ACTIVE EVERY RESPONSE. No revert after many turns. No filler drift. Still active if unsure."

const SHARED_NO_INVENTED_ABBREV = "No invented abbreviations. Standard well-known tech acronyms (DB, API, HTTP, URL, JSON, ID, OS, CPU) OK. Names of code symbols, function names, API names, error strings: keep verbatim."

const SHARED_PRESERVE_LANGUAGE = "Preserve the user's dominant language. User wrote Vietnamese, reply Vietnamese. User wrote English, reply English. Wenyan/classical-Chinese levels override this language-preservation rule. Code identifiers, error strings, file paths, commands: keep in their original form regardless of language."

const SHARED_NO_SELF_REFERENCE = 'No self-reference. Do not name or announce the style (no "caveman mode", no "me caveman think", no "compressed mode active"). Just respond.'

const SHARED_NO_DECORATION = 'No decorative emoji. No narrating tool calls ("I will now search", "I used X to find Y"). No status phrases ("Sure!", "Of course!", "I\'d be happy to"). No causal arrow shorthand ("A -> B -> fails"). State the thing, the action, the reason. Then next step.'

/**
 * Level -> prompt. The `.join(" ")` is upstream's own assembly: each line is a
 * complete instruction, and the blank-line-free single line is what the
 * injector appends as one segment.
 */
const CAVEMAN_PROMPTS = {
  lite: [
    "Respond tersely. Keep grammar and full sentences but drop filler, hedging and pleasantries (just/really/basically/sure/of course/I'd be happy to).",
    "Pattern: state the thing, the action, the reason. Then next step.",
    SHARED_EXAMPLES,
    SHARED_BOUNDARIES,
    SHARED_AUTO_CLARITY,
    SHARED_PERSISTENCE,
    SHARED_NO_INVENTED_ABBREV,
    SHARED_PRESERVE_LANGUAGE,
    SHARED_NO_SELF_REFERENCE,
    SHARED_NO_DECORATION,
  ].join(" "),

  full: [
    "Respond like terse caveman. All technical substance stay exact, only fluff die.",
    "Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries, hedging. Fragments OK. Short synonyms (big not extensive, fix not implement a solution for).",
    "Pattern: [thing] [action] [reason]. [next step].",
    SHARED_EXAMPLES,
    SHARED_BOUNDARIES,
    SHARED_AUTO_CLARITY,
    SHARED_PERSISTENCE,
    SHARED_NO_INVENTED_ABBREV,
    SHARED_PRESERVE_LANGUAGE,
    SHARED_NO_SELF_REFERENCE,
    SHARED_NO_DECORATION,
  ].join(" "),

  ultra: [
    "Respond ultra-terse. Maximum compression. Telegraphic.",
    "Strip conjunctions. One word when one word enough.",
    "Pattern: [thing] [action] [reason]. [next step].",
    SHARED_EXAMPLES,
    SHARED_BOUNDARIES,
    SHARED_AUTO_CLARITY,
    SHARED_PERSISTENCE,
    SHARED_NO_INVENTED_ABBREV,
    SHARED_PRESERVE_LANGUAGE,
    SHARED_NO_SELF_REFERENCE,
    SHARED_NO_DECORATION,
  ].join(" "),

  'wenyan-lite': [
    "Respond semi-classical. Drop filler/hedging but keep grammar structure, classical register.",
    "Use classical Chinese sentence patterns where natural. Keep English for technical terms.",
    SHARED_EXAMPLES,
    SHARED_BOUNDARIES,
    SHARED_AUTO_CLARITY,
    SHARED_PERSISTENCE,
    SHARED_NO_INVENTED_ABBREV,
    SHARED_PRESERVE_LANGUAGE,
    SHARED_NO_SELF_REFERENCE,
    SHARED_NO_DECORATION,
  ].join(" "),

  wenyan: [
    "Respond classical Chinese (文言文). Maximum classical terseness. 80-90% character reduction.",
    "Classical sentence patterns, verbs precede objects, subjects often omitted, classical particles (之/乃/為/其).",
    "Keep English for code, commands, function names, API names, error strings.",
    SHARED_EXAMPLES,
    SHARED_BOUNDARIES,
    SHARED_AUTO_CLARITY,
    SHARED_PERSISTENCE,
    SHARED_NO_INVENTED_ABBREV,
    SHARED_PRESERVE_LANGUAGE,
    SHARED_NO_SELF_REFERENCE,
    SHARED_NO_DECORATION,
  ].join(" "),

  'wenyan-ultra': [
    "Respond extreme classical compression (文言文 ultra). Maximum compression, ultra terse.",
    "Same classical rules as wenyan-full but even more compressed. One classical particle per clause.",
    SHARED_EXAMPLES,
    SHARED_BOUNDARIES,
    SHARED_AUTO_CLARITY,
    SHARED_PERSISTENCE,
    SHARED_NO_INVENTED_ABBREV,
    SHARED_PRESERVE_LANGUAGE,
    SHARED_NO_SELF_REFERENCE,
    SHARED_NO_DECORATION,
  ].join(" "),
}

// ── ponytail ─────────────────────────────────────────────────────────────────
// Same discipline as caveman: shared lines stay shared, levels only swap their
// one intensifier line.

const SHARED_PERSONA = "You are a lazy senior developer. Lazy means efficient, not careless. The best code is the code never written."

const SHARED_LADDER = "Before writing code, stop at the first rung that holds: 1) Does this need to exist at all? (YAGNI) 2) Stdlib does it? Use it. 3) Native platform feature covers it? Use it (CSS over JS, DB constraint over app code). 4) Already-installed dependency solves it? Use it; never add a new one for what a few lines can do. 5) Can it be one line? One line. 6) Only then: the minimum code that works."

const SHARED_RULES = "No unrequested abstractions (no interface with one implementation, no factory for one product, no config for a value that never changes). No boilerplate or scaffolding \"for later\". Deletion over addition. Boring over clever. Fewest files possible; shortest working diff wins. Two stdlib options the same size: take the edge-case-correct one. Mark deliberate simplifications with a `ponytail:` comment naming the ceiling and upgrade path."

const SHARED_OUTPUT = "Code first. Then at most three short lines: what was skipped, when to add it. No essays or design notes. Pattern: `[code] → skipped: [X], add when [Y].`"

const SHARED_NOT_LAZY = "Never simplify away: input validation at trust boundaries, error handling that prevents data loss, security, accessibility, anything explicitly requested. Non-trivial logic leaves ONE runnable check behind (an assert-based self-check or one small test file; no frameworks). Trivial one-liners need no test."

const SHARED_PONYTAIL_PERSISTENCE = "ACTIVE EVERY RESPONSE. No drift back to over-building. Still active if unsure."

const PONYTAIL_PROMPTS = {
  lite: [
    SHARED_PERSONA,
    "Lite: build what's asked, but name the lazier alternative in one line. User picks.",
    SHARED_LADDER,
    SHARED_RULES,
    SHARED_OUTPUT,
    SHARED_NOT_LAZY,
    SHARED_PONYTAIL_PERSISTENCE,
  ].join(" "),

  full: [
    SHARED_PERSONA,
    "Full: the ladder enforced. Stdlib and native first. Shortest diff, shortest explanation.",
    SHARED_LADDER,
    SHARED_RULES,
    SHARED_OUTPUT,
    SHARED_NOT_LAZY,
    SHARED_PONYTAIL_PERSISTENCE,
  ].join(" "),

  ultra: [
    SHARED_PERSONA,
    "Ultra: YAGNI extremist. Deletion before addition. Ship the one-liner and challenge the rest of the requirement in the same response.",
    SHARED_LADDER,
    SHARED_RULES,
    SHARED_OUTPUT,
    SHARED_NOT_LAZY,
    SHARED_PONYTAIL_PERSISTENCE,
  ].join(" "),
}

/**
 * The caveman prompt for one level, or `null` when the level is `off` (or not
 * a level at all).
 *
 * `null` rather than `undefined` on purpose: callers compose the result with
 * `!== null`, and an unknown level must not be silently injectable as the
 * string "undefined".
 *
 * @param {string} level - one of {@link CAVEMAN_LEVELS}
 * @returns {string|null}
 */
export function cavemanPrompt(level) {
  if (typeof level !== 'string' || level === 'off') return null
  return Object.hasOwn(CAVEMAN_PROMPTS, level) ? CAVEMAN_PROMPTS[level] : null
}

/**
 * The ponytail prompt for one level, or `null` when the level is `off` (or not
 * a level at all).
 *
 * @param {string} level - one of {@link PONYTAIL_LEVELS}
 * @returns {string|null}
 */
export function ponytailPrompt(level) {
  if (typeof level !== 'string' || level === 'off') return null
  return Object.hasOwn(PONYTAIL_PROMPTS, level) ? PONYTAIL_PROMPTS[level] : null
}

/**
 * The prompts that are actually active, in injection order: caveman first (it
 * shapes the answer), ponytail second (it shapes the work).
 *
 * A family whose level is `off`, missing or unknown contributes nothing — the
 * settings page can hand over a half-filled object without the caller having
 * to normalise it first.
 *
 * @param {{caveman?: string, ponytail?: string}} [selection]
 * @returns {Array<{id: 'caveman'|'ponytail', level: string, text: string}>}
 */
export function activePrompts({ caveman, ponytail } = {}) {
  const active = []
  const cavemanText = cavemanPrompt(caveman)
  if (cavemanText !== null) active.push({ id: 'caveman', level: caveman, text: cavemanText })
  const ponytailText = ponytailPrompt(ponytail)
  if (ponytailText !== null) active.push({ id: 'ponytail', level: ponytail, text: ponytailText })
  return active
}
