/**
 * Route contract between the host half and the settings page.
 *
 * The login handshake is a long-lived, interactive process (scan, maybe a
 * verification code, maybe a QR refresh), so it cannot live inside one HTTP
 * request. The host therefore owns a single login task and the page polls its
 * state, which also means the page can be closed and reopened mid-login.
 *
 * @module dsh-wechat/routes
 */
/** Route prefix registered on the DSH web server. */
export declare const ROUTE_PREFIX = "/.dsh-wechat-plugin";
/** `GET` — current channel status. */
export declare const ROUTE_STATUS = "/.dsh-wechat-plugin/status";
/** `POST { autoStart }` — turn the channel on or off. */
export declare const ROUTE_TOGGLE = "/.dsh-wechat-plugin/toggle";
/** `GET` — state of the running login task, including the QR payload. */
export declare const ROUTE_LOGIN_STATE = "/.dsh-wechat-plugin/login";
/** `POST` — start a login task. `{}` for a fresh one. */
export declare const ROUTE_LOGIN_START = "/.dsh-wechat-plugin/login/start";
/** `POST { code }` — answer a verification-code prompt. */
export declare const ROUTE_LOGIN_VERIFY = "/.dsh-wechat-plugin/login/verify";
/** `POST` — abandon the running login task. */
export declare const ROUTE_LOGIN_CANCEL = "/.dsh-wechat-plugin/login/cancel";
/** `GET` — tuned settings and their defaults; `POST` a patch to change them. */
export declare const ROUTE_SETTINGS = "/.dsh-wechat-plugin/settings";
/**
 * `GET` — log paths and the tail of the boot log.
 *
 * Exposed because the boot log is the only place a channel failure is recorded, and finding it
 * by hand means knowing an internal path under the DSH home.
 */
export declare const ROUTE_DIAGNOSTICS = "/.dsh-wechat-plugin/diagnostics";
/**
 * `POST { accountId }` — disconnect one WeChat account from this machine.
 *
 * Forgets the account's credentials, so restoring it needs a new scan. Guarded because it ends the
 * link the whole channel exists to provide.
 */
export declare const ROUTE_DISCONNECT = "/.dsh-wechat-plugin/disconnect";
/**
 * `POST { scope, message, stack }` — record a client-side boot failure.
 *
 * The settings page runs in the browser, where a throw is invisible to the host and
 * a broken boot leaves no trace. Reporting it here puts client failures in the same
 * log as host failures, which is the only way to diagnose a startup problem after
 * the error dialog is gone.
 */
export declare const ROUTE_CLIENT_ERROR = "/.dsh-wechat-plugin/client-error";
/** Wire shape of the login task state. */
export interface LoginState {
    /** `idle` before the first start, `running` while the handshake is live. */
    phase: 'idle' | 'running' | 'succeeded' | 'already-bound' | 'failed';
    /** Human-readable step, shown next to the QR code. */
    step?: string;
    /** Rendered QR payload, when one is on screen. */
    qrUrl?: string;
    /** PNG data URL for the same payload, ready for an `<img src>`. */
    qrDataUrl?: string;
    /** Set when the server demanded a pairing code. */
    awaitingVerifyCode?: boolean;
    /** Account id on success. */
    accountId?: string;
    /** Failure text. */
    error?: string;
    /** Login attempt counter, for diagnostics. */
    refreshed?: number;
}
/** Wire shape of the channel status. */
export interface ChannelStatus {
    /** Whether the channel is configured to run. */
    enabled: boolean;
    /** Logged-in accounts. */
    accounts: {
        accountId: string;
        userId?: string;
        /** True while this account's long poll is live. */
        polling: boolean;
    }[];
    /** Set when the token went stale and the account needs re-binding. */
    needsLogin: boolean;
    /** Recent error text, newest last. */
    errors: string[];
    /**
     * Paths and log tail for the settings page's diagnostics section.
     *
     * Sent with the status rather than fetched separately, so the page has somewhere to point the
     * user even when a dedicated request would itself be failing.
     */
    diagnostics: {
        /** Absolute path of the boot log. */
        logPath: string;
        /** Absolute path of the state file. */
        statePath: string;
        /** Session workspace folder. */
        workspace: string;
        /** Last lines of the boot log, oldest first. */
        logTail: string[];
    };
}
/**
 * Wire shape of the tuned settings.
 *
 * Every field is both readable and writable, so the page can show the effective value — defaults
 * included — without duplicating them.
 */
export interface SettingsPayload {
    allowedUsers: string[];
    mergeWindowMs: number;
    maxReplyChars: number;
    settleMs: number;
    quoteHistory: number;
    autoReplyAttachments: boolean;
    presenceNote: string;
}
//# sourceMappingURL=routes.d.ts.map