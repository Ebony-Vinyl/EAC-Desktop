/**
 * Host half of the WeChat channel.
 *
 * It owns one long-poll monitor per logged-in bot account, routes inbound messages
 * into DSH sessions, and forwards assistant output back to the chat. All protocol
 * work lives in `@dsh-wechat/core`; this file is the glue to the host.
 *
 * @module dsh-wechat-plugin/host
 */
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { ChannelMonitor, SessionRouter, StateStore, UploadMediaType, downloadItemMedia, findSentMessage, login as loginHandshake, isSameWorkspace, listAllStoredSessions, storedSessionWorkspace, rememberSentMessage, resolveSettings, sendFile, sendImage, sendText, sendToolCard, sendVideo, renderSessionRow, toDataUrl, uploadMedia, SendRefusedError, queuePendingNotification, expirePendingNotifications, } from '../../core/lib/index.js';
import { ROUTE_CLIENT_ERROR, ROUTE_DIAGNOSTICS, ROUTE_DISCONNECT, ROUTE_LOGIN_CANCEL, ROUTE_LOGIN_START, ROUTE_LOGIN_STATE, ROUTE_LOGIN_VERIFY, ROUTE_SETTINGS, ROUTE_STATUS, ROUTE_TOGGLE, } from "./routes.js";
import { MEDIA_LABEL_BY_KIND, MEDIA_TYPE_BY_KIND, mediaKindOf, } from "./media-kind.js";
import { parseApprovalReply, parseQuestionReply, presentApproval, presentQuestions, } from "./interactions.js";
import { readStreamFrame, } from "./services.js";
/** Cordis plugin name. */
export const name = 'dsh-wechat-plugin';
/** Host services this plugin reads. A missing one keeps the plugin pending. */
export const inject = ['sessionController', 'sessions', 'workspaceRegistry', 'tools'];
/** How long the assistant may stay quiet before its reply is sent to WeChat. */
const REPLY_SETTLE_MS = 1_200;
/**
 * How long a finished turn waits for the harness's tool results before closing its cards.
 *
 * `tools/result` is dispatched against the calling agent's scope, so it may not reach this
 * host-scope plugin at all. Waiting briefly costs nothing and lets a real status — including
 * a failure — be reported instead of an assumed success.
 */
const TOOL_CARD_GRACE_MS = 1_500;
/** Upper bound on one outbound WeChat message. The service rejects very long bodies. */
const MAX_REPLY_CHARS = 4_000;
/** How long a finished login result stays visible before a new attempt is allowed. */
const LOGIN_RESULT_TTL_MS = 30_000;
/**
 * How often to re-send the "typing…" indicator while a turn is running.
 *
 * The client stops showing it after a few seconds, so sending it once at the start of a task that
 * takes a minute is the same as not sending it at all.
 */
const TYPING_REFRESH_MS = 5_000;
/**
 * When to give up showing "typing…" regardless of the turn.
 *
 * Nothing should ever be composing for this long, and the indicator must not be able to stick: if a
 * reply never arrives, this is what stops the channel from re-sending forever.
 */
const TYPING_MAX_MS = 30 * 60 * 1000;
/**
 * Directory name for the WeChat sessions' workspace, under the DSH home.
 *
 * Every session this channel creates uses this one directory as its `cwd`. That is
 * deliberate and load-bearing:
 *
 * - It groups the channel's sessions in a single folder on the desktop, the way the
 *   `dsh_orb` bundle does with `dsh_orb`, so they are easy to find and archive.
 * - The host compares `cwd` on every adopt and refuses a mismatch, so the value has
 *   to be stable for the life of a session. A per-message or per-conversation path
 *   would permanently break re-attaching to an existing session.
 */
const WORKSPACE_DIR_NAME = 'dsh_wechat';
/**
 * Folder name this channel's sessions appear under on the desktop.
 *
 * Sessions are grouped by Workspace, and a session created with a bare `cwd` lands in
 * the built-in "Ungrouped" bucket, which cannot be named. Registering a Workspace and
 * titling it is what produces a real, named folder.
 */
const WORKSPACE_TITLE = '微信会话';
/**
 * Where inbound attachments are written.
 *
 * Inside the session workspace on purpose: the agent can open the path with an
 * ordinary file read, and it stays in the same folder the conversation shows up in,
 * so a downloaded photo is where the session already looks.
 */
const MEDIA_DIR_NAME = '媒体';
/**
 * Diagnostics log beside the state file.
 *
 * Named once so the settings page can show the same path the writer uses; a second literal is a
 * path that silently drifts the first time one of them changes.
 */
const BOOT_LOG_NAME = 'boot.log';
/**
 * The session tool's description, which carries the confirmation policy.
 *
 * The policy travels in the description because the decision is the agent's: it is the one that
 * knows whether the user actually asked to switch. Stating the rule there is what makes the setting
 * effective without a second round trip, and it is why the registry has to be re-registered when
 * the setting changes — the description is taken by value.
 *
 * @param requireConfirmation - Whether the user wants actions confirmed first.
 * @returns The description to register.
 */
export function sessionToolDescription(requireConfirmation) {
    const base = 'Manage which WeChat conversation (session) this channel is talking to. Call this whenever the ' +
        'user asks to see their conversations, switch between them, start a new one, find out which ' +
        'one is in use, or stop what is running — in any wording. Do not merely describe these ' +
        'actions in a reply; call the tool. The user is on a phone and cannot see the desktop ' +
        'session list. ' +
        // The channel announces a move itself, and its words are the only ones that reach the chat
        // after a switch. An agent summary on top of that is a second, redundant message. The same goes
        // for a failure, and there it matters more: the log shows the tool returning `ok: false` and the
        // agent then telling the user the switch had worked.
        'Switching and creating are announced to the user by the channel — including when they fail — so ' +
        'do not repeat that outcome either way. Never tell the user a switch or a new conversation ' +
        'succeeded; read the result\'s `ok` field and, if it is false, say nothing about it because the ' +
        'channel has already told them what went wrong. ' +
        // The default list is deliberately short, so the user has to be told the rest exists and how to
        // reach it — otherwise they never learn that conversations from other projects are switchable.
        'The list shows this channel\'s own conversations by default and reports how many others exist ' +
        'in other workspaces; when the user asks to see those as well, call list again with ' +
        'target "all". Any conversation in the full list can be switched to, whichever workspace it is in.';
    if (requireConfirmation) {
        return (`${base} IMPORTANT: before acting, state what you are about to do and wait for the user to ` +
            'agree; only then call this tool. The exception is action "list", which changes nothing and ' +
            'may be called straight away.');
    }
    return `${base} The user has turned confirmation off, so act on the request directly.`;
}
/**
 * The message that tells the user a session operation actually happened.
 *
 * Written by the channel rather than the agent because it is the one thing the user must see: after
 * it, their next message goes somewhere else. Relying on the agent to mention it produced silence
 * in practice, and the agent's words would be posted to the session the chat just left.
 *
 * The title comes from the binding rather than from what the user typed, because they usually give
 * a number («换 2») and a number is not what they need to see confirmed.
 *
 * @param action - `switch` or `new`.
 * @param resolvedTitle - Title the conversation is now on.
 * @returns The message to send.
 */
function switchConfirmation(action, resolvedTitle) {
    const title = resolvedTitle.trim();
    if (action === 'new') {
        return title === ''
            ? '已新建对话，从现在起你的消息发到这里。'
            : `已新建对话「${title}」，从现在起你的消息发到这里。`;
    }
    return title === '' ? '已切换对话。' : `已切换到「${title}」。`;
}
/**
 * The message that tells the user a session operation did **not** happen.
 *
 * Sent for the same reason as the confirmation, and needed more urgently: without it the agent is
 * free to report a move it never made, because a failed switch is the one outcome where nothing in
 * the WeChat chat changes and the user has no way to tell.
 *
 * @param action - `switch` or `new`.
 * @param target - What the user asked for, so the message names it back.
 * @param reason - The router's own explanation, whose first line is what the user should see.
 * @returns The message to send.
 */
function switchFailure(action, target, reason) {
    const headline = reason.split('\n')[0]?.trim() ?? '';
    const what = action === 'switch'
        ? target === undefined || target === ''
            ? '切换对话'
            : `切换到「${target}」`
        : '新建对话';
    return `${what}没有成功。${headline}\n\n发「/list」看清单，直接回数字也能切。`;
}
/**
 * Render the session rows the way the agent should present them.
 *
 * Every row goes through the core's own renderer, so what the channel sends for a spoken request is
 * byte-for-byte the same shape as what `/list` prints for a typed one — one implementation, two
 * callers, no third format for the user to reconcile.
 *
 * @param sessions - Rows, already numbered.
 * @param currentId - Session the conversation is bound to, marked in the list.
 * @returns A newline-separated table.
 */
function renderTable(sessions, currentId) {
    return sessions
        .map((row, index) => renderSessionRow(row, index, currentId))
        .join('\n\n');
}
/**
 * The name a user knows a workspace by.
 *
 * The store records absolute directories, and a full path in a chat message is noise. The last
 * component is what the desktop sidebar shows, so it is what the user will recognise.
 *
 * @param path - Working directory recorded for a session.
 * @returns Its final path component, or the path itself when there is nothing to trim.
 */
function workspaceLabel(path) {
    const parts = path.split(/[\\/]+/).filter((part) => part !== '');
    return parts.at(-1) ?? path;
}
/** A state with nothing stored, so defaults can be resolved without reading the disk. */
const EMPTY_STATE = {
    version: 1,
    accounts: {},
    syncBufs: {},
    contextTokens: {},
    bindings: {},
    sentMessages: {},
};
/**
 * How long any non-text message waits for a follow-up.
 *
 * Every attachment — photo, file, voice, video — opens this window instead of being
 * prompted immediately, whether or not it came with a caption. People send the thing and
 * then say what to do with it; acting on the attachment first would turn one request into
 * two prompts and two answers. The window is short on purpose, since an attachment sent
 * with nothing after it still needs an answer.
 */
const ATTACHMENT_MERGE_WINDOW_MS = 10_000;
/**
 * Write one downloaded attachment and return its absolute path.
 *
 * The name is prefixed with a random fragment because WeChat file names and
 * synthesised image names collide constantly, and silently overwriting a user's
 * earlier attachment is worse than an ugly file name.
 */
function storeMedia(home, media) {
    const dir = join(home, WORKSPACE_DIR_NAME, MEDIA_DIR_NAME);
    mkdirSync(dir, { recursive: true });
    const safe = media.fileName.replace(/[^\w.-]+/g, '_').slice(-80);
    const path = join(dir, `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}-${safe}`);
    writeFileSync(path, media.data);
    return path;
}
/**
 * Read a session id off a tool's calling agent.
 *
 * The agent object is host-owned, so the id is read defensively rather than typed.
 *
 * @param agent - `exec.agent` from a tool invocation.
 * @returns The session id, or undefined when the shape is not what we expect.
 */
function sessionIdOf(agent) {
    if (typeof agent !== 'object' || agent === null)
        return undefined;
    const candidate = agent.session?.id;
    return typeof candidate === 'string' ? candidate : undefined;
}
/**
 * Sender per kind: each item type has its own shape on the wire.
 *
 * Declared here rather than in `media-kind.ts` because it needs the sender functions, which
 * would drag the whole media layer into a module that is otherwise pure mapping.
 */
const SENDER_BY_KIND = {
    image: sendImage,
    video: sendVideo,
    file: sendFile,
};
/**
 * One line describing an attachment for the agent, including where it landed.
 *
 * Voice gets two extras that decide whether the agent needs to open the file at all: the
 * service's own transcript, and the decoded length. A transcript means the question can be
 * answered without touching the audio.
 */
function describeMedia(media, path) {
    const size = media.data.length;
    const readable = size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;
    const kind = { image: '图片', file: '文件', voice: '语音', video: '视频' }[media.kind];
    const parts = [`[${kind}] ${path} (${readable})`];
    if (media.durationMs !== undefined) {
        parts.push(`时长：${(media.durationMs / 1000).toFixed(1)} 秒`);
    }
    // Where the audio could not be transcoded the extension says so, and the agent should not
    // be left guessing why the file will not open.
    if (media.kind === 'voice' && media.contentType === 'audio/silk') {
        parts.push('（未能转码为 WAV，仍是原始 SILK）');
    }
    if (media.transcript !== undefined && media.transcript !== '') {
        parts.push(`服务端转写：${media.transcript}`);
    }
    return parts.join('\n');
}
/**
 * The whole channel at runtime: accounts, monitors, routing, and the outbound buffer.
 */
class WechatRuntime {
    #ctx;
    #store;
    /** Path of the state file, kept for the one synchronous settings read. */
    #stateFilePath;
    #router;
    #botAgent;
    #workspace;
    #home;
    #send;
    /** One monitor per account, plus its abort controller. */
    #monitors = new Map();
    /** The running login handshake, if any. */
    #loginTask;
    /** Buffered assistant text per session, plus the conversation it belongs to. */
    #replies = new Map();
    /** Recent errors, surfaced in the settings page. */
    #errors = [];
    /** Non-text messages awaiting an instruction, keyed by conversation. */
    #pending = new Map();
    /**
     * Conversations currently showing "typing…", with the timers that keep it up.
     *
     * Keyed by conversation so a second message in the same chat does not start a second refresh loop,
     * and cleared by the reply rather than by the inbound handler — see {@link #startTyping}.
     */
    #typing = new Map();
    /**
     * Interactions waiting on a WeChat reply, keyed by conversation.
     *
     * A permission prompt or a multiple-choice question is normally answered in the desktop's
     * conversation pane. Someone whose only device is the phone never sees that pane, and the
     * harness's own answerer fails closed, so the turn would stall. These entries let the channel
     * answer on their behalf: the prompt goes out over WeChat and the next reply settles it.
     */
    #interactions = new Map();
    /**
     * Tool calls already announced, keyed `sessionId\u0000callId`.
     *
     * A tool-call-delta arrives once per argument fragment, so without this the card would be
     * re-sent for every fragment of the same call.
     */
    #announcedTools = new Set();
    /** Running tool calls, keyed the same way, so the result card can name the tool. */
    #runningTools = new Map();
    /** Observations already written to the log, bucketed so each distinct value logs once. */
    #seenShapes = new Map();
    /**
     * Cached settings, so the synchronous assistant-stream path can read them.
     *
     * `undefined` means "not read yet"; {@link saveSettings} replaces it.
     */
    #settingsCache;
    #needsLogin = false;
    /** Resolved Workspace id, cached once the registry answers. */
    #workspaceId;
    /**
     * Disposer for the `session_control` registration.
     *
     * Held so the tool can be re-registered when the confirmation setting changes: the registry
     * takes the description by value, so a stale description would leave the setting inert.
     */
    #sessionToolDisposer;
    /** Set once the plugin is torn down, so a late async registration does not resurrect a tool. */
    #disposed = false;
    constructor(ctx, options) {
        this.#ctx = ctx;
        this.#botAgent = options.botAgent;
        this.#workspace = options.workspace;
        this.#home = options.home;
        this.#send =
            options.send ??
                (async ({ account, to, text, contextToken }) => await sendText({
                    account,
                    to,
                    text,
                    ...(contextToken === undefined ? {} : { contextToken }),
                }));
        this.#store = new StateStore(options.stateFile);
        this.#stateFilePath = options.stateFile;
        const bindings = {
            load: async () => (await this.#store.read()).bindings,
            save: async (next) => {
                await this.#store.update((state) => {
                    state.bindings = next;
                });
            },
        };
        this.#router = new SessionRouter({ gateway: this.#gateway(), store: bindings });
    }
    /** Read the persisted state. */
    state() {
        return this.#store.read();
    }
    /** Whether the channel is armed to reconnect on boot. */
    async enabled() {
        return (await this.#store.read()).autoStart === true;
    }
    /** Current status for the settings page. */
    async status() {
        const state = await this.#store.read();
        return {
            enabled: state.autoStart === true,
            accounts: Object.values(state.accounts).map((account) => ({
                accountId: account.accountId,
                ...(account.userId === undefined ? {} : { userId: account.userId }),
                polling: this.#monitors.has(account.accountId),
            })),
            needsLogin: this.#needsLogin,
            errors: [...this.#errors].slice(-10),
            diagnostics: {
                logPath: join(this.#home, 'wechat', BOOT_LOG_NAME),
                statePath: this.#store.file,
                workspace: join(this.#home, WORKSPACE_DIR_NAME),
                logTail: this.#bootLogTail(),
            },
        };
    }
    /**
     * Last lines of the boot log, oldest first.
     *
     * Read on demand and bounded: the file grows without limit, and the settings page only ever
     * shows the end of it.
     */
    #bootLogTail(limit = 200) {
        try {
            const text = readFileSync(join(this.#home, 'wechat', BOOT_LOG_NAME), 'utf8');
            return text.split(/\r?\n/).filter((line) => line !== '').slice(-limit);
        }
        catch {
            // A missing log is normal on a fresh install, not an error worth surfacing.
            return [];
        }
    }
    /** Every binding that is still usable, plus the accounts it belongs to. */
    async bindings() {
        return Object.values((await this.#store.read()).bindings);
    }
    /**
     * Perform a session action on behalf of the agent.
     *
     * This is the whole of the natural-language path. An earlier attempt recognised phrasings with
     * regular expressions and recognised almost nothing — «换个对话», «刚才那个», «切到第二个» all
     * missed — because the set of ways a person can ask is not enumerable. The agent reads the
     * message anyway and does understand it, so the judgement is delegated to it and the channel
     * only has to carry the action out.
     *
     * Every action is executed through the router's own command path, so there is one implementation
     * of each and the typed and spoken routes cannot drift apart.
     *
     * @param callerSessionId - Session the calling agent is in, which identifies the conversation.
     * @param action - What to do.
     * @param target - Session to switch to, when the action needs one.
     * @returns A result the agent can report, or a reason it could not be done.
     */
    async controlSession(callerSessionId, action, target) {
        const conversationId = await this.#conversationForAgentSession(callerSessionId);
        if (conversationId === undefined) {
            return {
                ok: false,
                detail: '这个会话没有绑定任何微信对话，无法操作。',
                sessions: [],
                otherWorkspaces: 0,
                otherNames: [],
            };
        }
        const binding = (await this.#store.read()).bindings[conversationId];
        if (binding === undefined) {
            return {
                ok: false,
                detail: '这个会话没有绑定任何微信对话，无法操作。',
                sessions: [],
                otherWorkspaces: 0,
                otherNames: [],
            };
        }
        const text = action === 'switch'
            ? `/switch ${target ?? ''}`
            : action === 'new' && target !== undefined && target !== ''
                ? `/new ${target}`
                : `/${action}`;
        const result = await this.#router.route({
            conversationId,
            accountId: binding.accountId,
            peerId: binding.peerId,
            text,
        });
        if (result.kind !== 'reply') {
            return {
                ok: false,
                detail: `不支持的操作：${action}`,
                sessions: [],
                otherWorkspaces: 0,
                otherNames: [],
            };
        }
        const includeAll = target === 'all';
        const table = await this.#sessionTable(conversationId, includeAll);
        const { sessions, otherWorkspaces, otherNames } = table;
        // A switch to something unknown answers with guidance rather than throwing, so the text has to
        // be read rather than assumed to mean success — otherwise the agent would report a move that
        // never happened.
        const failed = /找不到|未知指令/.test(result.text);
        /*
         * Every outcome is announced by the channel, including the failures.
         *
         * A success has to be announced because the agent's words would be posted to the session the
         * chat has just left, which no longer answers for it. A failure has to be announced for a worse
         * reason: the log shows the tool returning `ok: false` and the agent then telling the user
         * 「已切过去了，直接说你想问的就行」 — a claim about a move that never happened, which the user
         * only discovers when their next message lands in the old conversation.
         */
        if (action === 'switch' || action === 'new') {
            if (failed) {
                await this.#notify(conversationId, switchFailure(action, target, result.text));
            }
            else {
                const after = (await this.#store.read()).bindings[conversationId];
                await this.#notify(conversationId, switchConfirmation(action, after?.title ?? ''));
            }
        }
        if (failed) {
            return {
                ok: false,
                // Stated as done, because it was: the user has been told directly, and a retelling can only
                // contradict what they already read.
                detail: `切换失败，已直接告诉用户。原因：${result.text.split('\n')[0] ?? ''}`,
                sessions,
                otherWorkspaces,
                otherNames,
            };
        }
        /*
         * A listing is sent by the channel itself, exactly as a switch confirmation is.
         *
         * The log showed what leaving it to the agent costs: the tool ran, the rows came back, and the
         * agent answered 「已为你列出对话列表，请看上面的消息」 — pointing at a message that never
         * existed, because a tool result is only ever shown to the agent. It later produced a list of its
         * own, in its own format, without the other workspaces and without the numbering the user is
         * meant to reply with.
         *
         * So the channel sends it, and the agent is told not to repeat it. Each row is rendered by the
         * same core helper `/list` uses, so the typed and spoken routes cannot show different things.
         */
        if (action === 'list' || action === 'current') {
            const currentId = sessions.find((row) => row.current)?.sessionId;
            const body = sessions.length === 0
                ? '还没有其他对话。'
                : [
                    includeAll
                        ? `共 ${String(sessions.length)} 个对话（含其它工作区）：`
                        : `共 ${String(sessions.length + otherWorkspaces)} 个对话${otherNames.length === 0 ? '' : `（这里显示 ${String(sessions.length)} 个）`}：`,
                    '',
                    renderTable(sessions, currentId),
                    otherNames.length === 0
                        ? ''
                        : `\n另有 ${String(otherWorkspaces)} 个对话在别的工作区（${otherNames.join('、')}）。说「看全部对话」就能一起看，也可以直接切过去。`,
                    '',
                    '回复数字即可切换，例如「3」。',
                ]
                    .filter((part) => part !== '')
                    .join('\n');
            await this.#notify(conversationId, body);
            return {
                ok: true,
                // The agent gets told what happened, not the list itself: repeating it would double every
                // request, and paraphrasing it is what produced a list the user could not act on.
                detail: `列表已直接发给用户（共 ${String(sessions.length)} 个对话）。不要重复这份列表。`,
                sessions,
                otherWorkspaces,
                otherNames,
            };
        }
        return { ok: true, detail: result.text, sessions, otherWorkspaces, otherNames };
    }
    /**
     * Send one message to a conversation, on the channel's own behalf.
     *
     * Used where the user must be told something regardless of what the agent chooses to say. Failure
     * is recorded, not thrown: a missed confirmation must not fail the action it was confirming.
     *
     * @param conversationId - Conversation to notify.
     * @param text - Message body.
     */
    async #notify(conversationId, text) {
        const state = await this.#store.read();
        const binding = state.bindings[conversationId];
        if (binding === undefined)
            return;
        const account = state.accounts[binding.accountId];
        if (account === undefined)
            return;
        try {
            await this.#send({
                account,
                to: binding.peerId,
                text,
            });
            this.#recordBoot(`session notice sent: ${text.split('\n')[0] ?? ''}`);
        }
        catch (error) {
            this.#recordError(`发送会话通知失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * The sessions a conversation can move between, numbered the way the list presents them.
     *
     * The agent gets this alongside every result so it can offer the choice it just described
     * without a second call.
     *
     * @param conversationId - Conversation whose current session is marked.
     * @param includeAll - Whether to include sessions from other workspaces.
     * @returns Rows ready to relay, how many were held back, and where those live.
     */
    async #sessionTable(conversationId, includeAll) {
        const state = await this.#store.read();
        const current = state.bindings[conversationId];
        const currentId = current?.sessionId ?? '';
        const listed = await this.#gateway().listSessions();
        const own = [];
        const others = [];
        const otherPaths = new Set();
        for (const session of listed) {
            // A session with no recorded directory, or one the store does not know, is treated as this
            // chat's own: it is the only workspace this conversation can vouch for.
            const path = await storedSessionWorkspace(this.#home, session.sessionId);
            if (path === undefined || isSameWorkspace(path, this.#workspace))
                own.push(session);
            else {
                others.push(session);
                otherPaths.add(path);
            }
        }
        if (listed.length === 0) {
            // The host reports nothing, but this conversation is plainly on a session. Offering that one
            // is what keeps "list my conversations" from answering with silence — which is exactly how
            // the request failed in practice.
            return {
                sessions: current === undefined
                    ? []
                    : [
                        {
                            index: 1,
                            sessionId: current.sessionId,
                            title: current.title.trim() || '(无标题)',
                            updatedAt: current.lastUsedAt,
                            current: true,
                        },
                    ],
                otherWorkspaces: 0,
                otherNames: [],
            };
        }
        // `all` shows everything; otherwise the wider list is only counted, so the default stays short
        // and the user is told the rest is there.
        const chosen = includeAll ? [...own, ...others] : own;
        // Newest first, so the cut-off at the display limit drops the oldest — an older conversation
        // shown but unreachable by number would be worse than one not shown at all.
        const ordered = [...chosen].sort((a, b) => b.updatedAt - a.updatedAt);
        return {
            sessions: ordered.map((session, index) => ({
                index: index + 1,
                sessionId: session.sessionId,
                title: session.title.trim() || '(无标题)',
                updatedAt: session.updatedAt,
                current: session.sessionId === currentId,
            })),
            otherWorkspaces: includeAll ? 0 : others.length,
            // Folder names, because they are what the user recognises from the desktop. Named rather than
            // counted so "which other lists are there" needs no second question.
            otherNames: includeAll ? [] : [...otherPaths].map(workspaceLabel).sort(),
        };
    }
    /**
     * Tuned settings plus the defaults they fall back to, for the settings page.
     *
     * Both are sent whole: the page shows the effective value of every setting and offers a reset
     * to the defaults, so it needs to know both.
     */
    async settingsForPage() {
        return {
            settings: await this.#settings(),
            defaults: resolveSettings(EMPTY_STATE),
        };
    }
    /**
     * Disconnect one WeChat account from this machine.
     *
     * Stops its poll and **forgets its credentials**, which is what makes this different from
     * switching the channel off: the channel switch only stops listening and can be turned back on,
     * while this ends the link and requires scanning again to restore it.
     *
     * The account's conversations are forgotten too. Their DSH sessions are untouched — the session
     * is the work, and this only ends the WeChat side of it — so nothing anyone said is lost.
     *
     * @param accountId - Account to disconnect.
     * @returns Whether an account was found and removed.
     */
    async disconnect(accountId) {
        const running = this.#monitors.get(accountId);
        if (running !== undefined) {
            running.abort.abort();
            void running.monitor.notifyStop();
            this.#monitors.delete(accountId);
        }
        let found = false;
        await this.#store.update((state) => {
            if (state.accounts[accountId] === undefined)
                return;
            found = true;
            delete state.accounts[accountId];
            delete state.syncBufs[accountId];
            delete state.contextTokens[accountId];
            delete state.sentMessages[accountId];
            for (const [key, binding] of Object.entries(state.bindings)) {
                if (binding.accountId === accountId)
                    delete state.bindings[key];
            }
            // Nothing left to reconnect to, so the switch would otherwise claim a channel that is gone.
            if (Object.keys(state.accounts).length === 0)
                state.autoStart = false;
        });
        if (found)
            this.#recordBoot(`disconnected account ${accountId}`);
        return found;
    }
    /**
     * Per-account poll detail.
     *
     * Distinguishes an account whose poll is live from one whose monitor exists but has stopped —
     * the summary status cannot tell those apart, and with several accounts bound that is the
     * difference between "still working" and "silently dead".
     */
    async accountDetail() {
        const state = await this.#store.read();
        return Object.values(state.accounts).map((account) => ({
            accountId: account.accountId,
            ...(account.userId === undefined ? {} : { userId: account.userId }),
            polling: this.#monitors.has(account.accountId),
            credentialsUsable: !this.#needsLogin,
            bindings: Object.values(state.bindings).filter((binding) => binding.accountId === account.accountId).length,
        }));
    }
    /** Current login task state. */
    loginState() {
        return this.#loginTask?.state ?? { phase: 'idle' };
    }
    /** Turn the channel on or off and persist the choice. */
    async setEnabled(enabled) {
        await this.#store.update((state) => {
            state.autoStart = enabled;
        });
        if (enabled)
            await this.start();
        else
            await this.stop();
    }
    /** Start a monitor for every stored account. Safe to call repeatedly. */
    async start() {
        const state = await this.#store.read();
        const accounts = Object.values(state.accounts);
        if (accounts.length > 0)
            this.#needsLogin = false;
        for (const account of accounts)
            await this.#startMonitor(account);
    }
    /** Stop monitoring and tell the service we are going away. */
    async stop() {
        for (const { monitor, abort } of this.#monitors.values()) {
            abort.abort();
            void monitor.notifyStop();
        }
        this.#monitors.clear();
    }
    /** Tear everything down for plugin disposal. */
    async halt() {
        for (const entry of this.#replies.values())
            clearTimeout(entry.timer);
        this.#replies.clear();
        // Parked attachments hold timers; a reload must not leave one to fire against a
        // disposed runtime.
        this.#clearParked();
        this.#loginTask?.controller.abort();
        this.#loginTask = undefined;
        await this.stop();
    }
    /**
     * Feed one inbound message through the channel's real pipeline.
     *
     * Exposed so tests — and any future in-process source of messages — can drive the
     * same path a WeChat delivery takes, without standing up a long poll.
     */
    async ingest(message) {
        await this.#handleInbound(message);
    }
    /**
     * Run one login handshake to completion, driving the generator.
     *
     * The task outlives the HTTP request that started it, so the user can reload the
     * settings page — or close it — while still on the phone confirming the scan.
     */
    async startLogin() {
        if (this.#loginTask !== undefined)
            return this.#loginTask.state;
        const state = await this.#store.read();
        // Passing the tokens we already hold is what makes the server answer
        // `binded_redirect` instead of re-binding the account from under the user.
        const existingTokens = Object.values(state.accounts)
            .map((account) => account.token)
            .filter((token) => token.length > 0);
        const controller = new AbortController();
        const task = {
            controller,
            state: { phase: 'running', step: '正在获取二维码…' },
        };
        this.#loginTask = task;
        void (async () => {
            try {
                const iterator = loginHandshake({ existingTokens, reuseExisting: 'adopt' }, controller.signal);
                let input;
                for (;;) {
                    const next = await iterator.next(input);
                    if (next.done === true) {
                        const result = next.value;
                        if (result.account !== undefined) {
                            await this.#adoptAccount(result.account);
                            task.state = {
                                phase: 'succeeded',
                                step: '已连接微信',
                                accountId: result.account.accountId,
                            };
                        }
                        else if (result.alreadyBound) {
                            task.state = { phase: 'already-bound', step: '该微信账号此前已绑定，沿用原有凭据' };
                        }
                        else {
                            task.state = {
                                phase: 'failed',
                                step: '登录未完成',
                                error: result.reason ?? '未知原因',
                            };
                        }
                        return;
                    }
                    input = await this.#applyLoginEvent(task.state, next.value);
                }
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                this.#recordError(`登录失败: ${message}`);
                task.state = { phase: 'failed', step: '登录失败', error: message };
            }
            finally {
                if (this.#loginTask === task) {
                    // Keep the terminal state readable, then allow a new attempt.
                    const timer = setTimeout(() => {
                        if (this.#loginTask === task)
                            this.#loginTask = undefined;
                    }, LOGIN_RESULT_TTL_MS);
                    timer.unref?.();
                }
            }
        })();
        return task.state;
    }
    /** Answer a verification-code prompt. Returns false when nothing is waiting. */
    provideVerifyCode(code) {
        const task = this.#loginTask;
        if (task?.answer === undefined)
            return false;
        const answer = task.answer;
        task.answer = undefined;
        task.state = { ...task.state, awaitingVerifyCode: false, step: '正在校验验证码…' };
        answer(code);
        return true;
    }
    /** Abandon the running login task. */
    cancelLogin() {
        this.#loginTask?.controller.abort();
        this.#loginTask = undefined;
    }
    /** Apply one handshake event to the visible state, returning generator input. */
    async #applyLoginEvent(state, event) {
        switch (event.kind) {
            case 'qr': {
                const qrDataUrl = await toDataUrl(event.qrUrl);
                Object.assign(state, {
                    phase: 'running',
                    step: event.refreshed ? '二维码已刷新，请重新扫码' : '请用手机微信扫码',
                    qrUrl: event.qrUrl,
                    ...(qrDataUrl === undefined ? {} : { qrDataUrl }),
                    awaitingVerifyCode: false,
                    refreshed: event.refreshed ? (state.refreshed ?? 0) + 1 : 0,
                });
                return undefined;
            }
            case 'scanned':
                Object.assign(state, { step: '已扫码，请在手机上确认' });
                return undefined;
            case 'redirected':
                Object.assign(state, { step: `服务端要求切换机房：${event.host}` });
                return undefined;
            case 'expired':
                Object.assign(state, {
                    step: event.willRetry ? '二维码已过期，正在刷新…' : '二维码多次过期',
                });
                return undefined;
            case 'failed':
                Object.assign(state, { phase: 'failed', step: '登录失败', error: event.reason });
                return undefined;
            case 'already-bound':
                Object.assign(state, { phase: 'already-bound', step: '该微信账号此前已绑定' });
                return undefined;
            case 'confirmed':
                // The terminal state is written by the caller that observes `done`.
                return undefined;
            case 'verifycode-required': {
                Object.assign(state, { step: '服务端要求输入配对验证码', awaitingVerifyCode: true });
                const task = this.#loginTask;
                if (task === undefined)
                    return undefined;
                return await new Promise((resolve) => {
                    task.answer = resolve;
                });
            }
            default:
                return undefined;
        }
    }
    /** Persist a freshly issued account and start polling it. */
    async #adoptAccount(account) {
        await this.#store.update((state) => {
            state.accounts[account.accountId] = account;
            // A freshly issued token supersedes any cursor from a previous binding.
            delete state.syncBufs[account.accountId];
        });
        this.#needsLogin = false;
        await this.#startMonitor(account);
    }
    /** Start the long poll for one account, unless it is already running. */
    async #startMonitor(account) {
        if (this.#monitors.has(account.accountId))
            return;
        const monitor = new ChannelMonitor({
            account,
            botAgent: this.#botAgent,
            onMessage: async (message) => {
                await this.#handleInbound(message);
            },
            onSyncBuf: async (buf) => {
                await this.#store.update((state) => {
                    state.syncBufs[account.accountId] = buf;
                });
            },
            onError: (error) => {
                this.#recordError(error instanceof Error ? error.message : String(error));
            },
            onStop: (reason) => {
                this.#monitors.delete(account.accountId);
                if (reason === 'stale-token') {
                    this.#needsLogin = true;
                    this.#recordError(`账号 ${account.accountId} 的 token 已失效，需要重新扫码`);
                }
            },
        });
        // Restore the persisted cursor before the first poll so nothing is replayed.
        const state = await this.#store.read();
        const saved = state.syncBufs[account.accountId];
        if (saved)
            monitor.restoreSyncBuf(saved);
        const abort = new AbortController();
        this.#monitors.set(account.accountId, { monitor, abort });
        void monitor.run(abort.signal);
    }
    /**
     * Current tuned settings, with defaults filled in.
     *
     * Cached, and invalidated by {@link saveSettings}. The assistant-stream handler needs them
     * synchronously: awaiting a store read inside a frame handler opens an async gap between two
     * frames of the same answer, and the second frame then finds no buffered entry and starts a
     * fresh one — which silently drops the first half of every reply.
     */
    async #settings() {
        this.#settingsCache ??= resolveSettings(await this.#store.read());
        return this.#settingsCache;
    }
    /** Settings for a synchronous caller, falling back to the stored defaults. */
    #settingsNow() {
        return this.#settingsCache ?? resolveSettings(EMPTY_STATE);
    }
    /**
     * Read the stored settings synchronously.
     *
     * Needed by exactly one caller: the tool registration, which happens during the synchronous
     * `apply` and has to see what the user actually chose. Everything else reads through
     * {@link #settings}, which awaits the store. A missing or unreadable file falls back to the
     * defaults, exactly as a first run would.
     *
     * @returns The effective settings.
     */
    #settingsFromDisk() {
        if (this.#settingsCache !== undefined)
            return this.#settingsCache;
        let settings;
        try {
            const parsed = JSON.parse(readFileSync(this.#stateFilePath, 'utf-8'));
            settings = parsed.settings;
        }
        catch {
            settings = undefined;
        }
        this.#settingsCache = resolveSettings({ ...EMPTY_STATE, settings: settings ?? {} });
        return this.#settingsCache;
    }
    /**
     * Persist a settings patch and refresh the cache.
     *
     * @param patch - Fields to change; absent fields keep their stored value.
     * @returns The settings after the change.
     */
    async saveSettings(patch) {
        let next = this.#settingsNow();
        const before = next.requireConfirmation;
        await this.#store.update((state) => {
            state.settings = { ...(state.settings ?? {}), ...patch };
            next = resolveSettings(state);
        });
        this.#settingsCache = next;
        // The confirmation policy lives in the session tool's description, which the registry copies at
        // registration. Without this the setting would look inert until the next restart.
        if (next.requireConfirmation !== before)
            this.refreshSessionTool();
        return next;
    }
    /** Route one inbound WeChat message. */
    async #handleInbound(message) {
        // Remember the reply token for this conversation before anything can fail.
        if (message.contextToken !== undefined) {
            const token = message.contextToken;
            await this.#store.update((state) => {
                const perAccount = (state.contextTokens[message.accountId] ??= {});
                perAccount[message.conversationId] = token;
            });
        }
        /*
         * A message from the user is the only thing that reopens the reply window, so anything queued
         * while it was closed goes out now — before this message is handled, so the backlog reads as a
         * backlog rather than as answers to the question they just asked.
         */
        await this.#flushPending(message.conversationId);
        const account = await this.#account(message.accountId);
        if (account === undefined)
            return;
        this.#startTyping(message.accountId, message.conversationId, message.peerId);
        let handedOff = false;
        try {
            /*
             * No sender check, because the protocol makes one unnecessary.
             *
             * An iLink bot is bound at provisioning to the single WeChat user who scanned the QR, and the
             * issued bot token embeds that user's id. The service only ever delivers that user's messages —
             * `from_user_id` is always the scanner — and the bot is not a WeChat contact entity: it has no
             * shareable card and nothing to search for. There is no third party who could reach it, so
             * there is no list to keep.
             *
             * This is written down because a stale comment here once claimed an allow list *was* checked.
             * None ever existed, and a security warning was built on top of that claim and shipped in the
             * README for the life of the project. Do not reintroduce either.
             */
            // Record the raw item before touching it. The service's own image item is the only
            // known-renderable sample of this protocol — this plugin is the only implementation,
            // and nothing in the application documents the format — so the field list it uses is
            // the reference an outbound item has to match. Writing it down is what makes that
            // comparison possible at all.
            for (const item of message.media ?? []) {
                // The whole item, not a prefix: `encrypt_query_param` alone runs past 600
                // characters, so any short cap cuts off precisely the fields worth comparing.
                this.#recordBoot(`inbound media item: ${JSON.stringify(item)}`);
            }
            // Record every quoted message, whole. A quote is the one inbound shape whose fields have
            // never been observed here, and what it carries decides the entire cache design: a
            // `message_item` needs no cache at all, an `svr_id` needs ours keyed by the same id
            // shape, and a `partial_text` needs neither. Guessing between those three is what the
            // tool-card detour cost, so the sample comes first this time.
            for (const item of message.raw.item_list ?? []) {
                if (item.ref_msg === undefined)
                    continue;
                this.#recordBoot(`inbound quote: ${JSON.stringify(item.ref_msg)}`);
            }
            const attachments = await this.#fetchAttachments(message);
            // Read once per message, so every decision below sees one consistent set of settings.
            const settings = await this.#settings();
            // A pending permission prompt or question owns the next reply. It is checked before
            // anything else, because "1" or "允许" answers the prompt the user was just shown — routed
            // as a request it would confuse the agent and leave the interaction stuck forever.
            if (attachments.length === 0 && (await this.#settleInteraction(message)))
                return;
            // A non-text message never gets an immediate answer. It is parked, and this returns
            // without replying: the user is about to say what they want done with it. Only after the
            // merge window does the batch go through on its own.
            if (attachments.length > 0) {
                this.#parkAttachments(message, attachments, settings);
                return;
            }
            handedOff = await this.#deliver(message, { media: [], text: message.text, attachments: [] });
        }
        catch (error) {
            this.#recordError(`处理消息失败: ${error instanceof Error ? error.message : String(error)}`);
            await this.#reply(account, message.conversationId, message.peerId, '处理这条消息时出错了。');
        }
        finally {
            /*
             * Only cleared when the turn did *not* go to the agent.
             *
             * A message handed to the agent is still being worked on when this returns — `#deliver`
             * submits and comes back — so clearing here would blink the indicator off while the agent is
             * busy, which is the opposite of what it is for. In that case `#reply` clears it, when the
             * answer actually goes out. Anything else (a parked attachment, a command answered locally)
             * is finished by the time this returns, so it is cleared here.
             */
            if (!handedOff)
                this.#stopTyping(message.conversationId);
        }
    }
    /**
     * Show "typing…" for a conversation, and keep it showing until the reply goes out.
     *
     * Re-sent on an interval because the indicator is short-lived on the client: sent once, it
     * disappears long before a real task finishes, which is the case this exists for. The interval is
     * cleared in {@link #stopTyping}, and bounded here so a reply that never comes cannot leave the
     * channel re-sending forever.
     *
     * @param accountId - Account the message came in on.
     * @param conversationId - Conversation to key the state by.
     * @param peerId - Peer to show it to.
     */
    #startTyping(accountId, conversationId, peerId) {
        const monitor = this.#monitors.get(accountId)?.monitor;
        if (monitor === undefined)
            return;
        if (this.#typing.has(conversationId))
            return;
        const send = () => {
            void monitor.setTyping(peerId, true);
        };
        send();
        const interval = setInterval(send, TYPING_REFRESH_MS);
        // `unref` so a pending indicator never keeps the process alive on shutdown.
        interval.unref?.();
        const cap = setTimeout(() => {
            this.#stopTyping(conversationId);
        }, TYPING_MAX_MS);
        cap.unref?.();
        this.#typing.set(conversationId, { interval, cap, accountId, peerId });
    }
    /**
     * Clear "typing…" for a conversation, if it was showing.
     *
     * @param conversationId - Conversation to clear.
     */
    #stopTyping(conversationId) {
        const state = this.#typing.get(conversationId);
        if (state === undefined)
            return;
        this.#typing.delete(conversationId);
        clearInterval(state.interval);
        clearTimeout(state.cap);
        const monitor = this.#monitors.get(state.accountId)?.monitor;
        void monitor?.setTyping(state.peerId, false);
    }
    /**
     * Park one non-text message and (re)start its window.
     *
     * Nothing is sent yet. Whatever was already parked stays, so a video followed by a photo
     * followed by a file is one batch, not three.
     */
    #parkAttachments(message, attachments, settings) {
        const existing = this.#pending.get(message.conversationId);
        if (existing !== undefined)
            clearTimeout(existing.timer);
        const text = [existing?.text ?? '', message.text]
            .map((part) => part.trim())
            .filter((part) => part !== '')
            .join('\n\n');
        // With auto-reply off the batch waits indefinitely for an instruction. The entry is still
        // recorded, so a later text message folds it in — that is what makes the setting "only
        // answer when I say something" rather than "ignore attachments".
        const timer = settings.autoReplyAttachments
            ? setTimeout(() => {
                // The window closed with no instruction, so hand the attachments over on their own.
                // `#deliver` claims the parked batch itself; deleting it here first would throw the
                // attachments away and send an empty turn.
                void this.#deliver(message, { media: [], text: '', attachments: [] });
            }, settings.mergeWindowMs)
            : undefined;
        timer?.unref?.();
        this.#pending.set(message.conversationId, {
            attachments: [...(existing?.attachments ?? []), ...attachments],
            text,
            timer,
        });
    }
    /**
     * Settle a pending interaction from the user's reply, when one is waiting.
     *
     * @param message - The inbound message.
     * @returns Whether the reply was consumed as an answer.
     */
    async #settleInteraction(message) {
        const pending = this.#interactions.get(message.conversationId);
        if (pending === undefined)
            return false;
        const value = pending.accept(message.text);
        if (value === undefined) {
            // Not an answer to this prompt. The prompt is shown again rather than swallowing the text,
            // so a message on another topic is neither lost nor mistaken for a bad answer.
            pending.reprompt();
            return false;
        }
        this.#interactions.delete(message.conversationId);
        this.#recordBoot(`interaction settled: ${pending.kind}`);
        pending.settle(value);
        return true;
    }
    /**
     * Ask the user a question over WeChat and wait for the answer.
     *
     * The account and peer are passed in rather than looked up from the conversation's binding. The
     * session-control tool runs inside a session that may have no binding yet — it can be asked to
     * create the first one — so requiring a lookup here would fail exactly when the feature is
     * needed.
     *
     * @param conversationId - Conversation to ask.
     * @param account - Account to reply from.
     * @param peerId - Recipient of the question.
     * @param body - Prompt text.
     * @param kind - Interaction kind, for logging.
     * @param parse - Reads the reply, returning undefined when it is not an answer.
     * @param signal - Aborts when the harness withdraws the request.
     * @returns The parsed answer, or undefined when the request was withdrawn first.
     */
    async #ask(conversationId, account, peerId, body, kind, parse, signal) {
        const settled = Promise.withResolvers();
        // A later prompt in the same conversation replaces this one: the user is looking at the most
        // recent question, and holding two would make an ambiguous reply impossible to attribute.
        const previous = this.#interactions.get(conversationId);
        if (previous !== undefined) {
            this.#interactions.delete(conversationId);
            previous.settle(undefined);
        }
        this.#interactions.set(conversationId, {
            kind,
            accept: parse,
            settle: settled.resolve,
            reprompt: () => {
                void this.#reply(account, conversationId, peerId, `请回复上一条提示。\n\n${body}`);
            },
        });
        const onAbort = () => {
            this.#interactions.delete(conversationId);
            settled.resolve(undefined);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        try {
            await this.#reply(account, conversationId, peerId, body);
            this.#recordBoot(`interaction asked: ${kind} -> ${peerId}`);
            return await settled.promise;
        }
        finally {
            signal?.removeEventListener('abort', onAbort);
            // Only clear our own entry: a newer prompt may already have replaced it.
            const current = this.#interactions.get(conversationId);
            if (current?.settle === settled.resolve) {
                this.#interactions.delete(conversationId);
            }
        }
    }
    /**
     * Claim permission prompts for conversations bound to WeChat.
     *
     * Unbound conversations delegate, so the desktop pane answers as before.
     *
     * @returns The listener for `ctx.on('approval/request', ...)`.
     */
    approvalListener() {
        return async (request, next) => {
            const record = (request ?? {});
            const sessionId = sessionIdOf(record.agent);
            const conversationId = await this.#conversationForAgentSession(sessionId);
            // Recorded either way. An answerer that is never invoked and one that abstains look
            // identical from the phone — both leave the prompt on the desktop — so the decision is
            // written where the next diagnosis can find it.
            this.#recordBoot(`approval seen: tool=${String(record.toolName)} session=${sessionId ?? '(none)'} ` +
                `${conversationId === undefined ? 'not-a-wechat-session -> delegate' : 'claiming'}`);
            if (conversationId === undefined)
                return await next();
            const target = await this.#askTarget(conversationId);
            if (target === undefined)
                return await next();
            const answer = await this.#ask(conversationId, target.account, target.peerId, presentApproval(record).body, 'approval', parseApprovalReply, record.signal);
            // Withdrawn or unanswerable: hand it back rather than guessing. Guessing on a permission
            // prompt means granting something the user never agreed to.
            if (answer === undefined)
                return await next();
            return answer;
        };
    }
    /**
     * Claim structured questions for conversations bound to WeChat.
     *
     * @returns The listener for `ctx.on('user-questions/request', ...)`.
     */
    questionListener() {
        return async (request, next) => {
            const record = (request ?? {});
            const questions = record.questions;
            if (!Array.isArray(questions) || questions.length === 0)
                return await next();
            const sessionId = sessionIdOf(record.agent);
            const conversationId = await this.#conversationForAgentSession(sessionId);
            this.#recordBoot(`question seen: count=${String(questions.length)} session=${sessionId ?? '(none)'} ` +
                `${conversationId === undefined ? 'not-a-wechat-session -> delegate' : 'claiming'}`);
            if (conversationId === undefined)
                return await next();
            const target = await this.#askTarget(conversationId);
            if (target === undefined)
                return await next();
            const answer = await this.#ask(conversationId, target.account, target.peerId, presentQuestions(questions).body, 'question', (reply) => parseQuestionReply(questions, reply), record.signal);
            if (answer === undefined)
                return await next();
            return answer;
        };
    }
    /**
     * Resolve where a question for a conversation should be sent.
     *
     * Used by the listeners that are handed a session rather than a message, so they have to look the
     * conversation up. A confirmation does not need this: it is asked from the inbound message,
     * which already carries both.
     *
     * @param conversationId - Conversation to resolve.
     * @returns The account and peer, or undefined when the conversation is not bound.
     */
    async #askTarget(conversationId) {
        const state = await this.#store.read();
        const binding = state.bindings[conversationId];
        if (binding === undefined)
            return undefined;
        const account = state.accounts[binding.accountId];
        if (account === undefined)
            return undefined;
        return { account, peerId: binding.peerId };
    }
    /**
     * The conversation a session may speak for.
     *
     * Only the session a conversation is **currently** bound to may act on its behalf.
     *
     * This used to also accept any session a conversation had ever used, through a `sessionOwners`
     * map. That map is gone, and the reason is worth keeping: it made a conversation's *former*
     * session able to send messages, ask questions and switch sessions for the rest of time. After
     * `/new`, the development session this plugin was written in stayed an owner of the WeChat
     * conversation, so a question asked from it — through a different harness session entirely —
     * arrived on the user's phone.
     *
     * A bookkeeping trail is not a grant of authority, and the two were the same map.
     *
     * @param sessionId - Session to look up, if known.
     * @returns The conversation key, when this session is the one bound to it.
     */
    async #conversationForAgentSession(sessionId) {
        if (sessionId === undefined)
            return undefined;
        const state = await this.#store.read();
        const found = Object.values(state.bindings).find((entry) => entry.sessionId === sessionId);
        return found?.conversationId;
    }
    /**
     * Hand one turn to the agent.
     *
     * Any parked attachment is flushed into this call first, so an instruction that arrives
     * moments after a photo reaches the agent once, with both. Passing empty text yields the
     * same shape as waiting out the window — which is why releasing needs no separate path.
     */
    async #deliver(message, incoming) {
        try {
            const parked = this.#claimParked(message.conversationId);
            const attachments = [...parked.attachments, ...incoming.attachments];
            // A quote is resolved first: what the user is replying *to* is context the rest of the
            // message only makes sense against, so it belongs before it.
            const quoted = await this.#resolveQuote(message);
            const text = [parked.text, incoming.text]
                .map((part) => part.trim())
                .filter((part) => part !== '')
                .join('\n\n');
            const account = await this.#account(message.accountId);
            if (account === undefined)
                return false;
            // A command answers locally and never reaches the agent, so an attachment riding along
            // would be dropped without trace. With an attachment the text goes to the agent as an
            // ordinary instruction instead: losing the user's file is worse than ignoring a slash.
            // A command answered in the user's own words is proposed, not performed. Recognition is
            // allowed to be imperfect precisely because this stands between it and any effect.
            if (attachments.length === 0) {
                const routed = await this.#router.route({
                    conversationId: message.conversationId,
                    accountId: message.accountId,
                    peerId: message.peerId,
                    text,
                });
                if (routed.kind === 'reply') {
                    await this.#reply(account, message.conversationId, message.peerId, routed.text);
                    return false;
                }
                await this.#prompt(routed.decision, message, [], quoted);
                return true;
            }
            // Resolve the session the usual way, then hand it the attachments *and* the text
            // together. Empty text is fine here: the router still binds or adopts the session,
            // and the attachments carry the turn on their own.
            const bound = await this.#router.route({
                conversationId: message.conversationId,
                accountId: message.accountId,
                peerId: message.peerId,
                text: '',
            });
            if (bound.kind === 'reply') {
                await this.#reply(account, message.conversationId, message.peerId, bound.text);
                return false;
            }
            await this.#prompt({ ...bound.decision, prompt: text }, message, attachments, quoted);
            return true;
        }
        catch (error) {
            this.#recordError(`处理消息失败: ${error instanceof Error ? error.message : String(error)}`);
            const account = await this.#account(message.accountId);
            if (account !== undefined) {
                await this.#reply(account, message.conversationId, message.peerId, '处理这条消息时出错了。');
            }
            return false;
        }
    }
    /**
     * Claim and clear whatever is parked for a conversation.
     *
     * @param conversationId - Conversation to collect for.
     * @returns The parked attachments and their accumulated caption.
     */
    #claimParked(conversationId) {
        const parked = this.#pending.get(conversationId);
        if (parked === undefined)
            return { attachments: [], text: '' };
        clearTimeout(parked.timer);
        this.#pending.delete(conversationId);
        return { attachments: parked.attachments, text: parked.text };
    }
    /** Drop every parked batch. Called on teardown so no timer outlives the plugin. */
    #clearParked() {
        for (const parked of this.#pending.values())
            clearTimeout(parked.timer);
        this.#pending.clear();
    }
    /**
     * Register the tool the agent uses to send a file back to WeChat.
     *
     * This is what makes outbound media reachable at all. The client could already upload
     * and send an image — the functions existed — but nothing ever called them, so a file
     * the agent produced had no way out of the process and the phone saw nothing.
     *
     * @returns The disposer that unregisters the tool.
     */
    registerTools() {
        const tools = this.#ctx.tools;
        if (tools === undefined) {
            this.#recordError('此组合没有工具服务，agent 无法主动发送文件到微信');
            return () => { };
        }
        const send = tools.register({
            name: 'send_to_wechat',
            description: 'Send a file from this machine to the WeChat conversation that asked for it. Images arrive as photos, videos as playable clips, and everything else as a file attachment, chosen from the path extension. Use this whenever the user asked to see, receive, or be sent a file, image, screenshot, chart, or video. The path must be absolute and may point anywhere on this machine — a file on the Desktop or in a project folder is sent as it is, with no need to copy it anywhere first.',
            parameters: {
                type: 'object',
                properties: {
                    path: {
                        type: 'string',
                        description: 'Absolute path of the file to send.',
                    },
                    caption: {
                        type: 'string',
                        description: 'Optional short message to send before the file.',
                    },
                },
                required: ['path'],
                additionalProperties: false,
            },
            output: {
                // Standard JSON Schema: `required` is a sibling array of property names. The
                // `defineTool` parameter-spec form puts `required: true` inside the property
                // itself, and the registry rejects that shape with a JsonSchemaError.
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: { detail: { type: 'string' } },
                    required: ['detail'],
                },
                render: (args) => [
                    { type: 'text', text: `sent ${String(args.path ?? '')} to WeChat` },
                ],
            },
            execute: async (args, exec) => ({
                detail: await this.#sendFileToWechat(String(args.path ?? ''), args.caption, exec),
            }),
        });
        // The registry stores the description as given, so a change to the confirmation setting has to
        // re-register rather than mutate. Holding the disposer here is what lets `saveSettings` do it.
        const control = tools.register(this.#sessionToolDefinition());
        /*
         * The proactive half. `send_to_wechat` only works for the session the WeChat conversation is
         * bound to, which means the session doing the work usually cannot report its own result: the user
         * asks for something, walks away, and the answer dies with the turn.
         *
         * This tool resolves the *currently bound* conversation from the store instead of from the
         * caller, so any session can deliver to the phone the user is actually holding. It never takes a
         * target argument, so there is nothing an agent can aim wrongly.
         */
        const notify = tools.register({
            name: 'notify_wechat',
            description: 'Push a message, and optionally a file, to the user\'s WeChat. Unlike send_to_wechat this works from any session, including one the WeChat conversation is not currently bound to, which is what makes "tell me when it is done" possible. Always reaches the conversation the user is currently in; there is no way to choose another. Use it to report a finished task, or to send a file the user asked to receive. Keep text short — it is read on a phone.',
            parameters: {
                type: 'object',
                properties: {
                    text: {
                        type: 'string',
                        description: 'The message to send. Short, and written for a phone.',
                    },
                    path: {
                        type: 'string',
                        description: 'Optional absolute path of a file to send after the text. Images arrive as photos, videos as playable clips, everything else as a file attachment.',
                    },
                },
                required: ['text'],
                additionalProperties: false,
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: { detail: { type: 'string' } },
                    required: ['detail'],
                },
                render: (args) => [
                    { type: 'text', text: `notify WeChat${args.path === undefined ? '' : ` with ${String(args.path)}`}` },
                ],
            },
            execute: async (args, exec) => ({
                detail: await this.#notifyWechat(String(args.text ?? ''), args.path, exec),
            }),
        });
        return () => {
            this.#sessionToolDisposer = undefined;
            send();
            control();
            notify();
        };
    }
    /**
     * Deliver a message, and optionally a file, to the bound WeChat conversation.
     *
     * @param text - Message to send. Sent first, so a file arrives with its explanation already there.
     * @param path - Optional absolute path of a file to send after the text.
     * @param exec - Tool execution context, used for cancellation and for the fallback check.
     * @returns A short human-readable outcome.
     */
    async #notifyWechat(text, path, exec) {
        if (text.trim() === '' && typeof path !== 'string') {
            throw new Error('至少要给 text 或 path 其中一个。');
        }
        /*
         * With the setting off, this behaves exactly as `send_to_wechat` does: the caller has to be the
         * bound session. That keeps the older, stricter rule reachable rather than deleting it, so
         * turning the setting off restores the previous security posture instead of only disabling a
         * convenience.
         */
        if (!this.#settingsFromDisk().allowCrossSessionNotify) {
            const own = await this.#conversationForAgent(exec.agent);
            if (own === undefined) {
                throw new Error('这个会话没有绑定微信对话，而「允许其他会话推送到微信」是关闭的。请让用户在设置里打开它，或先在微信里发一条消息。');
            }
            return await this.#deliverTo(own, text, path, exec.signal);
        }
        const bound = await this.#boundConversation();
        if (!bound.ok)
            throw new Error(bound.reason);
        return await this.#deliverTo(bound.target, text, path, exec.signal);
    }
    /**
     * Send the text and then the file, into one already-resolved conversation.
     *
     * Each piece is attempted separately and a refusal queues only the piece that was refused, so a
     * message that arrives before the window closes is not sent twice when the file behind it is held
     * back for later.
     *
     * @param target - Conversation to deliver to.
     * @param text - Message to send; skipped when empty.
     * @param path - File to send; skipped unless it is a string.
     * @param signal - Cancellation from the caller, when there is one.
     * @returns What was sent, for the agent to report.
     */
    async #deliverTo(target, text, path, signal) {
        const file = typeof path === 'string' && path !== '' ? path : undefined;
        if (text.trim() === '' && file === undefined)
            throw new Error('没有可发送的内容。');
        /*
         * Queued as one entry rather than two, because the text is usually the caption for the file: sent
         * separately later, the file would arrive with no explanation. Whatever went out before the
         * refusal is dropped from the entry so it is not repeated.
         */
        let outstandingText = text.trim() === '' ? '' : text;
        let outstandingPath = file;
        const done = [];
        if (outstandingText !== '') {
            if (await this.#sendOrQueue(target, outstandingText, undefined, signal)) {
                done.push('消息');
                outstandingText = '';
            }
        }
        if (outstandingPath !== undefined) {
            if (await this.#sendOrQueue(target, '', outstandingPath, signal)) {
                done.push(`文件 ${basename(outstandingPath)}`);
                outstandingPath = undefined;
            }
        }
        if (outstandingText === '' && outstandingPath === undefined) {
            const summary = `已通过微信发送：${done.join('、')}`;
            // Recorded because a proactive send has no other trace: nothing in the transcript shows it, and
            // "did it actually reach the phone" is the only question that matters when it is reported.
            this.#recordBoot(`notify_wechat: ${done.join(', ')} to ${target.conversationId}`);
            return summary;
        }
        // The window is closed. Kept for the next message the user sends, which reopens it.
        const held = outstandingPath === undefined ? '这条消息' : `文件 ${basename(outstandingPath)}`;
        this.#recordBoot(`notify_wechat: 窗口已关闭，${held} 已排队（会话 ${target.conversationId}）` +
            (done.length > 0 ? `；已先送出 ${done.join('、')}` : ''));
        return (`${held}没能立刻发出：微信的回信窗口已关闭。已排队，` +
            `会在用户下次在微信里发消息时自动补发。` +
            (done.length > 0 ? `（已先送出：${done.join('、')}）` : ''));
    }
    /**
     * Send one piece, or keep it for the next open window.
     *
     * Only a refusal by the service is treated this way. A missing file, a network failure or a
     * cancelled run all throw as before: those will fail again the same way, and turning them into a
     * backlog would only hide the error behind a delay.
     *
     * @param target - Conversation to deliver to.
     * @param text - Text to send; empty when only a file is being sent.
     * @param path - File to send; undefined when only text is being sent.
     * @param signal - Cancellation from the caller, when there is one.
     * @returns True when it was sent now, false when it was queued.
     */
    async #sendOrQueue(target, text, path, signal) {
        try {
            if (path !== undefined)
                await this.#conveyFile(path, undefined, target, signal);
            else {
                await this.#sendText(target.account, target.conversationId, target.peerId, text, target.contextToken);
            }
            return true;
        }
        catch (error) {
            if (!(error instanceof SendRefusedError))
                throw error;
            await this.#store.update((state) => {
                const dropped = queuePendingNotification(state, {
                    conversationId: target.conversationId,
                    text,
                    ...(path === undefined ? {} : { path }),
                });
                if (dropped > 0) {
                    this.#recordBoot(`notify_wechat: 队列已满，丢弃了 ${String(dropped)} 条最旧的待发消息`);
                }
            });
            return false;
        }
    }
    /**
     * Deliver anything queued for this conversation, now that its window is open again.
     *
     * Called as soon as an inbound message refreshes the reply token, and before that message is
     * handled: the user's own turn is what reopens the window, so the backlog belongs in front of the
     * answer rather than after it — otherwise the notifications they were waiting for appear below a
     * reply that has nothing to do with them.
     *
     * A piece that is refused again stays queued for the next attempt; one whose file has since been
     * deleted is dropped, because retrying it forever would block everything behind it.
     *
     * @param conversationId - Conversation whose window just opened.
     */
    async #flushPending(conversationId) {
        try {
            // Expire first, then read: reading first would hand the loop entries that were just discarded
            // as too old, and they would go out anyway.
            const expired = await this.#expirePending();
            if (expired > 0) {
                this.#recordBoot(`pending: 丢弃 ${String(expired)} 条过期的待发消息`);
            }
            const pending = (await this.#store.read()).pendingNotifications ?? [];
            const mine = pending.filter((entry) => entry.conversationId === conversationId);
            if (mine.length === 0)
                return;
            const bound = await this.#boundConversation();
            if (!bound.ok)
                return;
            const target = bound.target;
            if (target.conversationId !== conversationId)
                return;
            let sent = 0;
            const unsendable = [];
            for (const entry of mine) {
                try {
                    if (entry.text.trim() !== '') {
                        await this.#sendText(target.account, target.conversationId, target.peerId, entry.text, target.contextToken);
                    }
                    if (entry.path !== undefined) {
                        if (!existsSync(entry.path)) {
                            // Dropped, not retried: the text above has already gone out, so keeping the entry would
                            // repeat it on every later message and block everything queued behind it.
                            unsendable.push(basename(entry.path));
                            await this.#dropPending(entry.id);
                            continue;
                        }
                        await this.#conveyFile(entry.path, undefined, target);
                    }
                    sent += 1;
                    await this.#dropPending(entry.id);
                }
                catch (error) {
                    // A refusal means the window closed again between the token and this send, which is odd but
                    // possible; keeping the entry is the whole point of the queue. Anything else cannot succeed
                    // on a later attempt either, so it is reported and dropped rather than retried forever.
                    if (!(error instanceof SendRefusedError)) {
                        this.#recordError(`补发失败：${error instanceof Error ? error.message : String(error)}`);
                        await this.#dropPending(entry.id);
                    }
                }
            }
            if (sent > 0 || unsendable.length > 0) {
                this.#recordBoot(`pending: 补发 ${String(sent)} 条到 ${conversationId}` +
                    (unsendable.length > 0 ? `；${String(unsendable.length)} 个文件已不存在` : ''));
            }
            if (unsendable.length > 0) {
                await this.#notifyAboutMissingFiles(conversationId, unsendable);
            }
        }
        catch (error) {
            // Never allowed to break the inbound message it was triggered by: the user's own turn matters
            // more than the backlog, and a queue that throws would swallow their message.
            this.#recordError(`补发待发消息时出错：${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Drop everything past the age bound.
     *
     * @returns How many entries were dropped.
     */
    async #expirePending() {
        let dropped = 0;
        await this.#store.update((state) => {
            dropped = expirePendingNotifications(state).length;
        });
        return dropped;
    }
    /**
     * Remove one delivered entry.
     *
     * By id rather than by position: the flush loop reads the queue once, and a concurrent enqueue
     * would shift every index under it.
     *
     * @param id - Identity of the entry to remove.
     */
    async #dropPending(id) {
        await this.#store.update((state) => {
            const queue = state.pendingNotifications;
            if (queue === undefined)
                return;
            const next = queue.filter((entry) => entry.id !== id);
            if (next.length === 0)
                delete state.pendingNotifications;
            else
                state.pendingNotifications = next;
        });
    }
    /**
     * Tell the user which queued files could no longer be found.
     *
     * Sent rather than only logged: they were promised a file, and its absence is the one part of a
     * late delivery they cannot infer from what does arrive.
     *
     * @param conversationId - Conversation to tell.
     * @param names - File names that no longer exist.
     */
    async #notifyAboutMissingFiles(conversationId, names) {
        try {
            const bound = await this.#boundConversation();
            if (!bound.ok || bound.target.conversationId !== conversationId)
                return;
            await this.#sendText(bound.target.account, bound.target.conversationId, bound.target.peerId, `之前有 ${String(names.length)} 个排队发送的文件已经找不到了：${names.join('、')}`, bound.target.contextToken);
        }
        catch {
            // Best effort. This is a courtesy note about a failed delivery; if it cannot be sent either,
            // the log already has the names.
        }
    }
    /**
     * Re-register the session tool so its description reflects the current setting.
     *
     * Called after the confirmation preference changes. Without it the setting would appear to do
     * nothing until the next restart, because the agent reads the description, not the setting.
     */
    refreshSessionTool() {
        const tools = this.#ctx.tools;
        if (tools === undefined)
            return;
        this.#sessionToolDisposer?.();
        this.#sessionToolDisposer = tools.register(this.#sessionToolDefinition());
    }
    /**
     * The session tool as the registry needs it.
     *
     * Built synchronously, because `apply` registers tools during setup and cannot await. The
     * settings are read straight from disk here rather than through the cache, which is filled on
     * first use for the assistant-stream path — reading it at registration would see the built-in
     * defaults and the confirmation setting would silently do nothing.
     *
     * @returns The definition to register.
     */
    #sessionToolDefinition() {
        const requireConfirmation = this.#settingsFromDisk().requireConfirmation;
        return {
            name: 'session_control',
            description: sessionToolDescription(requireConfirmation),
            parameters: {
                type: 'object',
                properties: {
                    action: {
                        type: 'string',
                        enum: ['list', 'switch', 'new', 'current', 'cancel'],
                        description: 'list: show every conversation with its number. switch: move this WeChat conversation to an existing one. new: start a fresh one. current: report which one is in use. cancel: interrupt the work running in it.',
                    },
                    target: {
                        type: 'string',
                        description: 'For switch, the conversation to move to: its number from list, or its title. For new, an optional title. For list, the literal "all" shows conversations from every workspace, not just this channel\'s own.',
                    },
                },
                required: ['action'],
                additionalProperties: false,
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        detail: { type: 'string' },
                        ok: { type: 'boolean' },
                        otherWorkspaces: { type: 'number' },
                    },
                    required: ['detail', 'ok'],
                },
                render: (args) => [
                    { type: 'text', text: `session_control ${String(args.action ?? '')}` },
                ],
            },
            execute: async (args, exec) => {
                const result = await this.controlSession(sessionIdOf(exec.agent), String(args.action ?? ''), args.target === undefined ? undefined : String(args.target));
                this.#recordBoot(`session_control: action=${String(args.action)} target=${String(args.target ?? '')} ok=${String(result.ok)}`);
                // The rows are appended so the agent can offer the numbered choice it just described
                // without a second call, which is what makes "switch to the 周报 one" work from one turn.
                const rows = renderTable(result.sessions, result.sessions.find((row) => row.current)?.sessionId);
                return {
                    detail: rows === '' ? result.detail : `${result.detail}\n\n${rows}`,
                    ok: result.ok,
                    otherWorkspaces: result.otherWorkspaces,
                };
            },
        };
    }
    /**
     * Upload one local file and deliver it to the conversation bound to the calling agent.
     *
     * @param path - Absolute path of the file to send.
     * @param caption - Optional text sent ahead of the file.
     * @param exec - Tool execution context, used for the calling agent and cancellation.
     * @returns A short human-readable outcome.
     */
    async #sendFileToWechat(path, caption, exec) {
        const target = await this.#conversationForAgent(exec.agent);
        if (target === undefined) {
            throw new Error('这个会话没有绑定任何微信对话，无法发送。请让用户在微信里先发一条消息。');
        }
        return await this.#conveyFile(path, caption, target, exec.signal);
    }
    /**
     * Upload and send one file into a conversation.
     *
     * Split from {@link #sendFileToWechat} so the channel can send on its own behalf — a reply too
     * long for a message — without pretending to be a tool invocation with an agent to resolve.
     *
     * @param path - File to read and send.
     * @param caption - Optional text sent before the file.
     * @param target - Resolved conversation.
     * @param signal - Cancellation from the caller, when there is one.
     */
    async #conveyFile(path, caption, target, signal) {
        const data = await readFile(path);
        const fileName = basename(path);
        // The media type is not cosmetic: the service stores the object differently per kind, and
        // a video sent as a generic file arrives as an opaque download rather than a playable clip.
        const kind = mediaKindOf(fileName);
        const uploaded = await uploadMedia({
            account: target.account,
            toUserId: target.peerId,
            data,
            fileName,
            mediaType: MEDIA_TYPE_BY_KIND[kind],
            ...(signal === undefined ? {} : { signal }),
            onDiagnostic: (detail) => {
                // Recorded because a sent-but-invisible image leaves no other trace: the service
                // accepts the message, so nothing throws and no error is ever raised.
                this.#recordBoot(`outbound upload: target=${detail.uploadUrl.slice(0, 150)}\n` +
                    `  response=${JSON.stringify(detail.response).slice(0, 800)}`);
            },
        });
        // No thumbnail is produced or referenced. The reference implementation's image item
        // carries `media` and `mid_size` only, and an extra reference it does not expect is one
        // more thing the recipient has to reconcile before it can paint the message.
        // The caption goes out *before* the attachment, matching the reference implementation,
        // which sends an optional TEXT item first and the media item second. Sending it after
        // reads as an unrelated message that happens to arrive later.
        if (typeof caption === 'string' && caption.trim() !== '') {
            await this.#reply(target.account, target.conversationId, target.peerId, caption.trim());
        }
        const sender = SENDER_BY_KIND[kind];
        const sent = await sender({
            account: target.account,
            to: target.peerId,
            uploaded,
            ...(target.contextToken === undefined ? {} : { contextToken: target.contextToken }),
            ...(signal === undefined ? {} : { signal }),
        });
        // The assigned id, next to the message it names: a quoted attachment is resolved by this
        // id alone, and an attachment's content cannot be recovered from the quote itself.
        this.#recordBoot(`outbound: ${fileName} ${data.length}B -> ${target.peerId} (${MEDIA_LABEL_BY_KIND[kind]})` +
            ` id=${sent.serverMessageId ?? '(none)'}`);
        if (sent.serverMessageId !== undefined) {
            const id = sent.serverMessageId;
            await this.#store.update((s) => {
                // Resolved inside the update so the limit is read from the same state being written.
                const { quoteHistory } = resolveSettings(s);
                rememberSentMessage(s, target.account.accountId, target.conversationId, { messageId: id, kind, preview: fileName, at: Date.now() }, quoteHistory);
            });
        }
        return `已发送 ${fileName}（${data.length} 字节）到微信`;
    }
    /**
     * Find the WeChat conversation whose session is the calling agent's.
     *
     * @param agent - The tool's calling agent, whose session id identifies the binding.
     */
    async #conversationForAgent(agent) {
        const sessionId = sessionIdOf(agent);
        if (sessionId === undefined)
            return undefined;
        const state = await this.#store.read();
        const binding = Object.values(state.bindings).find((entry) => entry.sessionId === sessionId);
        return this.#conversationOf(state, binding);
    }
    /**
     * The conversation the channel is currently bound to, whoever is asking.
     *
     * This is what lets a session that is *not* the bound one deliver a message — the point of
     * `notify_wechat`. The target is read from the binding rather than taken from the caller, so a
     * proactive message can only ever reach the conversation the user is actually in; there is no
     * argument an agent could get wrong and send somewhere else.
     *
     * Refuses when several conversations are bound rather than guessing: sending a file to the wrong
     * person is not a failure worth risking to save an error message. Today the channel binds one, so
     * this is a guard against a future that adds accounts.
     *
     * @returns The bound conversation, or a reason it cannot be resolved.
     */
    async #boundConversation() {
        const state = await this.#store.read();
        const bindings = Object.values(state.bindings);
        if (bindings.length === 0) {
            return { ok: false, reason: '还没有微信对话。请先在微信里给机器人发一条消息，之后才能主动推送。' };
        }
        if (bindings.length > 1) {
            return {
                ok: false,
                reason: `当前绑定了 ${String(bindings.length)} 个微信对话，无法确定发给哪一个。请先解绑多余的。`,
            };
        }
        const target = this.#conversationOf(state, bindings[0]);
        if (target === undefined) {
            return { ok: false, reason: '绑定的微信账号已经不在状态里，请重新扫码绑定。' };
        }
        return { ok: true, target };
    }
    /**
     * Turn one stored binding into everything a send needs.
     *
     * Shared by the agent-scoped and conversation-scoped lookups so the two cannot drift: the rules
     * about which account and which reply token apply are the same either way.
     *
     * @param state - State the binding came from.
     * @param binding - Stored binding, or undefined when there was none.
     * @returns The conversation, or undefined when the account is gone.
     */
    #conversationOf(state, binding) {
        if (binding === undefined)
            return undefined;
        const account = state.accounts[binding.accountId];
        if (account === undefined)
            return undefined;
        const contextToken = state.contextTokens[binding.accountId]?.[binding.conversationId];
        return {
            account,
            peerId: binding.peerId,
            conversationId: binding.conversationId,
            ...(contextToken === undefined ? {} : { contextToken }),
        };
    }
    /**
     * Whether this is the first message a session will ever receive.
     *
     * Asked of the store rather than tracked in memory: the answer has to survive a restart, and a
     * session the user created on the desktop and switched to is not new either.
     *
     * @param sessionId - Session about to be prompted.
     * @returns True when nothing has been recorded for it yet.
     */
    async #isFirstMessage(sessionId) {
        try {
            return (await storedSessionWorkspace(this.#home, sessionId)) === undefined;
        }
        catch {
            // Unreadable store: assume it is not new, which keeps the note inline as it always was.
            return false;
        }
    }
    /**
     * Download every attachment on a message and write it inside the session workspace.
     *
     * A failure here is recorded and skipped rather than thrown: a photo the service
     * will not serve should not cost the user the text that came with it.
     *
     * @param message - Inbound envelope, whose `media` is absent for text-only messages.
     * @returns One `{ media, path }` per attachment that downloaded successfully.
     */
    async #fetchAttachments(message) {
        const items = message.media ?? [];
        if (items.length === 0)
            return [];
        const stored = [];
        for (const item of items) {
            try {
                const media = await downloadItemMedia({ item });
                if (media === undefined)
                    continue;
                const path = storeMedia(this.#home, media);
                stored.push({ media, path });
                this.#recordBoot(`media: ${media.kind} ${media.data.length}B -> ${path}`);
            }
            catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                this.#recordError(`附件下载失败: ${detail}`);
                // Record the item that failed. An inbound CDN reference has forms this plugin
                // has never observed from the service, and the URL it derives is a guess: the
                // shape is the one thing that cannot be reconstructed from a failure message.
                this.#recordBoot(`media: download failed, item=${JSON.stringify(item).slice(0, 600)}`);
            }
        }
        return stored;
    }
    /** Hand a prompt to its session. */
    async #prompt(decision, message, attachments = [], quoted) {
        /*
         * On a session's first message, the user's words go alone.
         *
         * DSH names a session from its first prompt (`dsh-session-title-first-prompt-llm`), and that
         * naming sees the whole prompt text. Putting the channel note last was not enough: sessions
         * created after that change were still called 「微信渠道协助对话」 and 「微信渠道对话支持」,
         * because the note is *in* the prompt however it is ordered — it is what the first message is
         * mostly made of.
         *
         * So the first message carries nothing but the request, and the note follows as its own message.
         * Everything after the first message joins in one prompt as before, since naming is no longer at
         * stake and one message is easier for the agent to read.
         *
         * Attachments are described in the prompt text rather than sent as native image content: that
         * path requires a vision-capable model and rejects the prompt outright otherwise, while a path
         * works with every model and every file kind.
         */
        const settings = await this.#settings();
        const naming = await this.#isFirstMessage(decision.sessionId);
        const lines = [
            decision.prompt,
            ...(quoted === undefined ? [] : [quoted]),
            ...attachments.map((entry) => describeMedia(entry.media, entry.path)),
            // Held back only for the message that names the session; see below.
            ...(naming || settings.presenceNote === '' ? [] : [settings.presenceNote]),
        ].filter((line) => line !== '');
        const prompt = lines.join('\n\n');
        /*
         * The message that names the session carries nothing but the user's words, and the note follows
         * as its own message — sent after, so a dropped note costs the user nothing. Every later message
         * goes in one piece, since naming is no longer at stake and one message reads better.
         */
        const outbound = naming && settings.presenceNote !== ''
            ? [prompt, settings.presenceNote].filter((text) => text !== '')
            : [prompt].filter((text) => text !== '');
        let delivered = false;
        for (const text of outbound) {
            // A refused steer is a real outcome — the turn it targeted can end first — so the queue is
            // tried instead of losing the message.
            if (await this.#submit(decision.sessionId, text, 'steer'))
                delivered = true;
            else if (await this.#submit(decision.sessionId, text, 'queue'))
                delivered = true;
        }
        if (delivered)
            return;
        this.#recordError('提交任务失败: 插话与排队都未成功');
        const account = await this.#account(message.accountId);
        if (account === undefined)
            return;
        // Hand the words back rather than losing them. A dropped message is the one failure here
        // that nothing downstream can repair — the user's own text is the only copy.
        await this.#reply(account, message.conversationId, message.peerId, `没能把消息交给会话，请重发一次。\n\n你的内容：\n${truncate(prompt, MAX_REPLY_CHARS)}`);
    }
    /**
     * Submit a prompt, interrupting a running turn and falling back to the queue.
     *
     * A refused steer must not cost the message: the user's words are the one thing here that
     * cannot be reconstructed, while a queued answer is merely later than a steered one. So a
     * refusal becomes a plain queue submission rather than an error.
     *
     * @param sessionId - Session to prompt.
     * @param prompt - Text to submit.
     * @param mode - Placement to request while a turn is running.
     * @returns Whether the prompt was accepted; false leaves the caller to report the loss.
     */
    async #submit(sessionId, prompt, mode) {
        const request = {
            // A media-only message has no text of its own; the attachment line is then the entire
            // prompt, which is what `hasPromptContent` requires.
            content: [{ type: 'text', text: prompt }],
        };
        try {
            await this.#ctx.sessionController.prompt({ ...request, requestId: `wechat-${randomUUID()}`, sessionId, mode }, new AbortController().signal);
            return true;
        }
        catch (error) {
            if (mode !== 'steer') {
                this.#recordError(`提交任务失败: ${error instanceof Error ? error.message : String(error)}`);
                return false;
            }
            this.#recordBoot(`steer refused, falling back to queue: ${error instanceof Error ? error.message : String(error)}`);
        }
        try {
            await this.#ctx.sessionController.prompt({ ...request, requestId: `wechat-${randomUUID()}`, sessionId, mode: 'queue' }, new AbortController().signal);
            return true;
        }
        catch (error) {
            this.#recordError(`排队提交也失败: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }
    /** Send one reply into a conversation. */
    /**
     * Submit a prompt, falling back to the queue when steering is refused.
     *
     * A refused steer must not lose the message: the user's words are the one thing here that
     * cannot be reconstructed. Steering is refused when the turn it targeted has already ended,
     * so the fallback is a plain queue and the message is answered on the next turn instead.
     *
     * @param sessionId - Session to prompt.
     * @param prompt - Text to submit.
     * @param mode - Preferred placement when a turn is running.
     */
    /** Send one reply into a conversation. */
    async #reply(account, conversationId, peerId, text) {
        /*
         * Anything sent into a conversation ends the "typing…" state for it: the channel is speaking, so
         * it is no longer composing. This is where the indicator is cleared for a turn handed to the
         * agent, because that is the moment the agent's answer goes out — the inbound handler returns
         * long before this, having only submitted the request.
         */
        this.#stopTyping(conversationId);
        const state = await this.#store.read();
        const contextToken = state.contextTokens[account.accountId]?.[conversationId];
        const settings = await this.#settings();
        try {
            await this.#sendWithinLimit(account, conversationId, peerId, text, settings, contextToken);
        }
        catch (error) {
            this.#recordError(`发送失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Send one message, splitting or filing it when it is longer than the configured limit.
     *
     * A reply over the limit is sent as a Markdown file rather than cut short. Truncation loses
     * the end of an answer silently, which for a long explanation or a code listing is the part
     * that mattered; a file always arrives whole and opens where the user can read it.
     *
     * @param account - Sending bot.
     * @param conversationId - Conversation, for the reply token.
     * @param peerId - Recipient.
     * @param text - Full reply text.
     * @param settings - Resolved settings, so one message sees one consistent limit.
     * @param contextToken - Reply token, when one is stored.
     */
    async #sendWithinLimit(account, conversationId, peerId, text, settings, contextToken) {
        const limit = settings.maxReplyChars;
        if (limit <= 0 || text.length <= limit) {
            await this.#sendText(account, conversationId, peerId, truncate(text, Math.max(limit, 1)), contextToken);
            return;
        }
        // A caption so the file is not an unexplained attachment, then the file itself.
        await this.#sendText(account, conversationId, peerId, `回复较长（${String(text.length)} 字），已作为文件发送。`, contextToken);
        const name = `回复-${new Date().toISOString().replace(/[:.]/g, '-')}.md`;
        const path = join(this.#mediaDir(), name);
        await writeFile(path, text, 'utf8');
        await this.#conveyFile(path, undefined, {
            account,
            conversationId,
            peerId,
            ...(contextToken === undefined ? {} : { contextToken }),
        });
        this.#recordBoot(`long reply ${String(text.length)} chars -> ${name}`);
    }
    /**
     * The folder generated replies and inbound attachments are written to, created if absent.
     *
     * Created on demand rather than when the first attachment arrives: a long reply can be the
     * first thing this channel ever writes, and a missing folder would surface as a silently
     * truncated answer instead of a file.
     */
    #mediaDir() {
        const dir = join(this.#home, WORKSPACE_DIR_NAME, MEDIA_DIR_NAME);
        mkdirSync(dir, { recursive: true });
        return dir;
    }
    /**
     * Send one text message and record the id the service assigns.
     *
     * @param account - Sending bot.
     * @param conversationId - Conversation, for the reply token and the quote cache.
     * @param peerId - Recipient.
     * @param text - Already-limited text.
     * @param contextToken - Reply token, when one is stored.
     */
    async #sendText(account, conversationId, peerId, text, contextToken) {
        const sent = await this.#send({
            account,
            to: peerId,
            text,
            ...(contextToken === undefined ? {} : { contextToken }),
        });
        // The id the service assigned plus a body preview, recorded so a quote of this message can
        // be resolved and the resolution verified later. Without the preview there is no way to
        // tell a correct lookup from a wrong one.
        const id = sent?.serverMessageId;
        const preview = text.replace(/\s+/g, ' ').slice(0, 120);
        this.#recordBoot(`outbound text id=${typeof id === 'string' ? id : '(none)'} len=${String(text.length)}` +
            ` body=${preview}`);
        if (typeof id === 'string') {
            // Retained so a quote of this message can be turned back into content. A quote carries
            // only an id, so without this the agent sees "elaborate on this" and nothing else.
            const settings = await this.#settings();
            await this.#store.update((s) => {
                rememberSentMessage(s, account.accountId, conversationId, { messageId: id, kind: 'text', preview, at: Date.now() }, settings.quoteHistory);
            });
        }
    }
    /**
     * Resolve the WeChat conversation bound to a session.
     *
     * @param sessionId - Session to look up.
     */
    async #conversationForSession(sessionId) {
        const state = await this.#store.read();
        const binding = Object.values(state.bindings).find((entry) => entry.sessionId === sessionId);
        if (binding === undefined)
            return undefined;
        const account = state.accounts[binding.accountId];
        if (account === undefined)
            return undefined;
        const contextToken = state.contextTokens[binding.accountId]?.[binding.conversationId];
        return {
            account,
            conversationId: binding.conversationId,
            peerId: binding.peerId,
            ...(contextToken === undefined ? {} : { contextToken }),
        };
    }
    /**
     * Record the field set of a tool-call frame that could not be used.
     *
     * Written once per distinct shape. This is the only way to tell "the harness names tool calls
     * somewhere other than `name`" apart from "cards are broken", which look identical from the
     * phone and from a passing test suite.
     */
    #recordToolShape(shape) {
        this.#recordOnce('#toolCallShapes', `tool-call frame fields (no call made): ${shape}`);
    }
    /**
     * Write a line to the boot log the first time a given value is seen.
     *
     * Keeps an observational log bounded: a chunk kind or frame shape repeats thousands of times
     * in one turn, and only its first occurrence carries information.
     *
     * @param bucket - Grouping key, so separate observations do not collide.
     * @param line - Line to write, once.
     */
    #recordOnce(bucket, line) {
        if (this.#seenShapes.get(bucket)?.has(line) === true)
            return;
        const seen = this.#seenShapes.get(bucket) ?? new Set();
        seen.add(line);
        this.#seenShapes.set(bucket, seen);
        this.#recordBoot(line);
    }
    /**
     * Show that a tool call started, using the chat client's own tool card.
     *
     * Failure is recorded and swallowed: a card is decoration beside the reply, and losing one
     * must never cost the answer that follows it.
     */
    async #announceTool(sessionId, callId, toolName) {
        const key = `${sessionId}\u0000${callId}`;
        if (this.#announcedTools.has(key))
            return;
        this.#announcedTools.add(key);
        this.#runningTools.set(key, { sessionId, toolName });
        try {
            const target = await this.#conversationForSession(sessionId);
            if (target === undefined)
                return;
            await sendToolCard({
                account: target.account,
                to: target.peerId,
                phase: 'start',
                toolName,
                toolCallId: callId,
                runId: sessionId,
                ...(target.contextToken === undefined ? {} : { contextToken: target.contextToken }),
            });
            // Recorded on success as well as failure: without this, a card the service accepted and
            // a card that was never sent leave identical evidence.
            this.#recordBoot(`tool card: start ${toolName} (${callId})`);
        }
        catch (error) {
            this.#recordError(`工具卡片发送失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Build the `tools/result` listener that closes each tool card.
     *
     * Every running call is closed when a turn ends rather than only the ones the harness
     * reports: the result event is dispatched against the calling agent's scope, which this
     * host-scope plugin may not be inside, and a card left open would sit in the transcript
     * forever. The harness's own status is used when it arrives, so a failed call is not
     * reported as a success.
     *
     * @returns The listener to hand to `ctx.on('tools/result', ...)`.
     */
    toolResultListener() {
        return (exec, result) => {
            const record = (exec ?? {});
            const toolName = typeof record.name === 'string' ? record.name : undefined;
            const callId = typeof record.callId === 'string' ? record.callId : undefined;
            const sessionId = sessionIdOf(record.agent);
            if (toolName === undefined || callId === undefined || sessionId === undefined)
                return;
            const key = `${sessionId}\u0000${callId}`;
            if (!this.#runningTools.has(key))
                return;
            void this.#closeToolCard(key, result instanceof Error);
        };
    }
    /** Send the result card for one running tool call and forget it. */
    async #closeToolCard(key, failed) {
        const running = this.#runningTools.get(key);
        if (running === undefined)
            return;
        this.#runningTools.delete(key);
        const callId = key.slice(key.indexOf('\u0000') + 1);
        try {
            const target = await this.#conversationForSession(running.sessionId);
            if (target === undefined)
                return;
            await sendToolCard({
                account: target.account,
                to: target.peerId,
                phase: 'end',
                toolName: running.toolName,
                toolCallId: callId,
                failed,
                runId: running.sessionId,
                ...(target.contextToken === undefined ? {} : { contextToken: target.contextToken }),
            });
            this.#recordBoot(`tool card: end ${running.toolName} (${callId}) failed=${String(failed)}`);
        }
        catch (error) {
            this.#recordError(`工具卡片发送失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Close every tool card still open for a session.
     *
     * Called when a turn ends, so a card cannot outlive the work it describes regardless of
     * whether the harness's result event reached this plugin.
     *
     * @param sessionId - Session whose turn just finished.
     */
    async closeOpenToolCards(sessionId) {
        const prefix = `${sessionId}\u0000`;
        const open = [...this.#runningTools.keys()].filter((key) => key.startsWith(prefix));
        for (const key of open)
            await this.#closeToolCard(key, false);
    }
    /**
     * Feed one assistant stream frame into the reply buffer.
     *
     * DSH emits deltas as the model generates. Batching them behind a short quiet
     * window turns a stream into one coherent WeChat message instead of a burst of
     * fragments, which is what a chat transcript needs. A frame that ends the turn
     * flushes immediately rather than waiting out the window.
     */
    onAssistantFrame(payload) {
        const { sessionId, text, completed, toolCall, toolCallShape, chunkType, frameShape, blockShape } = readStreamFrame(payload);
        if (sessionId === undefined)
            return;
        // Learn the stream's vocabulary. Each distinct value is logged once, so a long turn cannot
        // flood the log. This is how the tool-call signal gets identified from observation instead
        // of from a second guess about field names.
        if (chunkType !== undefined)
            this.#recordOnce('#chunkTypes', `stream chunk kind: ${chunkType}`);
        if (frameShape !== undefined)
            this.#recordOnce('#frameShapes', `stream frame shape: ${frameShape}`);
        if (blockShape !== undefined)
            this.#recordOnce('#blockShapes', `stream block fields: ${blockShape}`);
        if (toolCallShape !== undefined) {
            this.#recordToolShape(toolCallShape);
            return;
        }
        if (toolCall !== undefined) {
            void this.#announceTool(sessionId, toolCall.id, toolCall.name);
            return;
        }
        if ((text === undefined || text === '') && completed !== true)
            return;
        void (async () => {
            const bindings = (await this.#store.read()).bindings;
            const conversation = Object.values(bindings).find((entry) => entry.sessionId === sessionId);
            if (conversation === undefined)
                return;
            const existing = this.#replies.get(sessionId);
            if (existing !== undefined)
                clearTimeout(existing.timer);
            const entry = existing ?? {
                text: '',
                conversationId: conversation.conversationId,
                timer: undefined,
            };
            if (text !== undefined)
                entry.text += text;
            if (completed === true) {
                // The turn ended: send now, so the reply is not held behind the settle window.
                this.#replies.set(sessionId, entry);
                await this.#flushReply(sessionId);
                // Close any tool card the harness has not reported on. A short delay first, so a
                // `tools/result` still in flight can carry the real status — closing immediately
                // would report a failed call as completed.
                const closeTimer = setTimeout(() => {
                    void this.closeOpenToolCards(sessionId);
                }, TOOL_CARD_GRACE_MS);
                closeTimer.unref?.();
                return;
            }
            // Read from the cache, never awaited: this handler must stay synchronous so two frames of
            // the same answer cannot interleave and lose the first half of the reply.
            const { settleMs } = this.#settingsNow();
            entry.timer = setTimeout(() => {
                void this.#flushReply(sessionId);
            }, settleMs);
            entry.timer.unref?.();
            this.#replies.set(sessionId, entry);
        })();
    }
    /** Send and clear the buffered reply for a session. */
    async #flushReply(sessionId) {
        const entry = this.#replies.get(sessionId);
        if (entry === undefined)
            return;
        this.#replies.delete(sessionId);
        const text = entry.text.trim();
        if (text === '')
            return;
        const state = await this.#store.read();
        const binding = state.bindings[entry.conversationId];
        if (binding === undefined)
            return;
        const account = state.accounts[binding.accountId];
        if (account === undefined)
            return;
        await this.#reply(account, binding.conversationId, binding.peerId, text);
    }
    /** Flush everything still buffered. Used on shutdown. */
    async flushReplies() {
        for (const sessionId of [...this.#replies.keys()]) {
            const entry = this.#replies.get(sessionId);
            if (entry !== undefined)
                clearTimeout(entry.timer);
            await this.#flushReply(sessionId);
        }
    }
    /**
     * Clear every "typing…" indicator and stop its refresh loop. Used on shutdown.
     *
     * Without this the intervals would outlive the plugin and keep calling a monitor that is being
     * torn down, and whichever conversations were mid-turn would be left showing "typing" forever.
     */
    stopTypingAll() {
        for (const conversationId of [...this.#typing.keys()])
            this.#stopTyping(conversationId);
    }
    async #account(accountId) {
        return (await this.#store.read()).accounts[accountId];
    }
    #recordError(message) {
        this.#errors.push(`${new Date().toISOString()} ${message}`);
        if (this.#errors.length > 50)
            this.#errors.shift();
        console.error(`dsh-wechat-plugin: ${message}`);
    }
    /**
     * Turn a quoted message back into content the agent can read.
     *
     * A quote arrives as an id and nothing else: the inbound `ref_msg.message_item` carries
     * `type: 0`, no text, and only a `msg_id`. So the quoted content exists only in what this
     * channel recorded when it sent the message, and this is the lookup that recovers it.
     *
     * A quote of a message we have no record of is reported rather than silently dropped: the
     * agent then knows a quote was made and could not be read, which is a better answer than
     * acting on an instruction whose subject it never saw.
     *
     * @param message - Inbound message, whose items may carry a quote.
     * @returns A line to lead the prompt with, or undefined when there is no quote.
     */
    async #resolveQuote(message) {
        for (const item of message.raw.item_list ?? []) {
            const quote = item.ref_msg;
            if (quote === undefined)
                continue;
            const messageId = quote.message_item?.msg_id ?? quote.svr_id;
            if (messageId === undefined)
                continue;
            const state = await this.#store.read();
            const found = findSentMessage(state, message.accountId, messageId);
            this.#recordBoot(`quote resolved: id=${messageId} ${found === undefined ? 'NOT FOUND' : `kind=${found.kind}`}`);
            if (found === undefined) {
                // The quoted text is not recoverable, but saying so keeps the agent from guessing.
                return `[引用了一条我发出的消息，但内容已不在缓存中（id ${messageId}）]`;
            }
            return found.kind === 'text'
                ? `[引用我此前发送的消息]\n${found.preview}`
                : `[引用我此前发送的${MEDIA_LABEL_BY_KIND[found.kind]}] ${found.preview}`;
        }
        return undefined;
    }
    /**
     * Note a routine event in the boot log.
     *
     * Media arrivals land here: a download that succeeded and one that was silently
     * skipped look identical from the phone, so the path is written down where the
     * next diagnosis can find it.
     */
    #recordBoot(message) {
        bootLog(this.#home, message);
    }
    /**
     * Record a failure reported by the browser half.
     *
     * Written to the same boot log as host failures, because a client throw is
     * otherwise invisible: it happens in a page the host cannot observe, and the
     * settings page may never even mount.
     */
    recordClientError(scope, message, stack) {
        recordClientFailure(this.#home, scope, message, stack);
        this.#recordError(`客户端错误[${scope}]: ${message}`);
    }
    /**
     * Resolve (or register) the Workspace this channel's sessions live in.
     *
     * Grouping is the whole point: a session created with only a `cwd` shows up in the
     * desktop's "Ungrouped" bucket, and the host rejects a create that names both a
     * `workspaceId` and a `cwd`, so this must supply the workspace instead of the path.
     *
     * Deliberately not swallowed on failure. If the folder cannot be established the
     * channel would keep working but quietly lose its grouping, and the settings page
     * reports the error instead — better one visible failure than silent drift.
     *
     * @returns The Workspace id to pass to `sessionController.create`.
     */
    async #ensureWorkspace() {
        return await this.#workspaceIdFor(this.#workspace, WORKSPACE_TITLE);
    }
    /**
     * Resolve — or create — the workspace owning a directory.
     *
     * Needed because a session can only be adopted with the workspace it already belongs to: the host
     * pins a session's `cwd`, so resuming a conversation from another project means naming *that*
     * project's workspace rather than the channel's own.
     *
     * @param path - Directory the workspace owns.
     * @param title - Title to apply when this is the channel's own workspace.
     * @returns The workspace id, or an empty string when the composition has no registry.
     */
    async #workspaceIdFor(path, title) {
        const registry = this.#ctx.workspaceRegistry;
        if (registry === undefined) {
            // Composition without Workspaces: leave the id unset so `create` falls back to the pinned cwd
            // and sessions land in the ungrouped bucket. Recorded once, not per call.
            if (isSameWorkspace(path, this.#workspace)) {
                this.#recordError('此组合没有工作区服务，会话将显示在「未分组」下');
            }
            return '';
        }
        // The channel's own workspace keeps its id, and its title is enforced so the folder reads
        // correctly on the desktop. A foreign workspace is left exactly as its owner named it.
        if (isSameWorkspace(path, this.#workspace) && this.#workspaceId !== undefined) {
            return this.#workspaceId;
        }
        const workspace = (await registry.resolveByPath(path)) ?? (await registry.create(path));
        if (title !== '' && workspace.title !== title)
            await workspace.setTitle(title);
        if (isSameWorkspace(path, this.#workspace))
            this.#workspaceId = workspace.id;
        return workspace.id;
    }
    /**
     * Give a session the permission preset the user chose for WeChat.
     *
     * Why this exists at all: a session whose policy is `ask` sends a permission prompt to WeChat and
     * then waits. On a phone that is a dead end — the user left the desk precisely so they would not
     * have to babysit prompts, and a task that stalls until they answer one is a task they cannot run
     * from WeChat. The default therefore lifts the guardrail for this channel's sessions.
     *
     * Two details that decide whether this works:
     *
     *  - It has to run **before the session's first turn**. DSH rejects a preset change once a turn
     *    has begun (`agent-preset/locked`), so this is called from `ensureSession`, which the router
     *    reaches before it prompts anything — for a new conversation and for a switch alike.
     *  - It is best-effort. The service may be absent on a host that does not compose permission
     *    presets, and a failure here must not cost the user their message: the worst case is that the
     *    session keeps the profile's own policy, which is exactly the old behaviour.
     *
     * @param sessionId - Session that was just created or adopted.
     */
    #applyPermissionPreset(sessionId) {
        const preset = this.#settingsFromDisk().permissionPreset;
        if (preset === 'default')
            return;
        try {
            const sessions = this.#ctx.get('sessions');
            const presets = this.#ctx.get('permissionPresets');
            const session = sessions?.get?.(sessionId);
            if (session === undefined || presets?.set === undefined) {
                // Not an error: a host without the service keeps its own policy.
                bootLog(this.#home, `permission preset '${preset}' not applied to ${sessionId}: service unavailable`);
                return;
            }
            presets.set(session, preset);
            bootLog(this.#home, `permission preset '${preset}' applied to ${sessionId}`);
        }
        catch (error) {
            /*
             * Recorded rather than thrown. A session that already ran its first turn is the expected way
             * this fails, and losing the user's message over a permission nicety would be a worse outcome
             * than the session keeping the profile's policy.
             */
            bootLog(this.#home, `permission preset failed for ${sessionId}: ${String(error)}`);
        }
    }
    /** Adapt the host session controller to the router's narrow gateway port. */
    #gateway() {
        const ctx = this.#ctx;
        // Pinned for the life of every session: the host rejects an adopt whose `cwd`
        // differs from the stored one.
        const cwd = this.#workspace;
        return {
            ensureSession: async (sessionId) => {
                /*
                 * Adopt the session under *its own* workspace, not the channel's.
                 *
                 * The host pins a session's `cwd` for its life, so resuming a conversation that belongs to
                 * another project has to name that project's workspace. Using the channel's workspace
                 * everywhere — which this did at first — silently restricted the user to conversations
                 * created through WeChat, and made every other one fail on selection.
                 */
                const home = (await storedSessionWorkspace(this.#home, sessionId)) ?? cwd;
                const workspaceId = await this.#workspaceIdFor(home, isSameWorkspace(home, cwd) ? WORKSPACE_TITLE : '');
                if (workspaceId === '') {
                    await ctx.sessionController.create({ sessionId, cwd: home });
                    this.#applyPermissionPreset(sessionId);
                    return;
                }
                // Naming the Workspace rather than the directory is what groups the session
                // under a real folder; the workspace supplies the same cwd under the hood.
                await ctx.sessionController.create({ sessionId, workspaceId });
                this.#applyPermissionPreset(sessionId);
            },
            prompt: async (sessionId, text) => {
                await ctx.sessionController.prompt({
                    requestId: `wechat-${randomUUID()}`,
                    sessionId,
                    mode: 'queue',
                    content: [{ type: 'text', text }],
                }, new AbortController().signal);
            },
            /*
             * The on-disk store is the only source of sessions.
             *
             * `sessionController.list()` returned an empty array on every run on the machine this was built
             * for, so `/list` answered with nothing while the store held nine conversations for this
             * workspace. It was kept at first as a supplement, but a source that never returns anything is
             * worse than absent: it suggests the channel is showing everything it knows when it is showing
             * what it read from disk, and it says nothing about *where* a session lives — the very field
             * that decides whether it can be adopted.
             *
             * Own-workspace conversations lead in both methods, because those are the ones this chat made.
             */
            listOwnSessions: async () => {
                const { own } = await splitStoredSessions(this.#home, cwd);
                return own;
            },
            listSessions: async () => {
                const { own, others } = await splitStoredSessions(this.#home, cwd);
                return [...own, ...others];
            },
            cancel: async (sessionId) => {
                await ctx.sessionController.cancel({ sessionId });
            },
        };
    }
}
/**
 * Sessions on disk, split by whether they belong to the channel's workspace.
 *
 * One reader for both the full and the own-workspace list, so the two can never disagree about where
 * a session lives — the split that decides whether it is shown by default and whether it can be
 * adopted at all.
 *
 * @param home - DSH home directory.
 * @param cwd - The channel's own workspace directory.
 * @returns Own-workspace sessions and all others.
 */
async function splitStoredSessions(home, cwd) {
    const grouped = await listAllStoredSessions(home).catch(() => new Map());
    const own = [];
    const others = [];
    for (const [path, sessions] of grouped) {
        const target = isSameWorkspace(path, cwd) ? own : others;
        for (const session of sessions) {
            target.push({ sessionId: session.sessionId, title: session.title, updatedAt: session.updatedAt });
        }
    }
    // A session whose directory was never recorded cannot be attributed, so it is offered as this
    // workspace's own: that is the only workspace this conversation can vouch for.
    return { own, others };
}
/** Truncate a reply, keeping the tail readable. */
function truncate(text, limit) {
    if (text.length <= limit)
        return text;
    return `${text.slice(0, limit)}\n\n…（已截断，完整内容见桌面端）`;
}
/** Resolve the DSH home directory this plugin stores under. */
function resolveHome(ctx) {
    const home = ctx.get('homePaths');
    return home?.home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh');
}
/**
 * Resolve where the channel keeps its durable state and its sessions.
 *
 * Both live under the same directory so a user can find, back up, or delete the
 * channel's footprint in one place.
 */
function resolvePaths(ctx, config) {
    const home = resolveHome(ctx);
    const stateFile = config.stateFile ?? join(home, 'wechat', 'state.json');
    // Deliberately constant: see WORKSPACE_DIR_NAME.
    const workspace = config.workspace ?? join(home, WORKSPACE_DIR_NAME);
    /*
     * The session workspace has to exist before a session can be created in it.
     *
     * The host resolves a session's `cwd` with `realpath`, which fails on a directory that is not
     * there — so on a fresh install the first inbound message died with `ENOENT: no such file or
     * directory, realpath '<home>/dsh_wechat'` and the user saw "处理这条消息时出错了".
     *
     * It went unnoticed because the only other place that creates it is the media writer, which uses
     * `recursive: true` and therefore built the whole chain — but only once an attachment arrived. On
     * a machine where that had ever happened the directory existed, and the bug hid itself. A fresh
     * install of a released version found it immediately.
     *
     * Created here, where every path is resolved, so it cannot be skipped: this runs during `apply`,
     * before any message can arrive.
     */
    mkdirSync(workspace, { recursive: true });
    return { stateFile, workspace };
}
/**
 * Mount the WeChat channel.
 *
 * @param ctx - Host context providing `sessionController` and `sessions`.
 * @param config - Patch configuration.
 * @param internals - Test seams. The loader never sets this.
 */
export function apply(ctx, config = {}, internals = {}) {
    const home = resolveHome(ctx);
    bootLog(home, 'apply: entered');
    try {
        const paths = resolvePaths(ctx, config);
        const runtime = new WechatRuntime(ctx, {
            home,
            stateFile: paths.stateFile,
            workspace: paths.workspace,
            botAgent: config.botAgent ?? 'dsh-wechat-plugin/0.0.0',
            ...(internals.send === undefined ? {} : { send: internals.send }),
        });
        // The settings surface reaches the runtime through this service.
        ctx.provide('wechatChannel', runtime);
        ctx.effect(() => {
            const detachStream = ctx.on('agent/assistant-stream', (payload) => {
                runtime.onAssistantFrame(payload);
            }, { global: true });
            const detachRoutes = registerRoutes(ctx, runtime);
            // Registered inside the effect so disposal unregisters the tool rather than
            // leaving a handler that points at a torn-down runtime.
            const detachTool = runtime.registerTools();
            // Optional: `tools/result` is dispatched against the calling agent's scope, so this
            // host-scope listener may never fire. It is a status improvement, not the mechanism —
            // the start cards come from the assistant stream, and turn end closes anything left
            // open — so its absence changes accuracy, never whether a card appears.
            const detachToolResults = ctx.on('tools/result', runtime.toolResultListener(), {
                global: true,
            });
            // Both are scoped waterfalls: returning an outcome claims the request, calling `next()`
            // delegates. Unbound conversations delegate, so desktop behaviour is untouched.
            //
            // `global: true` is load-bearing, not a preference. Dispatch keeps a hook when
            // `hook.global || !filter || filter(...)`, and both events are dispatched with
            // `scopeTarget(agent, agent)`, so `filter` is always present. This plugin sits at host
            // scope and owns no agent, so without the flag it is filtered out before it can run, the
            // desktop answerer claims the prompt, and a phone-only user stays stuck.
            //
            // `prepend: true` matters just as much. The waterfall walks listeners in order and stops
            // at the first that claims, and the desktop answerer waits on its UI pane — so if it runs
            // first it takes the prompt and blocks there, and a bound conversation never gets asked
            // over WeChat. Running first is what lets this channel claim its own sessions.
            const detachApproval = ctx.on('approval/request', runtime.approvalListener(), {
                global: true,
                prepend: true,
            });
            const detachQuestions = ctx.on('user-questions/request', runtime.questionListener(), {
                global: true,
                prepend: true,
            });
            void (async () => {
                try {
                    if (config.autoStart === true || (await runtime.enabled()))
                        await runtime.start();
                    bootLog(home, 'apply: channel started');
                }
                catch (error) {
                    bootLog(home, `apply: start failed: ${describeError(error)}`);
                }
            })();
            return () => {
                try {
                    if (typeof detachStream === 'function')
                        detachStream();
                    if (typeof detachToolResults === 'function')
                        detachToolResults();
                    if (typeof detachApproval === 'function')
                        detachApproval();
                    if (typeof detachQuestions === 'function')
                        detachQuestions();
                    detachRoutes();
                    if (typeof detachTool === 'function')
                        detachTool();
                    runtime.stopTypingAll();
                    void runtime.flushReplies();
                    void runtime.halt();
                }
                catch (error) {
                    bootLog(home, `apply: teardown failed: ${describeError(error)}`);
                }
            };
        });
        bootLog(home, 'apply: mounted');
        console.error('dsh-wechat-plugin: channel mounted');
    }
    catch (error) {
        // Record before rethrowing: the desktop shell shows this failure once, in a
        // dialog it never writes to disk, so otherwise nothing survives to inspect.
        bootLog(home, `apply: FAILED: ${describeError(error)}`);
        if (error instanceof Error && error.stack)
            bootLog(home, `apply: stack:\n${error.stack}`);
        throw error;
    }
}
/**
 * Append a line to the channel's boot log.
 *
 * Best effort by design: diagnostics must never be the reason startup fails.
 *
 * @param home - DSH home directory.
 * @param line - Text to record.
 */
function bootLog(home, line) {
    try {
        const dir = join(home, 'wechat');
        mkdirSync(dir, { recursive: true });
        appendFileSync(join(dir, BOOT_LOG_NAME), `${new Date().toISOString()} ${line}\n`, 'utf-8');
    }
    catch {
        // Ignored: see above.
    }
}
/** Render an unknown throwable for logging, including its cause chain. */
function describeError(error) {
    if (!(error instanceof Error))
        return String(error);
    const cause = error.cause === undefined ? '' : ` <- cause: ${describeError(error.cause)}`;
    return `${error.name}: ${error.message}${cause}`;
}
/**
 * Record a browser-side failure in the boot log.
 *
 * Split out from the runtime so it can be tested directly: the whole point of this
 * log is to work when everything else has gone wrong, and that is not a property
 * worth assuming.
 *
 * @param home - DSH home directory.
 * @param scope - Which client phase failed.
 * @param message - Failure text.
 * @param stack - Stack trace, when the browser supplied one.
 */
export function recordClientFailure(home, scope, message, stack) {
    bootLog(home, `client[${scope}] FAILED: ${message}`);
    if (stack !== '')
        bootLog(home, `client[${scope}] stack:\n${stack}`);
}
/** Register the settings-page routes. Returns a disposer. */
function registerRoutes(ctx, runtime) {
    const webServer = ctx.get('webServer');
    if (webServer === undefined) {
        console.error('dsh-wechat-plugin: no webServer, settings routes unavailable');
        return () => { };
    }
    return webServer.register({
        kind: 'prefix',
        path: '/.dsh-wechat-plugin',
        handler: async (req, res) => {
            const url = new URL(req.url ?? '/', 'http://localhost');
            const route = url.pathname;
            try {
                if (route === ROUTE_STATUS && req.method === 'GET') {
                    return json(res, 200, await runtime.status());
                }
                if (route === ROUTE_DIAGNOSTICS && req.method === 'GET') {
                    return json(res, 200, (await runtime.status()).diagnostics);
                }
                if (route === ROUTE_SETTINGS && req.method === 'GET') {
                    return json(res, 200, await runtime.settingsForPage());
                }
                if (route === ROUTE_SETTINGS && req.method === 'POST') {
                    const patch = readSettingsPatch(await readJson(req));
                    const settings = await runtime.saveSettings(patch);
                    return json(res, 200, { settings });
                }
                if (route === ROUTE_DISCONNECT && req.method === 'POST') {
                    const body = await readJson(req);
                    const accountId = typeof body.accountId === 'string' ? body.accountId : '';
                    const disconnected = await runtime.disconnect(accountId);
                    return json(res, disconnected ? 200 : 404, {
                        disconnected,
                        status: await runtime.status(),
                    });
                }
                if (route === ROUTE_LOGIN_STATE && req.method === 'GET') {
                    return json(res, 200, runtime.loginState());
                }
                if (route === ROUTE_LOGIN_START && req.method === 'POST') {
                    return json(res, 200, await runtime.startLogin());
                }
                if (route === ROUTE_LOGIN_VERIFY && req.method === 'POST') {
                    const body = await readJson(req);
                    const code = typeof body.code === 'string' ? body.code : '';
                    const accepted = runtime.provideVerifyCode(code);
                    return json(res, accepted ? 200 : 409, { accepted });
                }
                if (route === ROUTE_LOGIN_CANCEL && req.method === 'POST') {
                    runtime.cancelLogin();
                    return json(res, 200, { cancelled: true });
                }
                if (route === ROUTE_TOGGLE && req.method === 'POST') {
                    const body = await readJson(req);
                    await runtime.setEnabled(body.enabled === true);
                    return json(res, 200, await runtime.status());
                }
                if (route === ROUTE_CLIENT_ERROR && req.method === 'POST') {
                    const body = await readJson(req);
                    const scope = typeof body.scope === 'string' ? body.scope : 'client';
                    const message = typeof body.message === 'string' ? body.message : '(无消息)';
                    const stack = typeof body.stack === 'string' ? body.stack : '';
                    runtime.recordClientError(scope, message, stack);
                    return json(res, 200, { recorded: true });
                }
                return json(res, 404, { error: 'not found' });
            }
            catch (error) {
                return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
            }
        },
    });
}
/**
 * Keep the usable fields of a settings patch.
 *
 * The request body is whatever the page sent, so a string where a number belongs would reach a
 * timer as NaN and disable it without an error anywhere. Fields of the wrong type are dropped
 * rather than defaulted, so a malformed request leaves the stored value alone.
 *
 * @param body - Parsed request body.
 * @returns A patch containing only well-typed fields.
 */
function readSettingsPatch(body) {
    const patch = {};
    for (const key of ['mergeWindowMs', 'maxReplyChars', 'settleMs', 'quoteHistory']) {
        const value = body[key];
        // The upper bounds are sanity limits, not format rules: a window of ten hours is a typo, and
        // a reply limit of a million characters makes every reply a file.
        const ceiling = key === 'maxReplyChars' ? 200_000 : 3_600_000;
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= ceiling) {
            patch[key] = Math.round(value);
        }
    }
    if (typeof body.autoReplyAttachments === 'boolean') {
        patch.autoReplyAttachments = body.autoReplyAttachments;
    }
    if (typeof body.requireConfirmation === 'boolean') {
        patch.requireConfirmation = body.requireConfirmation;
    }
    if (typeof body.presenceNote === 'string')
        patch.presenceNote = body.presenceNote;
    /*
     * Checked against the known values rather than passed through as any string: this value is handed
     * to DSH as a preset name, and a typo would reach the host as a missing preset instead of being
     * rejected here, where the mistake is still visible.
     */
    if (body.permissionPreset === 'danger-full-access' ||
        body.permissionPreset === 'auto' ||
        body.permissionPreset === 'default') {
        patch.permissionPreset = body.permissionPreset;
    }
    if (typeof body.allowCrossSessionNotify === 'boolean') {
        patch.allowCrossSessionNotify = body.allowCrossSessionNotify;
    }
    return patch;
}
function json(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(payload),
    });
    res.end(payload);
}
async function readJson(req) {
    const chunks = [];
    for await (const chunk of req)
        chunks.push(chunk);
    if (chunks.length === 0)
        return {};
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    }
    catch {
        return {};
    }
}
export { WechatRuntime };
//# sourceMappingURL=host.js.map