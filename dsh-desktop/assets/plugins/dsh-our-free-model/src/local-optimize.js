/**
 * The five requests Claude Code asks that can be answered without a provider call.
 *
 * Every one of them is a fixed question whose answer the request body already
 * contains — a quota probe, the command prefix behind a permission prompt, a
 * session title, a suggestion-mode turn, a filepath extraction — and forwarding
 * one upstream spends the free lane's quota and a whole round trip on a question
 * with one right answer. Each detector below reads only the request shape and
 * returns a canned answer; a request that does not match is left untouched.
 *
 * Ported from the Python gateway's `api/optimization_handlers.py`,
 * `api/detection.py` and `api/command_utils.py`, keeping its trigger conditions,
 * its evaluation order and its fallbacks, so both gateways answer the same
 * requests the same way.
 *
 * @module src/local-optimize.js
 */

import { randomUUID } from 'node:crypto'

/**
 * Evaluation order: cheapest and most common first, so a quota probe — one
 * integer and one substring — short-circuits before the detectors that have to
 * parse a command line.
 */
export const OPTIMIZATIONS = ['quota', 'prefix', 'title', 'suggestion', 'filepath']

/** Commands whose second word names the operation, so both words are the prefix. */
const TWO_WORD_COMMANDS = new Set(['git', 'npm', 'docker', 'kubectl', 'cargo', 'go', 'pip', 'yarn'])

/** Commands that only list names, so a mock has no file contents to point at. */
const LISTING_COMMANDS = new Set(['ls', 'dir', 'find', 'tree', 'pwd', 'cd', 'mkdir', 'rmdir', 'rm'])

/** Commands that read contents, so their non-flag arguments are the file paths. */
const READING_COMMANDS = new Set(['cat', 'head', 'tail', 'less', 'more', 'bat', 'type'])

/** grep flags that consume the token after them; `-e`/`-f` also supply the pattern. */
const GREP_FLAGS_WITH_ARGS = new Set(['-e', '-f', '-m', '-A', '-B', '-C'])

/** A shell-style `NAME=value` word, the shape that precedes a command. */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=[^\n]*$/

/** What a filepath extraction says when the command names no path. */
const EMPTY_FILEPATHS = '<filepaths>\n</filepaths>'

/**
 * @typedef {object} LocalAnswer
 * @property {'quota'|'prefix'|'title'|'suggestion'|'filepath'} kind - which optimization answered
 * @property {string} text - the body of the fake assistant turn
 * @property {{input: number, output: number}} usage - the token counts a client is told it cost
 * @property {string} model - the model the answer is attributed to
 */

/**
 * Concatenated text of a message body or a system block list.
 *
 * Joining with nothing between blocks is deliberate: the detectors below are
 * substring tests, and a separator inserted between two blocks could break a
 * phrase that spans them. Every block carrying a non-empty `text` counts,
 * whatever its type — the Python extractor reads the attribute, not the type.
 */
function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) {
    if (typeof block?.text === 'string' && block.text !== '') text += block.text
  }
  return text
}

/** Top-level system text plus every inline system message, newline-joined. */
function systemText(request) {
  const parts = []
  const top = textOf(request?.system)
  if (top !== '') parts.push(top)
  for (const message of request?.messages ?? []) {
    if (message?.role !== 'system') continue
    const text = textOf(message.content)
    if (text !== '') parts.push(text)
  }
  return parts.join('\n')
}

/**
 * The sole conversational user turn, ignoring system context.
 *
 * `undefined` when there is none, or when anything else breaks the shape the
 * optimizations need: a second user turn, an assistant turn, a tool answer.
 */
function singleUserTurn(request) {
  let turn
  for (const message of request?.messages ?? []) {
    if (message?.role === 'system') continue
    if (message?.role !== 'user' || turn !== undefined) return undefined
    turn = message
  }
  return turn
}

/** Whether the request declares tools — the one shape a title or filepath ask never has. */
function hasTools(request) {
  const tools = request?.tools
  return Array.isArray(tools) ? tools.length > 0 : Boolean(tools)
}

/** Characters a backslash escapes outside quotes, where a stray `\` is a path separator. */
const ESCAPABLE = new Set([' ', '\t', '\n', '\r', '\f', '\v', "'", '"'])

/**
 * Split a command into shell words without running anything.
 *
 * Only the shapes a permission prompt carries are modelled: whitespace
 * separation, single and double quotes (removed, so a quoted path arrives as
 * the path), and backslash escapes. A backslash is only an escape before
 * whitespace or a quote — before anything else it is a literal, so a Windows
 * path (`type C:\notes\todo.md`) survives, which a POSIX reading of `\n` would
 * silently eat. Unbalanced quoting throws the way `shlex.split` does, which
 * keeps the callers' naive-split fallback for a command the shell itself would
 * reject.
 */
function shellWords(command) {
  const words = []
  let word = null
  let quote = ''
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if (quote === "'") {
      if (char === "'") quote = ''
      else word += char
      continue
    }
    if (quote === '"') {
      if (char === '"') { quote = ''; continue }
      if (char === '\\') {
        const next = command[index + 1]
        // Inside double quotes the shell only strips a backslash before a
        // character it gives meaning to; before anything else it stays literal.
        if (next === '"' || next === '\\' || next === '$' || next === '`') {
          word += next
          index += 1
        } else word += '\\'
        continue
      }
      word += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      if (word === null) word = ''
      continue
    }
    if (char === '\\' && ESCAPABLE.has(command[index + 1])) {
      if (word === null) word = ''
      word += command[index + 1]
      index += 1
      continue
    }
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f' || char === '\v') {
      if (word !== null) { words.push(word); word = null }
      continue
    }
    if (word === null) word = ''
    word += char
  }
  if (quote !== '') throw new Error('no closing quotation')
  if (word !== null) words.push(word)
  return words
}

/** Whether a word is a shell-style env assignment (`FOO=bar`, `FOO="a b"`). */
function isEnvAssignment(part) {
  return ENV_ASSIGNMENT.test(part)
}

/** The command words that follow the leading env assignments. */
function stripEnvAssignments(parts) {
  let start = 0
  for (let index = 0; index < parts.length; index += 1) {
    if (!isEnvAssignment(parts[index])) break
    start = index + 1
  }
  return parts.slice(start)
}

/**
 * The prefix a permission prompt is asking about: `git`, `git commit`,
 * `npm install` — or the reason it cannot be derived.
 *
 * A substitution would run a second command, and the prefix is a label for the
 * permission dialog rather than something to execute, so a command carrying one
 * is reported instead of parsed.
 *
 * @returns {string} the prefix, `none`, or `command_injection_detected`
 */
export function extractCommandPrefix(command) {
  const text = typeof command === 'string' ? command : ''
  if (text.includes('`') || text.includes('$(')) return 'command_injection_detected'

  let parts
  try {
    parts = shellWords(text)
  } catch {
    // The shell would refuse the line; answer from a whitespace split the way
    // the Python gateway's shlex fallback does rather than guessing at quotes.
    const fallback = stripEnvAssignments(text.split(/\s+/).filter(part => part !== ''))
    return fallback.length > 0 ? fallback[0] : 'none'
  }
  if (parts.length === 0) return 'none'

  const env = []
  let start = 0
  for (let index = 0; index < parts.length; index += 1) {
    if (!isEnvAssignment(parts[index])) break
    env.push(parts[index])
    start = index + 1
  }
  if (start >= parts.length) return 'none'

  const commandParts = parts.slice(start)
  const first = commandParts[0]
  if (TWO_WORD_COMMANDS.has(first) && commandParts.length > 1) {
    const second = commandParts[1]
    if (!second.startsWith('-')) return `${first} ${second}`
    return first
  }
  // Carried over from the Python gateway: a one-word command keeps its env
  // prefix (`FOO=1 ls`), while the two-word branch above drops it (`FOO=1 git
  // status` answers `git status`). Both are labels for a dialog, not commands.
  return env.length === 0 ? first : `${env.join(' ')} ${first}`
}

/**
 * The file paths a command reads, in the `<filepaths>` block Claude Code parses.
 *
 * A listing command names files without reading them, so there is nothing to
 * extract and the block is empty; a reading command's non-flag arguments are
 * the paths; grep's pattern is not a path and is skipped.
 *
 * `output` is accepted because the caller has the request's `Output:` section in
 * hand (the Python signature takes it too) but is never consulted: a command's
 * read targets are its own arguments. Truncating that section is the detector's
 * job.
 */
export function extractFilepathsFromCommand(command, output) {
  void output
  const text = typeof command === 'string' ? command : ''
  let parts
  try {
    parts = shellWords(text)
  } catch {
    return EMPTY_FILEPATHS
  }
  const commandParts = stripEnvAssignments(parts)
  if (commandParts.length === 0) return EMPTY_FILEPATHS

  const base = commandParts[0].split('/').pop().split('\\').pop().toLowerCase()
  if (LISTING_COMMANDS.has(base)) return EMPTY_FILEPATHS
  if (READING_COMMANDS.has(base)) {
    return filepathBlock(commandParts.slice(1).filter(part => !part.startsWith('-')))
  }
  if (base !== 'grep') return EMPTY_FILEPATHS

  // `-e pattern` / `--regexp pattern` supply the pattern, so every positional
  // left is a path; otherwise the first positional is the pattern and the rest
  // are paths. `--regexp=pattern` supplies it without a separate word.
  let patternViaFlag = false
  const positional = []
  let skipNext = false
  for (const part of commandParts.slice(1)) {
    if (skipNext) { skipNext = false; continue }
    if (!part.startsWith('-')) { positional.push(part); continue }
    if (part === '-e' || part === '-f' || part === '--regexp') {
      patternViaFlag = true
      skipNext = true
    } else if (part.startsWith('--regexp=')) {
      patternViaFlag = true
    } else if (GREP_FLAGS_WITH_ARGS.has(part)) {
      skipNext = true
    }
  }
  return filepathBlock(patternViaFlag ? positional : positional.slice(1))
}

/** A `<filepaths>` block listing the paths, or the empty block when there are none. */
function filepathBlock(paths) {
  return paths.length === 0 ? EMPTY_FILEPATHS : `<filepaths>\n${paths.join('\n')}\n</filepaths>`
}

/**
 * The `Output:` section ends at the first tag or blank line.
 *
 * The section is the command's stdout, and Claude Code's prompt appends its own
 * markup after it; the tail is never part of the output. Unobservable in the
 * answer (paths come from the command), kept so the section is reduced exactly
 * where the Python detector reduces it.
 */
function truncateOutput(output) {
  let text = output
  for (const marker of ['<', '\n\n']) {
    if (text.includes(marker)) text = text.split(marker)[0].trim()
  }
  return text
}

/** `max_tokens: 1` and a lone user turn that says "quota" is the quota probe. */
function quotaAnswer(request) {
  const message = singleUserTurn(request)
  if (message === undefined) return null
  const maxTokens = request?.max_tokens
  // The Python model coerces a numeric string on the wire; accept both spellings.
  if (!(maxTokens === 1 || maxTokens === '1')) return null
  if (!textOf(message.content).toLowerCase().includes('quota')) return null
  return { text: 'Quota check passed.', usage: { input: 10, output: 5 } }
}

/** A policy spec plus a `Command:` section is the permission-prefix ask. */
function prefixAnswer(request) {
  const message = singleUserTurn(request)
  if (message === undefined) return null
  const content = textOf(message.content)
  if (!content.includes('<policy_spec>') || !content.includes('Command:')) return null
  // The last marker wins: the policy spec above it may itself quote the word.
  const start = content.lastIndexOf('Command:') + 'Command:'.length
  return { text: extractCommandPrefix(content.slice(start).trim()), usage: { input: 100, output: 5 } }
}

/** A title prompt is recognised by its system text, and never carries tools. */
function titleAnswer(request) {
  if (hasTools(request)) return null
  const system = systemText(request).toLowerCase()
  if (!system.includes('title')) return null
  const sentenceCase = system.includes('sentence-case title')
  const jsonField = system.includes('return json') && system.includes('field')
    && (system.includes('coding session') || system.includes('this session'))
  if (!sentenceCase && !jsonField) return null
  return { text: 'Conversation', usage: { input: 100, output: 5 } }
}

/** The suggestion-mode marker may sit in any user message; the answer is "none". */
function suggestionAnswer(request) {
  for (const message of request?.messages ?? []) {
    if (message?.role !== 'user') continue
    if (textOf(message.content).includes('[SUGGESTION MODE:')) {
      return { text: '', usage: { input: 100, output: 1 } }
    }
  }
  return null
}

/** A `Command:`/`Output:` pair asking for file paths, with no tools in play. */
function filepathAnswer(request) {
  const message = singleUserTurn(request)
  if (message === undefined || hasTools(request)) return null
  const content = textOf(message.content)
  if (!content.includes('Command:') || !content.includes('Output:')) return null

  const lower = content.toLowerCase()
  const userNamesFilepaths = lower.includes('filepaths') || lower.includes('<filepaths>')
  const system = systemText(request).toLowerCase()
  const systemAsksForPaths = system.includes('extract any file paths') || system.includes('file paths that this command')
  if (!userNamesFilepaths && !systemAsksForPaths) return null

  const start = content.indexOf('Command:') + 'Command:'.length
  const marker = content.indexOf('Output:', start)
  if (marker === -1) return null
  const command = content.slice(start, marker).trim()
  const output = truncateOutput(content.slice(marker + 'Output:'.length).trim())
  return { text: extractFilepathsFromCommand(command, output), usage: { input: 100, output: 10 } }
}

/** Detector per optimization, keyed by the name {@link OPTIMIZATIONS} uses. */
const DETECTORS = {
  quota: quotaAnswer,
  prefix: prefixAnswer,
  title: titleAnswer,
  suggestion: suggestionAnswer,
  filepath: filepathAnswer,
}

/** The first enabled optimization that matches, or null. */
function firstAnswer(request, enabled) {
  for (const kind of OPTIMIZATIONS) {
    if (enabled?.[kind] === false) continue
    const answer = DETECTORS[kind](request)
    if (answer !== null) return { kind, ...answer }
  }
  return null
}

/**
 * Which optimization would answer this request, if any.
 *
 * @param {object} request - Anthropic Messages-shaped body
 * @param {{quota?: boolean, prefix?: boolean, title?: boolean, suggestion?: boolean, filepath?: boolean}} [enabled]
 *   - omit an entry to leave that optimization on; `false` disables it
 * @returns {'quota'|'prefix'|'title'|'suggestion'|'filepath'|null}
 */
export function detectOptimization(request, enabled) {
  return firstAnswer(request, enabled)?.kind ?? null
}

/**
 * Answer the request locally when one of the five optimizations applies.
 *
 * @param {object} request - Anthropic Messages-shaped body
 * @param {object} [options]
 * @param {{quota?: boolean, prefix?: boolean, title?: boolean, suggestion?: boolean, filepath?: boolean}} [options.enabled]
 *   - all five are on unless switched off individually
 * @param {string} [options.model] - model to attribute the answer to; defaults to the request's
 * @returns {LocalAnswer|null} the answer, or null to forward the request upstream
 */
export function tryOptimizations(request, options = {}) {
  const answer = firstAnswer(request, options?.enabled)
  if (answer === null) return null
  const model = options?.model ?? request?.model
  return { kind: answer.kind, text: answer.text, usage: answer.usage, model: typeof model === 'string' ? model : '' }
}

/**
 * Wrap a local answer in the Anthropic Messages response a caller expects.
 *
 * The token counts are the ones the Python gateway reports for a locally
 * answered turn: non-zero so a client does not read the response as empty, and
 * small because no model ran.
 *
 * @param {LocalAnswer} result - from {@link tryOptimizations}
 * @param {object} [options]
 * @param {string} [options.model] - overrides the answer's own model
 * @param {string} [options.id] - response id; generated when absent
 */
export function toMessagesResponse(result, { model, id } = {}) {
  return {
    id: typeof id === 'string' && id !== '' ? id : `msg_${randomUUID().replace(/-/g, '')}`,
    type: 'message',
    role: 'assistant',
    model: model ?? result?.model ?? '',
    content: [{ type: 'text', text: result?.text ?? '' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: result?.usage?.input ?? 0,
      output_tokens: result?.usage?.output ?? 0,
    },
  }
}
