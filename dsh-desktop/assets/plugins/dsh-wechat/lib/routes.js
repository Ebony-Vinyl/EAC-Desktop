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
export const ROUTE_PREFIX = '/.dsh-wechat-plugin';
/** `GET` — current channel status. */
export const ROUTE_STATUS = `${ROUTE_PREFIX}/status`;
/** `POST { autoStart }` — turn the channel on or off. */
export const ROUTE_TOGGLE = `${ROUTE_PREFIX}/toggle`;
/** `GET` — state of the running login task, including the QR payload. */
export const ROUTE_LOGIN_STATE = `${ROUTE_PREFIX}/login`;
/** `POST` — start a login task. `{}` for a fresh one. */
export const ROUTE_LOGIN_START = `${ROUTE_PREFIX}/login/start`;
/** `POST { code }` — answer a verification-code prompt. */
export const ROUTE_LOGIN_VERIFY = `${ROUTE_PREFIX}/login/verify`;
/** `POST` — abandon the running login task. */
export const ROUTE_LOGIN_CANCEL = `${ROUTE_PREFIX}/login/cancel`;
/** `GET` — tuned settings and their defaults; `POST` a patch to change them. */
export const ROUTE_SETTINGS = `${ROUTE_PREFIX}/settings`;
/**
 * `GET` — log paths and the tail of the boot log.
 *
 * Exposed because the boot log is the only place a channel failure is recorded, and finding it
 * by hand means knowing an internal path under the DSH home.
 */
export const ROUTE_DIAGNOSTICS = `${ROUTE_PREFIX}/diagnostics`;
/**
 * `POST { accountId }` — disconnect one WeChat account from this machine.
 *
 * Forgets the account's credentials, so restoring it needs a new scan. Guarded because it ends the
 * link the whole channel exists to provide.
 */
export const ROUTE_DISCONNECT = `${ROUTE_PREFIX}/disconnect`;
/**
 * `POST { scope, message, stack }` — record a client-side boot failure.
 *
 * The settings page runs in the browser, where a throw is invisible to the host and
 * a broken boot leaves no trace. Reporting it here puts client failures in the same
 * log as host failures, which is the only way to diagnose a startup problem after
 * the error dialog is gone.
 */
export const ROUTE_CLIENT_ERROR = `${ROUTE_PREFIX}/client-error`;
//# sourceMappingURL=routes.js.map