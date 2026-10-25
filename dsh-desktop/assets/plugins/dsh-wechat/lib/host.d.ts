/**
 * Host half of the WeChat channel.
 *
 * It owns one long-poll monitor per logged-in bot account, routes inbound messages
 * into DSH sessions, and forwards assistant output back to the chat. All protocol
 * work lives in `@dsh-wechat/core`; this file is the glue to the host.
 *
 * @module dsh-wechat-plugin/host
 */
import { type ChannelSettings, type ChannelState, type InboundMessage, type SessionBinding, type WeixinAccount } from '@dsh-wechat/core';
import { type ChannelStatus, type LoginState } from './routes.ts';
import { type ApprovalOutcome, type QuestionAnswerBatch } from './interactions.ts';
import { type AssistantStreamPayload, type Disposer, type WechatContext } from './services.ts';
/** Cordis plugin name. */
export declare const name = "dsh-wechat-plugin";
/** Host services this plugin reads. A missing one keeps the plugin pending. */
export declare const inject: string[];
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
export declare function sessionToolDescription(requireConfirmation: boolean): string;
interface RuntimeOptions {
    /** DSH home. Used for the state file and the boot log. */
    home: string;
    stateFile: string;
    /** Session working directory. Must stay constant for the life of a session. */
    workspace: string;
    /** Identity reported to the service. */
    botAgent: string;
    /**
     * Outbound delivery. Defaults to the real iLink sender; tests substitute a
     * recorder so the whole pipeline can run without touching the network.
     */
    send?: SendFunction;
}
/** One outbound text delivery. */
export type SendFunction = (params: {
    account: WeixinAccount;
    to: string;
    text: string;
    contextToken?: string;
}) => Promise<unknown>;
/**
 * The whole channel at runtime: accounts, monitors, routing, and the outbound buffer.
 */
declare class WechatRuntime {
    #private;
    constructor(ctx: WechatContext, options: RuntimeOptions);
    /** Read the persisted state. */
    state(): Promise<ChannelState>;
    /** Whether the channel is armed to reconnect on boot. */
    enabled(): Promise<boolean>;
    /** Current status for the settings page. */
    status(): Promise<ChannelStatus>;
    /** Every binding that is still usable, plus the accounts it belongs to. */
    bindings(): Promise<SessionBinding[]>;
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
    controlSession(callerSessionId: string | undefined, action: string, target?: string): Promise<{
        ok: boolean;
        detail: string;
        sessions: {
            index: number;
            sessionId: string;
            title: string;
            updatedAt: number;
            current: boolean;
        }[];
        /** Sessions in other workspaces, which the list does not show unless asked. */
        otherWorkspaces: number;
        /** Folder names of those workspaces, so the hint can say which they are. */
        otherNames: string[];
    }>;
    /**
     * Tuned settings plus the defaults they fall back to, for the settings page.
     *
     * Both are sent whole: the page shows the effective value of every setting and offers a reset
     * to the defaults, so it needs to know both.
     */
    settingsForPage(): Promise<{
        settings: Required<ChannelSettings>;
        defaults: Required<ChannelSettings>;
    }>;
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
    disconnect(accountId: string): Promise<boolean>;
    /**
     * Per-account poll detail.
     *
     * Distinguishes an account whose poll is live from one whose monitor exists but has stopped —
     * the summary status cannot tell those apart, and with several accounts bound that is the
     * difference between "still working" and "silently dead".
     */
    accountDetail(): Promise<{
        accountId: string;
        userId?: string;
        polling: boolean;
        /** False when the token went stale and the account needs a new scan. */
        credentialsUsable: boolean;
        /** Conversations bound to this account. */
        bindings: number;
    }[]>;
    /** Current login task state. */
    loginState(): LoginState;
    /** Turn the channel on or off and persist the choice. */
    setEnabled(enabled: boolean): Promise<void>;
    /** Start a monitor for every stored account. Safe to call repeatedly. */
    start(): Promise<void>;
    /** Stop monitoring and tell the service we are going away. */
    stop(): Promise<void>;
    /** Tear everything down for plugin disposal. */
    halt(): Promise<void>;
    /**
     * Feed one inbound message through the channel's real pipeline.
     *
     * Exposed so tests — and any future in-process source of messages — can drive the
     * same path a WeChat delivery takes, without standing up a long poll.
     */
    ingest(message: InboundMessage): Promise<void>;
    /**
     * Run one login handshake to completion, driving the generator.
     *
     * The task outlives the HTTP request that started it, so the user can reload the
     * settings page — or close it — while still on the phone confirming the scan.
     */
    startLogin(): Promise<LoginState>;
    /** Answer a verification-code prompt. Returns false when nothing is waiting. */
    provideVerifyCode(code: string): boolean;
    /** Abandon the running login task. */
    cancelLogin(): void;
    /**
     * Persist a settings patch and refresh the cache.
     *
     * @param patch - Fields to change; absent fields keep their stored value.
     * @returns The settings after the change.
     */
    saveSettings(patch: ChannelSettings): Promise<Required<ChannelSettings>>;
    /**
     * Claim permission prompts for conversations bound to WeChat.
     *
     * Unbound conversations delegate, so the desktop pane answers as before.
     *
     * @returns The listener for `ctx.on('approval/request', ...)`.
     */
    approvalListener(): (request: unknown, next: () => Promise<ApprovalOutcome>) => Promise<ApprovalOutcome>;
    /**
     * Claim structured questions for conversations bound to WeChat.
     *
     * @returns The listener for `ctx.on('user-questions/request', ...)`.
     */
    questionListener(): (request: unknown, next: () => Promise<QuestionAnswerBatch>) => Promise<QuestionAnswerBatch>;
    /**
     * Register the tool the agent uses to send a file back to WeChat.
     *
     * This is what makes outbound media reachable at all. The client could already upload
     * and send an image — the functions existed — but nothing ever called them, so a file
     * the agent produced had no way out of the process and the phone saw nothing.
     *
     * @returns The disposer that unregisters the tool.
     */
    registerTools(): Disposer;
    /**
     * Re-register the session tool so its description reflects the current setting.
     *
     * Called after the confirmation preference changes. Without it the setting would appear to do
     * nothing until the next restart, because the agent reads the description, not the setting.
     */
    refreshSessionTool(): void;
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
    toolResultListener(): (exec: unknown, result: unknown) => void;
    /**
     * Close every tool card still open for a session.
     *
     * Called when a turn ends, so a card cannot outlive the work it describes regardless of
     * whether the harness's result event reached this plugin.
     *
     * @param sessionId - Session whose turn just finished.
     */
    closeOpenToolCards(sessionId: string): Promise<void>;
    /**
     * Feed one assistant stream frame into the reply buffer.
     *
     * DSH emits deltas as the model generates. Batching them behind a short quiet
     * window turns a stream into one coherent WeChat message instead of a burst of
     * fragments, which is what a chat transcript needs. A frame that ends the turn
     * flushes immediately rather than waiting out the window.
     */
    onAssistantFrame(payload: AssistantStreamPayload): void;
    /** Flush everything still buffered. Used on shutdown. */
    flushReplies(): Promise<void>;
    /**
     * Clear every "typing…" indicator and stop its refresh loop. Used on shutdown.
     *
     * Without this the intervals would outlive the plugin and keep calling a monitor that is being
     * torn down, and whichever conversations were mid-turn would be left showing "typing" forever.
     */
    stopTypingAll(): void;
    /**
     * Record a failure reported by the browser half.
     *
     * Written to the same boot log as host failures, because a client throw is
     * otherwise invisible: it happens in a page the host cannot observe, and the
     * settings page may never even mount.
     */
    recordClientError(scope: string, message: string, stack: string): void;
}
/** Plugin configuration from the loader patch. */
export interface WechatConfig {
    /** Reconnect stored accounts on boot. */
    autoStart?: boolean;
    /** Override the state file path. */
    stateFile?: string;
    /** Override the sessions' working directory. Changing it strands existing sessions. */
    workspace?: string;
    /** Identity reported to the service. */
    botAgent?: string;
}
/**
 * Mount the WeChat channel.
 *
 * @param ctx - Host context providing `sessionController` and `sessions`.
 * @param config - Patch configuration.
 * @param internals - Test seams. The loader never sets this.
 */
export declare function apply(ctx: WechatContext, config?: WechatConfig, internals?: {
    send?: SendFunction;
}): void;
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
export declare function recordClientFailure(home: string, scope: string, message: string, stack: string): void;
export { WechatRuntime };
//# sourceMappingURL=host.d.ts.map