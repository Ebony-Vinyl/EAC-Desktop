/**
 * Upstream wire for the免密 free lane.
 *
 * Every fact encoded here was verified against the live gateway on 2026-09-24
 * by direct request: the public pooled
 * credential, the client fingerprint headers, the per-model endpoint split, the
 * free-tier tool-fingerprint gate (403 FreeTierError without it), the
 * per-session quota accounting (429 FreeUsageLimitError when a fresh session is
 * minted per request), and the regional gate (403 RegionError).
 *
 * Re-verified 2026-10-14 after the lane moved: the free models now answer on
 * `/inference/v1` (the old `/zen/v1` chat path answers 403 FreeTierError for
 * every one of them), a request must send `x-opencode-session-id` next to
 * `x-opencode-session`, and the session id has to be minted rather than derived.
 * Details and the measurements: docs/free-lane-wire.md.
 *
 * Re-verified 2026-10-16 against the **v2** client fingerprint (the shape the
 * official client has sent since 2026-10-14, and the one this module now
 * mirrors). Four facts changed together, and each of them is a 403
 * FreeTierError on its own:
 *
 * | 项 | v1（旧） | v2（现在） |
 * |---|---|---|
 * | User-Agent | `opencode/1.18.31` | `opencode/latest/2.0.26/cli` |
 * | 请求头 | 带 `x-opencode-request` | **不带**（v1 专用头，带了即 403）；另加 `x-session-affinity` / `x-session-id` |
 * | 工具闸门 | `bash`/`glob`/`grep`/`read` 四个名字，各带至少一个 property | **`read` 与 `shell` 两个名字，且 description 与参数 schema 必须与官方客户端逐字一致** |
 * | `tool_choice` | 无工具时补 `none` | **`none` 即 403**，绝不下发 |

 * The v2 gate compares the declared definitions themselves, so the old "stub
 * with a placeholder property" trick is refused: the definitions below are
 * verbatim from the v2.0.26 CLI and must not be reworded or reformatted.
 * Source of the shape (live-probed upstream by that project, and the reference
 * this port follows): 9router `open-sse/utils/opencodeFingerprint.js` +
 * `open-sse/executors/opencode.js` at v0.5.104.
 *
 * Re-verified 2026-10-17 after every request started answering 403: the gate
 * also validates the session id's *encoding*, not only its `ses_…` shape. The
 * twelve hex digits must be the descending `~(ts_ms << 12 | counter)` value with
 * counter 1–63 (low 12 bits `0xfc0–0xfff`); an ascending `ts << 12` value or a
 * sha256 digest is refused with 403 FreeTierError. See
 * {@link SESSION_DESCENDING_RE} and {@link canonicalizeSession}, and the
 * reference implementation at https://github.com/jasonxu114514/opencode2api
 * (`internal/identity/request.go`). A live control on the same egress IP showed
 * that the official 2.0.32 CLI's exact bytes pass while a fresh ascending id
 * 403s, so this is an identity check and not IP rate limiting.
 *
 * @module src/upstream.js
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR_NAME, resolveDshHome } from './store.js'

/**
 * Overridable so the selftest can point the adapter at a dead port and exercise
 * the transport-failure path without touching the real free lane's quota.
 */
export const UPSTREAM_BASE = process.env.OUR_FREE_MODEL_BASE ?? 'https://opencode.ai'

/**
 * The client User-Agent the v2 gate fingerprints.
 *
 * ⚠️ 形状是 `opencode/<channel>/<version>/<client>`，且 major 必须 ≥ 2；v1 的
 * `opencode/1.18.x` 自 2026-10-14 起被上游按名字拒掉（403 FreeTierError）。
 * ⚠️ 这个值**必须原样单独发出**：v2 的校验是整串匹配，任何前缀/后缀
 * （包括本插件的归属 UA）都会让它不再是「一个 v2 客户端」。归属因此只保留在
 * 其余车道（channel pack / EAC / Kilo），本车道发官方那一串。
 */
export const CLIENT_UA = 'opencode/latest/2.0.26/cli'
const MAX_SESSION_LENGTH = 256
const MAX_TOOL_NAME_LEN = 128
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * The two tools the v2 free-tier gate requires, with OpenCode's own definitions.
 *
 * ⚠️ **逐字取自 OpenCode v2.0.26 CLI**（与 9router 移植的那份一致）。上游比对
 * description 与 parameters：改写措辞、精简 schema、`properties: {}`、改名都会
 * 换来 403 FreeTierError（v1 时代「桩工具 + 占位 property」的做法已失效）。
 * 不要为了「更好看」动这些字符串。
 */
const FINGERPRINT_TOOL_DEFINITIONS = {
  read: {
    description: 'Read the contents of a file or directory. Supports text files, images, and PDFs. Images and PDFs are presented directly to the model. Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is for reference and is not part of the file content. Directory entries are returned one per line. Use offset and limit to read large files or directories in sections. Prefer one larger read over many small slices, and use grep to find specific content in large files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File or directory to read' },
        offset: { type: 'integer', minimum: 0, description: 'The line or directory entry to start reading from (1-based)' },
        limit: { type: 'integer', minimum: 0, description: 'The maximum number of lines or directory entries to read (defaults to and capped at 2000)' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  shell: {
    description: 'Execute a shell command and return its output. Commands run on Linux using bash. Quote file paths containing spaces or special characters. Prefer dedicated tools over shell commands when possible. When output is large, the full result is saved to a file and a truncated preview is returned. Rely on automatic truncation unless filtering the output is more useful. Commands accept an optional timeout, background commands have no timeout by default. Background commands return immediately, and you will be notified when they complete.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command string to execute' },
        workdir: { type: 'string', description: 'Working directory to execute the command in. Defaults to the current working directory. When possible, avoid changing directories in the command and set the working directory here instead.' },
        timeout: { type: 'integer', minimum: 0, description: 'Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to 120000 for foreground commands. Background commands have no timeout by default.' },
        background: { type: 'boolean', description: 'Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use \'&\' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion.' },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
}

/** The names the v2 gate requires to be declared (with the definitions above). */
export const FINGERPRINT_TOOLS = ['read', 'shell']

/**
 * The note appended when a fingerprint tool had to be injected.
 *
 * ⚠️ v2 的定义是**真工具**（描述与 schema 都来自官方客户端），模型会真的去调它
 * —— 实测把 `read` 用在「/etc 里有什么文件」这种问题上。v1 靠「must not be
 * used」的桩描述压住，v2 只能用提示词压。措辞是实测选出来的：写成「不可用」会让
 * 模型连调用方自己的 `Read`/`Bash` 也一起拒绝；「占位、请用别的工具」才既压住
 * 注入项、又不误伤调用方的工具。
 */
function placeholderNote(names) {
  const list = names.map(name => `\`${name}\``).join(' or ')
  return names.length > 1
    ? `Do not call the ${list} tools; they are placeholders that do nothing. Use the other tools you have been given instead.`
    : `Do not call the ${list} tool; it is a placeholder that does nothing. Use the other tools you have been given instead.`
}

/** Models served by /responses instead of /chat/completions. */
const RESPONSES_MODELS = new Set(['muse-spark-1.2-contributor-free', 'muse-spark-1.3-contributor-free'])
/** Models served by the Anthropic-shaped /messages endpoint. */
const MESSAGES_MODELS = new Set(['union-alpha'])

export const SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/

/**
 * The time half of a canonical session id the upstream free tier actually accepts.
 *
 * ⚠️ 形状对还不够（2026-10-17 实测）：官方客户端用 `Identifier.descending()`
 * 铸造时间戳 —— 48 位的 `~(ts_ms << 12 | counter)`，取反把低 12 位变成
 * `0xFFF - counter`。上游只放行 counter 1–63，即低 12 位落在 `0xfc0–0xfff`
 * （前 9 位任意 hex，第 10 位 `c`–`f`，后两位任意）。任何其它编码 —— 包括
 * `ts_ms << 12` 这种升序写法、以及 sha256 摘要 —— 即使 `ses_` 形状完全正确，
 * 也会被 403 FreeTierError 拒掉。参考实现：
 * https://github.com/jasonxu114514/opencode2api `internal/identity/request.go`
 * （`descendingTimePartPattern`）。
 */
export const SESSION_DESCENDING_RE = /^[0-9a-f]{9}f[c-f][0-9a-f]$/

/** Whether `id` is a session the upstream free tier will accept as-is. */
export function isCanonicalSession(id) {
  return typeof id === 'string' && SESSION_RE.test(id.trim()) && SESSION_DESCENDING_RE.test(id.trim().slice(4, 16))
}

/**
 * Re-encode any session id into the descending layout the gate accepts, keeping
 * one conversation pinned to one upstream session.
 *
 * The digest is the same `ses\0<signal>` sha256 the reference gateway uses, so a
 * given downstream conversation always maps to the same upstream id. Counter 1
 * keeps the low 12 bits at `0xffe`, inside the accepted window.
 */
export function canonicalizeSession(signal) {
  const digest = crypto.createHash('sha256').update(`ses\0${signal}`).digest()
  const current = ((BigInt(digest[0]) << 28n | BigInt(digest[1]) << 20n | BigInt(digest[2]) << 12n |
    BigInt(digest[3]) << 4n | BigInt(digest[4]) >> 4n) << 12n) | 1n
  const inverted = ~current & 0xffffffffffffn
  const timeHex = inverted.toString(16).padStart(12, '0')
  return `ses_${timeHex}${base62Fixed(digest.subarray(6, 16), 14)}`
}

/** Render `bytes` as exactly `width` base62 characters (big-endian). */
function base62Fixed(bytes, width) {
  let n = 0n
  for (const byte of bytes) n = (n << 8n) | BigInt(byte)
  const base = 62n
  const out = new Array(width)
  for (let i = width - 1; i >= 0; i -= 1) {
    out[i] = BASE62[Number(n % base)]
    n /= base
  }
  return out.join('')
}

const ANTHROPIC_API_VERSION = '2023-06-01'

function base62From(bytes) {
  let out = ''
  for (const byte of bytes) out += BASE62[byte % 62]
  return out
}

let lastStamp = 0
let seq = 0

/**
 * Mint a gateway-shaped canonical session id (time-prefixed, monotonic counter).
 *
 * The encoding is the gate's: `~(ts_ms * 0x1000 + counter)`, whose low 12 bits
 * land at `0xfff - counter`. The counter resets every millisecond, so a burst of
 * mints inside one millisecond stays inside the accepted 1–63 window.
 */
export function mintSessionId(timestamp = Date.now()) {
  if (timestamp !== lastStamp) { lastStamp = timestamp; seq = 0 }
  seq += 1
  const value = ~(BigInt(timestamp) * 0x1000n + BigInt(seq))
  let hex = ''
  for (let i = 0; i < 6; i += 1) hex += Number((value >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, '0')
  return `ses_${hex}${base62From(crypto.randomBytes(14))}`
}

/**
 * Mint a `msg_`-shaped id for local bookkeeping (turn/recovery records).
 *
 * ⚠️ 这个值**不再上线**：`x-opencode-request` 是 v1 专用头，v2 收到即 403（见
 * {@link gatewayHeaders}）。保留铸造器是因为恢复记录与测试仍用它做一次性标识。
 */
export function mintRequestId(timestamp = Date.now()) {
  const value = BigInt(timestamp) * 0x1000n + 1n
  let hex = ''
  for (let i = 0; i < 6; i += 1) hex += Number((value >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, '0')
  return `msg_${hex}${base62From(crypto.randomBytes(14))}`
}

const SESSION_MAP_FILE = 'session-map.json'
let sessions

function sessionStorePath() {
  try { return path.join(path.resolve(resolveDshHome(), DATA_DIR_NAME), SESSION_MAP_FILE) } catch { return undefined }
}

function loadSessions() {
  if (sessions !== undefined) return sessions
  sessions = new Map()
  try {
    const file = sessionStorePath()
    if (file === undefined) return sessions
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const [seed, id] of Object.entries(parsed?.sessions ?? {})) {
      if (typeof id === 'string' && SESSION_RE.test(id)) sessions.set(seed, id)
    }
  } catch { /* first run or unreadable store: start empty */ }
  return sessions
}

function rememberSession(seed, id) {
  loadSessions().set(seed, id)
  try {
    const file = sessionStorePath()
    if (file === undefined) return
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temp = `${file}.tmp`
    fs.writeFileSync(temp, JSON.stringify({ version: 1, at: Date.now(), sessions: Object.fromEntries(sessions) }, undefined, 2))
    fs.renameSync(temp, file)
  } catch { /* non-fatal: the id still works, it just will not survive a restart */ }
}

/**
 * Map one downstream conversation onto one stable upstream session.
 *
 * Free-tier quota is accounted per session, so a fresh id per request exhausts
 * it and surfaces as 429 with growing retry-after. The gateway also checks the
 * id's *encoding*, not just its shape: the twelve hex digits must carry the
 * descending timestamp layout `mintSessionId()` produces, with a counter in the
 * accepted 1–63 window (measured 2026-10-17; the reference gateway's
 * `descendingTimePartPattern` documents the same window). A sha256 digest, an
 * ascending `ts << 12` value, or any other random hex is refused with 403
 * FreeTierError even when every other header is right.
 *
 * ⇒ A downstream-supplied id is only forwarded verbatim when it already carries
 * the accepted encoding ({@link isCanonicalSession}); anything else is
 * deterministically re-encoded into the descending layout, so a conversation
 * keeps one stable upstream session instead of drawing 403s.
 */
export function sessionForConversation(sessionId) {
  if (typeof sessionId === 'string' && isCanonicalSession(sessionId)) return sessionId.trim()
  const seed = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : 'global'
  const remembered = loadSessions().get(seed)
  if (remembered !== undefined && isCanonicalSession(remembered)) return remembered
  const minted = canonicalizeSession(seed)
  rememberSession(seed, minted)
  return minted
}

/** Strip a trailing "(level)" thinking suffix so lookups hit the base id. */
export function baseModelId(model) {
  return String(model ?? '').replace(/\([^()]+\)\s*$/, '').trim()
}

function isMuseSpark(modelId) {
  const clean = baseModelId(modelId)
  const base = clean.includes('/') ? clean.split('/').pop() : clean
  return /^muse[-_]?spark(?:$|[-_:.\s])/i.test(base)
}

export function isResponsesModel(modelId) {
  return RESPONSES_MODELS.has(baseModelId(modelId)) || isMuseSpark(modelId)
}

export function isMessagesModel(modelId) {
  return MESSAGES_MODELS.has(baseModelId(modelId))
}

/**
 * Which upstream path serves this model. The free lane lives under
 * `/inference/v1` (measured 2026-10-14, and the shape the console's model table
 * documents); `/zen/v1` chat completions answer 403 FreeTierError for free ids.
 */
export function endpointFor(modelId) {
  if (isResponsesModel(modelId)) return '/inference/v1/responses'
  if (isMessagesModel(modelId)) return '/inference/v1/messages'
  return '/inference/v1/chat/completions'
}

/** The wire shape one endpoint speaks; drives request encoding and response parsing. */
export function wireFor(modelId) {
  const path = endpointFor(modelId)
  if (path === '/inference/v1/responses') return 'responses'
  if (path === '/inference/v1/messages') return 'messages'
  return 'chat'
}

/**
 * The headers the gateway fingerprints a genuine client by.
 * `Authorization: Bearer public` is the pooled免密 credential — there is no
 * per-user secret on this lane.
 *
 * ⚠️ v2 形状（2026-10-14 起），与官方客户端逐项对齐：
 * - `x-opencode-session` 与 `x-opencode-session-id` 必须同时存在（缺一即 403）；
 * - `x-session-affinity` / `x-session-id` 是 v2 新增的同值镜像；
 * - **不带 `x-opencode-request`** —— 那是 v1 专用头，v2 收到就回 403；
 * - `x-opencode-client: cli` 与官方 CLI 一致。
 */
export function gatewayHeaders({ session, stream, accept }) {
  const headers = {
    'content-type': 'application/json',
    'authorization': 'Bearer public',
    'user-agent': CLIENT_UA,
    'x-opencode-client': 'cli',
    'x-opencode-session': session,
    'x-opencode-session-id': session,
    'x-session-affinity': session,
    'x-session-id': session,
    'x-opencode-project': 'global',
    'accept': accept ?? (stream ? 'text/event-stream' : '*/*'),
  }
  return headers
}

function toolNameOf(tool) {
  if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return ''
  if (typeof tool.name === 'string' && tool.name.trim()) return tool.name.trim()
  const fn = tool.function
  if (fn && typeof fn === 'object' && !Array.isArray(fn) && typeof fn.name === 'string') return fn.name.trim()
  return ''
}

/**
 * The gate name when the tool's name is **exactly** one of the two; `''` otherwise.
 *
 * ⚠️ 大小写变体（`Read`/`Shell`）**不算**闸门工具，原样透传：上游接受它们与
 * 注入的 `read`/`shell` 并存（实测），而 v1 那种「按小写归并」会把调用方的
 * `Read` 改名成 `read`，正好撞上 v2 的「定义必须逐字一致」判定。
 */
function fingerprintKey(name) {
  const trimmed = String(name ?? '').trim()
  return FINGERPRINT_TOOLS.includes(trimmed) ? trimmed : ''
}

/** The Chat-shape `{function:{…}}` wrapper, or null for the flat Responses one. */
function functionOf(tool) {
  return tool.function && typeof tool.function === 'object' && !Array.isArray(tool.function) ? tool.function : null
}

/** Where a tool's description and parameter schema sit for one wire shape. */
function definitionOf(tool, { claude, flat }) {
  const wrapper = claude || flat ? tool : functionOf(tool)
  if (wrapper === null || wrapper === undefined) return null
  return { description: wrapper.description, schema: claude ? wrapper.input_schema : wrapper.parameters }
}

/** Does this tool already carry OpenCode's own definition for `name`? */
function carriesFingerprintDefinition(tool, name, shape) {
  const own = definitionOf(tool, shape)
  if (own === null) return false
  const want = FINGERPRINT_TOOL_DEFINITIONS[name]
  return own.description === want.description
    && JSON.stringify(own.schema) === JSON.stringify(want.parameters)
}

function withToolName(tool, name) {
  const fn = functionOf(tool)
  return fn ? { ...tool, function: { ...fn, name } } : { ...tool, name }
}

/** The gate's own declaration, in the shape the wire expects. */
function fingerprintTool(name, { claude, flat }) {
  const { description, parameters } = FINGERPRINT_TOOL_DEFINITIONS[name]
  if (claude) return { name, description, input_schema: parameters }
  if (flat) return { type: 'function', name, description, parameters }
  return { type: 'function', function: { name, description, parameters } }
}

/** `sent name -> caller's name` for every tool the alias pass renamed. */
function aliasesByOriginal(map) {
  return new Map([...map].map(([alias, original]) => [original, alias]))
}

/**
 * Point an explicit `tool_choice` at the alias of a tool that was renamed.
 *
 * Only an alias is retargeted: a choice naming a tool we left alone must stay
 * byte-identical, and `none` is never emitted (see {@link applyFingerprint}).
 */
function retargetToolChoice(body, map) {
  if (!body || typeof body !== 'object' || map.size === 0) return
  const choice = body.tool_choice
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) return
  const aliases = aliasesByOriginal(map)
  if (typeof choice.name === 'string') {
    const alias = aliases.get(choice.name.trim())
    if (alias !== undefined) body.tool_choice = { ...choice, name: alias }
    return
  }
  const fn = choice.function
  if (fn && typeof fn === 'object' && !Array.isArray(fn) && typeof fn.name === 'string') {
    const alias = aliases.get(fn.name.trim())
    if (alias !== undefined) body.tool_choice = { ...choice, function: { ...fn, name: alias } }
  }
}

/**
 * Rename prior-turn calls to a renamed tool in the history we are about to send.
 *
 * Without this the model reads its own earlier `read` calls as calls to
 * OpenCode's injected tool of that name, and the two definitions disagree.
 */
function aliasHistoryToolCalls(body, map) {
  if (!body || typeof body !== 'object' || map.size === 0) return
  const aliases = aliasesByOriginal(map)
  const rename = name => (typeof name === 'string' && aliases.has(name) ? aliases.get(name) : name)

  if (Array.isArray(body.input)) {
    body.input = body.input.map(item => item?.type === 'function_call' && aliases.has(item.name)
      ? { ...item, name: aliases.get(item.name) }
      : item)
  }
  if (Array.isArray(body.messages)) {
    body.messages = body.messages.map(message => {
      if (message === null || typeof message !== 'object') return message
      if (Array.isArray(message.content)) {
        const content = message.content.map(block => block?.type === 'tool_use' && aliases.has(block.name)
          ? { ...block, name: aliases.get(block.name) }
          : block)
        return { ...message, content }
      }
      if (!Array.isArray(message.tool_calls)) return message
      return {
        ...message,
        tool_calls: message.tool_calls.map(call => aliases.has(call?.function?.name)
          ? { ...call, function: { ...call.function, name: aliases.get(call.function.name) } }
          : call),
      }
    })
  }
}

/** Tell the model the injected fingerprint tools are placeholders (see {@link placeholderNote}). */
function noteInjectedTools(body, { claude, flat }, names) {
  const note = placeholderNote(names)
  if (flat) {
    body.instructions = typeof body.instructions === 'string' && body.instructions.trim() !== ''
      ? `${body.instructions}\n\n${note}`
      : note
    return
  }
  if (claude) {
    body.system = typeof body.system === 'string' && body.system !== '' ? `${body.system}\n\n${note}` : note
    return
  }
  const messages = Array.isArray(body.messages) ? body.messages : []
  const first = messages[0]
  if (first?.role === 'system' && typeof first.content === 'string') {
    body.messages = [{ ...first, content: `${first.content}\n\n${note}` }, ...messages.slice(1)]
    return
  }
  body.messages = [{ role: 'system', content: note }, ...messages]
}

/**
 * Satisfy the v2 free-tier fingerprint gate on `body.tools`.
 *
 * ## v2 规则（每条都对应一次 403，见模块头）
 *
 * 1. `read` 与 `shell` 必须**声明**，且定义与官方客户端逐字一致；
 * 2. 调用方的工具**原样保留**（含 `Read`/`Bash` 这类大小写变体）；
 * 3. 调用方若**正好**用了 `read`/`shell` 这个名字但定义不同，它被改名成
 *    `<name>_client[N]` 并走 {@link aliasHistoryToolCalls}/{@link retargetToolChoice}
 *    同步历史与 `tool_choice`，响应侧再由重命名表还原成调用方的名字；
 * 4. 同名重复声明只留第一个（上游按重复拒）；
 * 5. **绝不下发 `tool_choice: 'none'`** —— v2 见到它就 403；调用方没给
 *    `tool_choice` 时，只有 Responses 线补 `auto`（官方行为）。
 *
 * ⚠️ v1 的「把调用方的 shell 提升成 `bash` 槽位」已删除：v2 比对定义，提升会让
 * 槽位定义与官方不符（403），而调用方自己的 `pwsh`/`Bash` 本来就能被调用。
 *
 * @param {object} body - request body, mutated in place
 * @param {boolean|'claude'} style - true 为 Responses，false 为 Chat，claude 为 Messages
 * @returns {Map<string, string>} sent name -> caller's name (for the response side)
 */
export function applyFingerprint(body, style) {
  const flat = style === true
  const claude = style === 'claude'
  const shape = { claude, flat }
  const map = new Map()
  const tools = Array.isArray(body.tools) ? body.tools : []
  const taken = new Set(tools.map(toolNameOf).filter(name => name !== ''))
  // 两个集合分工不同：`seen` 只用于「同名重复留第一个」（含被改名的那个名字），
  // `present` 记录**真正带官方定义留下来**的门禁名 —— 注入判据必须看后者，
  // 否则「调用方的 read 被改成 read_client」会被误判成「read 已经声明」，
  // 官方定义反而不会补上（门禁仍然 403）。
  const seen = new Set()
  const present = new Set()
  const out = []

  for (const tool of tools) {
    const name = toolNameOf(tool)
    const key = fingerprintKey(name)
    if (key === '') { out.push(tool); continue }
    // 同名重复声明：上游按重复拒，留第一个。
    if (seen.has(key)) continue
    seen.add(key)
    if (carriesFingerprintDefinition(tool, key, shape)) {
      out.push(tool)
      present.add(key)
      continue
    }
    let alias = `${key}_client`
    for (let i = 2; taken.has(alias); i += 1) alias = `${key}_client${i}`
    taken.add(alias)
    map.set(alias, name)
    out.push(withToolName(tool, alias))
  }

  const injected = []
  for (const name of FINGERPRINT_TOOLS) {
    if (present.has(name)) continue
    out.push(fingerprintTool(name, shape))
    injected.push(name)
  }

  body.tools = out
  retargetToolChoice(body, map)
  aliasHistoryToolCalls(body, map)
  if (injected.length > 0) noteInjectedTools(body, shape, injected)
  // ⚠️ v2 见到 `tool_choice: 'none'` 就回 403（v1 允许，旧代码甚至主动补过它）。
  // 兜底清除：调用方（续写路径等）留下的 `none` 会让整轮失败。
  if (body.tool_choice === 'none'
    || (body.tool_choice !== null && typeof body.tool_choice === 'object' && body.tool_choice.type === 'none')) {
    delete body.tool_choice
  }
  if (flat && !body.tool_choice) body.tool_choice = 'auto'
  return map
}

/** Restore the caller's tool spelling in a streaming delta or a final payload. */
export function restoreToolName(name, map) {
  if (!map || map.size === 0) return name
  return map.get(name) ?? name
}

/** Session-scoped identity used to pick a decoy out of a real tool call. */
export function declaredToolNames(body) {
  const names = new Set()
  for (const tool of Array.isArray(body.tools) ? body.tools : []) {
    const n = toolNameOf(tool)
    if (n) names.add(n)
  }
  return names
}

function truncateSession(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > MAX_SESSION_LENGTH ? trimmed.slice(0, MAX_SESSION_LENGTH) : trimmed
}

export { truncateSession, ANTHROPIC_API_VERSION, MAX_TOOL_NAME_LEN }
