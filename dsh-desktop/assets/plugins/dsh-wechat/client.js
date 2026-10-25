/**
 * Browser half of the settings page.
 *
 * This is a client plugin bundle. The shell registers it through
 * `window.__ModuleLoader__.load({ id, factory })`, and the factory receives a
 * `require` that resolves the platform baseline (React among it). The factory
 * returns the module exports directly, which is the documented shape.
 *
 * The page talks to the host half over the `/.dsh-wechat` routes, which is why the
 * login handshake lives on the host: the page can be closed and reopened mid-scan
 * without losing the QR code.
 *
 * The registration call is deliberately bare and runs at module scope. Wrapping it
 * in a guard would swallow a failure at precisely the moment nothing else can report
 * it: a client entry that never registers simply fails activation, with no trace
 * anywhere. Diagnostics therefore live inside the factory and `apply`, after
 * registration has already happened.
 */

const PREFIX = '/.dsh-wechat-plugin'

/**
 * Where the user guide lives, for the link in the settings page.
 *
 * A rendered GitHub page rather than the raw file: the handbook is long and full of tables, and this
 * is the reading-friendly form. Opened as an ordinary `target="_blank"` anchor, which the desktop
 * shell intercepts and hands to the system browser — the same way its own links work. A `window.open`
 * or a scripted navigation would be denied by that same handler, so the anchor is not a style
 * choice, it is the mechanism.
 */
const HANDBOOK_URL = 'https://github.com/xcisxc29/dsh-wechat/blob/main/docs/HANDBOOK-USER.md'

/** Report a client-side failure to the host, which writes it to the boot log. */
function reportFailure(scope, error) {
  try {
    const payload = JSON.stringify({
      scope,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error && typeof error.stack === 'string' ? error.stack : '',
    })
    // `sendBeacon` survives a page that is being torn down; fetch is the fallback.
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(`${PREFIX}/client-error`, new Blob([payload], { type: 'application/json' }))
      return
    }
    void fetch(`${PREFIX}/client-error`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Reporting must never be the reason the page fails.
  }
}

window.__ModuleLoader__.load({
  id: 'dsh-wechat-plugin',
  factory: (require) => {
    /**
     * Whether this plugin's settings section has rendered at least once.
     *
     * A bundle can load and register correctly yet still never produce a usable
     * page. That failure leaves no evidence anywhere, so the watchdog reports it.
     */
    let mountedOnce = false

    // Scheduled here rather than at module scope so the timer cannot interfere with
    // registration, which happens before any factory runs.
    try {
      setTimeout(() => {
        if (!mountedOnce) {
          reportFailure('mount', new Error('插件已加载，但设置页在 20 秒内没有渲染（看门狗触发）'))
        }
      }, 20_000)
    } catch {
      // A missing timer must not prevent loading.
    }

    const React = require('react')
    const h = React.createElement

    const copy = {
      zh: {
        nav: '微信',
        title: '微信遥控',
        intro: '用手机微信遥控这台电脑。扫码绑定一次，之后一直有效。',
        statusTitle: '通道状态',
        enabled: '启用通道',
        enabledHint: '关掉后不再接收微信消息，凭据保留。',
        accounts: '已绑定账号',
        noAccounts: '还没绑定。点下面的按钮扫码。',
        polling: '接收中',
        idle: '已停止',
        needsLogin: '凭据已失效，需要重新扫码。',
        loginTitle: '扫码绑定',
        loginStart: '开始扫码',
        loginAgain: '重新扫码',
        loginCancel: '取消',
        qrAlt: '微信登录二维码',
        qrHint: '用手机微信扫一扫，并在手机上确认。',
        verifyTitle: '需要配对验证码',
        verifyHint: '在手机上查看验证码后填入。',
        verifySubmit: '提交',
        verifyPlaceholder: '验证码',
        phaseSucceeded: '已连接微信',
        phaseAlreadyBound: '这个微信号之前绑过，继续用原有凭据',
        phaseFailed: '登录失败',
        errorsTitle: '最近错误',
        loading: '读取中…',
        loadFailed: '读取设置失败',
        retry: '重试',
        saveFailed: '保存失败',
        settingsTitle: '行为设置',
        settingsHint: '改完生效，不用重启。',
        groupConnection: '连接',
        groupConnectionHint: '开关通道、绑定微信账号。',
        groupBehaviour: '行为',
        groupBehaviourHint: '收到消息后怎么处理。',
        groupDiagnostics: '诊断',
        groupHelp: '帮助',
        helpTitle: '使用手册',
        helpHint: '安装、扫码、能发什么、设置逐条说明、排错——都在手册里。',
        helpOpen: '打开使用手册',
        groupCommands: '指令',
        commandsSlash: '斜杠指令',
        commandsSlashHint: '在微信里直接发送。不经过 agent，也不问确认，最快。',
        commandHelp: '显示指令列表',
        commandNew: '新建对话，可带标题',
        commandList: '列出所有对话',
        commandSwitch: '切换到第 N 个对话',
        commandCurrent: '显示当前对话',
        commandCancel: '中断当前任务',
        commandsSeparator: '分隔符可用「：」或直接省略，例如 /switch1。',
        commandsPlain: '说大白话也可以',
        commandsPlainHint:
          '直接说「换个对话」「看下有哪些对话」「停一下」等，任意说法都行。DSH 会先说明它要做什么，你同意后再执行——想跳过这一步，把上面的「指令操作前需要确认」关掉。',
        requireConfirmation: '指令操作前需要确认',
        requireConfirmationHint: '你说「换个对话」这类要求时，DSH 会先说它要做什么，等你同意再执行。',
        permissionPreset: '微信对话的权限',
        permissionPresetHint:
          '默认「完全访问」，DSH 执行命令时不再问你——问的话消息会发到微信，而任务会一直等着你回答。改这里只影响之后新建的对话。',
        permissionFull: '完全访问：不询问，直接执行',
        permissionAuto: '自动审核：电脑上判断',
        permissionProfile: '跟随 DSH 设置：和桌面端一样',
        allowCrossSessionNotify: '允许其他会话推送到微信',
        allowCrossSessionNotifyHint:
          '开启后，任何会话都能主动发消息或文件到你微信——包括你正在电脑上干活、它做完后通知你的情况。关掉则只有微信对话自己那个会话能发。',
        mergeWindow: '非文字消息等待时间（秒）',
        mergeWindowHint: '等多久。等待期间你发文字，就和附件一起处理；超时则只处理附件。',
        autoReplyAttachments: '等不到文字就自动处理附件',
        autoReplyAttachmentsHint: '关闭后，附件一直等你发文字，不自动回复。',
        maxReplyChars: '回复长度上限（字）',
        maxReplyCharsHint: '超长回复改发 .md 文件，不截断。',
        settleMs: '回复合并窗口（毫秒）',
        settleMsHint: '间隔小于这个值就合并成一条。调大更完整但更慢，调小更快但可能拆成多条。',
        quoteHistory: '引用缓存条数',
        quoteHistoryHint: '每个对话保留多少条已发消息，用来还原「引用」的内容。',
        presenceNote: '渠道身份提示',
        presenceNoteHint: '每条消息前都会附上，告诉 agent 你在手机上。不建议清空。',
        settingsSave: '保存设置',
        settingsSaved: '已保存',
        settingsReset: '恢复默认',
        disconnect: '断开连接',
        disconnectHint: '断开后要重新扫码才能连上。DSH 里的会话都保留。',
        disconnectConfirm: '确认断开？',
        diagnosticsTitle: '诊断',
        diagnosticsHint: '日志记录了通道的每一次收发与失败。',
        logPath: '日志文件',
        statePath: '状态文件',
        workspacePath: '会话工作目录',
        logTail: '日志末尾',
        noLog: '（暂无日志）',
      },
      en: {
        nav: 'WeChat',
        title: 'WeChat remote',
        intro: 'Control this machine from WeChat on your phone. Scan once to bind.',
        statusTitle: 'Channel',
        enabled: 'Enable channel',
        enabledHint: 'Off stops receiving WeChat messages; credentials are kept.',
        accounts: 'Bound accounts',
        noAccounts: 'Nothing bound yet. Scan with the button below.',
        polling: 'receiving',
        idle: 'stopped',
        needsLogin: 'Credentials expired. Scan again.',
        loginTitle: 'Scan to bind',
        loginStart: 'Start scanning',
        loginAgain: 'Scan again',
        loginCancel: 'Cancel',
        qrAlt: 'WeChat login QR code',
        qrHint: 'Scan with WeChat on your phone, then confirm there.',
        verifyTitle: 'Pairing code required',
        verifyHint: 'Check the code on your phone and enter it.',
        verifySubmit: 'Submit',
        verifyPlaceholder: 'Code',
        phaseSucceeded: 'Connected to WeChat',
        phaseAlreadyBound: 'Already bound; existing credentials kept',
        phaseFailed: 'Login failed',
        errorsTitle: 'Recent errors',
        loading: 'Loading…',
        loadFailed: 'Could not read the settings',
        retry: 'Retry',
        saveFailed: 'Could not save',
        settingsTitle: 'Behaviour',
        settingsHint: 'Applies at once; no restart.',
        groupConnection: 'Connection',
        groupConnectionHint: 'Switch the channel and bind a WeChat account.',
        groupBehaviour: 'Behaviour',
        groupBehaviourHint: 'How incoming messages are handled.',
        groupDiagnostics: 'Diagnostics',
        groupHelp: 'Help',
        helpTitle: 'User guide',
        helpHint:
          'Installing, scanning, what can be sent, every setting, and troubleshooting — all of it is in the guide.',
        helpOpen: 'Open the user guide',
        groupCommands: 'Commands',
        commandsSlash: 'Slash commands',
        commandsSlashHint: 'Sent straight from WeChat. They skip the agent and need no confirmation, so they are the fastest route.',
        commandHelp: 'Show the command list',
        commandNew: 'Start a new conversation, optionally titled',
        commandList: 'List every conversation',
        commandSwitch: 'Move to conversation number N',
        commandCurrent: 'Show the conversation in use',
        commandCancel: 'Interrupt the running task',
        commandsSeparator: 'The separator may be «：» or omitted entirely, as in /switch1.',
        commandsPlain: 'Plain words work too',
        commandsPlainHint:
          'Just say «switch conversation», «show me my conversations», «stop», or whatever comes naturally. DSH says what it intends to do first and waits for you to agree — turn off «Confirm before acting» above to skip that step.',
        requireConfirmation: 'Confirm before acting on a request',
        requireConfirmationHint:
          'When you ask for something like «switch conversation», DSH first says what it will do and waits for you to agree.',
        permissionPreset: 'Permissions for WeChat conversations',
        permissionPresetHint:
          'Defaults to full access, so DSH does not ask before running a command — the prompt would arrive in WeChat and the task would wait for your answer. Changing this affects conversations created afterwards.',
        permissionFull: 'Full access: run without asking',
        permissionAuto: 'Automatic review: decided on this computer',
        permissionProfile: 'Follow the DSH setting, same as the desktop',
        allowCrossSessionNotify: 'Let other sessions push to WeChat',
        allowCrossSessionNotifyHint:
          'On, any session may send you a message or a file — which is how a task that finishes while you are away can still reach you. Off, only the session the WeChat conversation is bound to may send.',
        mergeWindow: 'Wait after a non-text message (seconds)',
        mergeWindowHint:
          'How long to wait. Text sent during the wait is handled with the attachment; after it, only the attachment.',
        autoReplyAttachments: 'Handle attachments if no text arrives',
        autoReplyAttachmentsHint:
          'Off means an attachment waits for your text instead of being answered on its own.',
        maxReplyChars: 'Reply length limit (characters)',
        maxReplyCharsHint: 'A longer reply is sent as a .md file rather than cut short.',
        settleMs: 'Reply merge window (ms)',
        settleMsHint:
          'Gaps smaller than this merge into one message. Larger is more complete but slower; smaller is faster but may split.',
        quoteHistory: 'Quoted-message cache size',
        quoteHistoryHint: 'How many sent messages to keep per conversation, so quotes resolve.',
        presenceNote: 'Channel note',
        presenceNoteHint: 'Prepended to every message, telling the agent you are on a phone.',
        settingsSave: 'Save',
        settingsSaved: 'Saved',
        settingsReset: 'Reset to defaults',
        disconnect: 'Disconnect',
        disconnectHint: 'Reconnecting needs a new scan. Sessions and their contents stay.',
        disconnectConfirm: 'Disconnect?',
        diagnosticsTitle: 'Diagnostics',
        diagnosticsHint: 'The log records every send, receive, and failure.',
        logPath: 'Log file',
        statePath: 'State file',
        workspacePath: 'Session workspace',
        logTail: 'End of the log',
        noLog: '(no log yet)',
      },
    }

    /** Follow the app's resolved locale, falling back to the browser's. */
    function text() {
      const lang = `${document.documentElement?.lang || ''}${navigator.language || ''}`
      return lang.toLowerCase().startsWith('zh') ? copy.zh : copy.en
    }

    /** One JSON request against the channel's own routes. */
    async function request(path, options) {
      const response = await fetch(path, {
        cache: 'no-store',
        ...options,
        headers: {
          accept: 'application/json',
          ...(options?.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(options?.headers ?? {}),
        },
      })
      const raw = await response.text()
      let body
      try {
        body = raw ? JSON.parse(raw) : {}
      } catch {
        body = { error: raw.slice(0, 200) }
      }
      if (!response.ok) {
        const error = new Error(body?.error || `HTTP ${response.status}`)
        error.status = response.status
        throw error
      }
      return body
    }

    /*
     * Every value below comes from the DSH design tokens the rest of the app uses, so this page
     * sits in the same visual system rather than beside it. The reference is the shipped
     * primitives: Button, Switch, Pill, Tag and the settings-form fields. Mixing in `currentColor`
     * opacities looked close but never matched, because the app's greys are tokens, not tints.
     */
    const styles = `
.dsh-wechat { display: flex; flex-direction: column; gap: 26px; max-width: 680px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary); }
.dsh-wechat h2 { margin: 0; font-size: 16px; font-weight: 600; line-height: 1.4; }
.dsh-wechat h3 { margin: 0; font-size: 13px; font-weight: 500; line-height: 1.5; }
.dsh-wechat p { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }

/* Header: title above a single line of context, the way a settings page opens. */
.dsh-wechat-header { display: flex; flex-direction: column; gap: 4px; }
.dsh-wechat-lead { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary); }

/* Groups are plain bands with a small heading. The app has no boxed sections, so neither does
   this page: separation comes from spacing and a heading, not from a container. */
.dsh-wechat-group { display: flex; flex-direction: column; gap: 4px; }
.dsh-wechat-group-head { display: flex; align-items: baseline; gap: 8px; }
.dsh-wechat-group-title { font-size: 12px; font-weight: 600; line-height: 1.5; color: var(--dsw-alias-label-secondary); }
.dsh-wechat-group-hint { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.dsh-wechat-group-body { display: flex; flex-direction: column; gap: 16px; }

/* A card is a subtle surface, not a bordered panel: 0.5px is the app's hairline everywhere. */
.dsh-wechat-card { display: flex; flex-direction: column; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg); padding: 4px 14px; background: var(--dsw-alias-bg-layer-2); }
.dsh-wechat-card > h3 { padding: 12px 0 2px; font-size: 13px; font-weight: 600; }
/* A second heading inside one card separates two sub-sections, so it needs the room a first
   heading gets from the card's own edge. */
.dsh-wechat-card > h3 ~ h3 { padding-top: 20px; }
.dsh-wechat-card > p { padding-bottom: 6px; }

/* Rows and fields are the settings-form pattern: padded, with a hairline between them. */
.dsh-wechat-row { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 12px 0; }
.dsh-wechat-row-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dsh-wechat-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
.dsh-wechat-field > label { font-size: 13px; font-weight: 500; line-height: 1.5; color: var(--dsw-alias-label-primary); }
.dsh-wechat-row + .dsh-wechat-row,
.dsh-wechat-field + .dsh-wechat-field,
.dsh-wechat-field + .dsh-wechat-row,
.dsh-wechat-row + .dsh-wechat-field { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.dsh-wechat-card > :first-child { padding-top: 12px; }
.dsh-wechat-card > :last-child { padding-bottom: 12px; }

/* Switch: the shipped geometry, keyed off aria-checked so it cannot disagree with the state. */
.dsh-wechat-switch { box-sizing: border-box; position: relative; flex: 0 0 auto; width: 36px; height: 20px; padding: 2px; border: 0; border-radius: 999px; background: var(--dsw-alias-border-l3); cursor: pointer; transition: background 120ms ease; }
.dsh-wechat-switch::after { content: ''; display: block; width: 16px; height: 16px; border-radius: 50%; background: var(--dsw-alias-switch-thumb); transition: transform 120ms ease; }
.dsh-wechat-switch[aria-checked='true'] { background: var(--dsw-alias-brand-primary); }
.dsh-wechat-switch[aria-checked='true']::after { background: var(--dsw-alias-label-primary-foreground); transform: translateX(16px); }
.dsh-wechat-switch:disabled { cursor: default; opacity: .5; }
.dsh-wechat-switch:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }

.dsh-wechat-button { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 28px; padding: 0 10px; border: 0; border-radius: var(--dsw-radius-sm); font: inherit; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-primary); background: transparent; cursor: pointer; }
.dsh-wechat-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-wechat-button:active:not(:disabled) { background: var(--dsw-alias-interactive-bg-active); }
.dsh-wechat-button:disabled { cursor: not-allowed; opacity: .4; }
.dsh-wechat-button:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
.dsh-wechat-outline { border: 0.5px solid var(--dsw-alias-border-l3); }
/* The same button, rendered as an anchor so the shell's link handler picks it up. */
a.dsh-wechat-button { text-decoration: none; }
.dsh-wechat-primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
.dsh-wechat-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.dsh-wechat-danger { color: var(--dsw-alias-state-error-primary); border: 0.5px solid var(--dsw-alias-border-l3); }
.dsh-wechat-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }

.dsh-wechat-input { box-sizing: border-box; height: 34px; padding: 0 12px; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3); font: inherit; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary); }
.dsh-wechat-input::placeholder { color: var(--dsw-alias-label-dimmed); }
.dsh-wechat-input:focus-visible { outline: none; border-color: var(--dsw-alias-state-business-primary); }
.dsh-wechat-input:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.dsh-wechat-field input[type='number'], .dsh-wechat-field input[type='text'] { max-width: 240px; }
.dsh-wechat-field input[type='number'] { max-width: 104px; }
.dsh-wechat-field textarea { box-sizing: border-box; padding: 8px 12px; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3); font: inherit; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-primary); min-height: 84px; resize: vertical; }
.dsh-wechat-field textarea:focus-visible { outline: none; border-color: var(--dsw-alias-state-business-primary); }

.dsh-wechat-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 12px 0; }
.dsh-wechat-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.dsh-wechat-ok { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-state-success-primary); }
.dsh-wechat-error { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-state-error-primary); }
.dsh-wechat-errors { margin: 0; padding: 0 0 0 18px; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }

/* Pills and badges follow Tag/Pill: capsule, token background, one size everywhere. */
.dsh-wechat-pill { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border-radius: 999px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-2); }
.dsh-wechat-pill::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-label-tertiary); }
.dsh-wechat-pill.is-warn::before { background: var(--dsw-alias-state-warn-primary); }
.dsh-wechat-pill.is-ok::before { background: var(--dsw-alias-state-success-primary); }
.dsh-wechat-badge { display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px; font-size: 11px; line-height: 17px; font-weight: 500; white-space: nowrap; color: var(--dsw-alias-label-tertiary); border: 0.5px solid var(--dsw-alias-border-l4); }
.dsh-wechat-badge.is-on { color: var(--dsw-alias-state-success-primary); border-color: transparent; background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); }

.dsh-wechat-qr { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 12px 0; }
.dsh-wechat-qr img { width: 200px; height: 200px; image-rendering: pixelated; background: #fff; border-radius: var(--dsw-radius-lg); padding: 8px; }
.dsh-wechat-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.dsh-wechat-list li { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 10px 0; font-size: 13px; }
.dsh-wechat-list li + li { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.dsh-wechat-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--dsw-alias-label-tertiary); }

.dsh-wechat-log { max-height: 240px; overflow: auto; margin: 0; padding: 10px 12px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-3); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; line-height: 1.5; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; word-break: break-all; }
/* Facts: a fixed label column so values line up instead of ragging right. */
.dsh-wechat-facts { display: flex; flex-direction: column; gap: 8px; padding: 12px 0; }
.dsh-wechat-fact { display: grid; grid-template-columns: 92px 1fr; gap: 12px; align-items: baseline; font-size: 12px; }
.dsh-wechat-fact > dt { color: var(--dsw-alias-label-tertiary); }
.dsh-wechat-fact > dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--dsw-alias-label-secondary); word-break: break-all; }
.dsh-wechat-path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--dsw-alias-label-secondary); word-break: break-all; text-align: right; }

/* The command reference: a definition list so a command and its meaning line up. */
.dsh-wechat-commands { display: flex; flex-direction: column; margin: 0; padding: 0; }
.dsh-wechat-command { display: grid; grid-template-columns: 132px 1fr; gap: 12px; align-items: baseline; padding: 8px 0; font-size: 12px; line-height: 1.6; }
.dsh-wechat-command + .dsh-wechat-command { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.dsh-wechat-command > dt { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--dsw-alias-label-primary); }
.dsh-wechat-command > dd { margin: 0; color: var(--dsw-alias-label-secondary); }

.dsh-wechat-link { border: 0; background: none; padding: 0; font: inherit; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.dsh-wechat-link:hover { color: var(--dsw-alias-label-primary); }
`

    /**
     * Install the stylesheet for the life of the plugin.
     *
     * Returns its own cleanup. The client-plugin rules require `apply` to own every
     * resource it adds and to hand back disposers, so a disabled or reloaded plugin
     * leaves no orphaned `<style>` behind.
     */
    function installStyles() {
      const existing = document.getElementById('dsh-wechat-style')
      if (existing !== null) return () => {}
      const style = document.createElement('style')
      style.id = 'dsh-wechat-style'
      style.textContent = styles
      document.head.append(style)
      return () => {
        style.remove?.()
      }
    }

    function Toggle(props) {
      return h('button', {
        type: 'button',
        role: 'switch',
        // The visual state keys off `aria-checked`, matching the app's own switch, so the two can
        // never disagree.
        'aria-checked': props.checked ? 'true' : 'false',
        'aria-label': props.label,
        disabled: props.disabled,
        className: 'dsh-wechat-switch',
        onClick: () => {
          if (props.disabled !== true) props.onChange(!props.checked)
        },
      })
    }

    function Card(props) {
      return h('section', { className: 'dsh-wechat-card' }, props.children)
    }

    /**
     * One titled group of cards.
     *
     * The page had grown into an unlabelled stack where unrelated settings sat side by side with
     * nothing to say they were different kinds of decision. Grouping is what makes the page
     * readable at a glance.
     */
    function Group(props) {
      return h(
        'section',
        { className: 'dsh-wechat-group' },
        h(
          'header',
          { className: 'dsh-wechat-group-head' },
          h('h3', { className: 'dsh-wechat-group-title' }, props.title),
          props.hint ? h('p', { className: 'dsh-wechat-group-hint' }, props.hint) : null,
        ),
        h('div', { className: 'dsh-wechat-group-body' }, props.children),
      )
    }

    function WechatSettings() {
      const [state, setState] = React.useState({
        phase: 'loading',
        error: '',
        status: undefined,
        login: { phase: 'idle' },
        /** Effective settings, plus the defaults the reset button restores. */
        settings: undefined,
        defaults: undefined,
        /**
         * Editable copy of the settings.
         *
         * Held separately from `settings` so a change is only sent when Save is pressed — typing
         * into a field that saved on every keystroke would rewrite the state file per character.
         */
        draft: undefined,
        saved: false,
        busy: false,
        verifyCode: '',
      })

      // Tell the watchdog that this page really renders. Setting it here is what
      // distinguishes "loaded but blank" from a working settings section.
      mountedOnce = true

      // Re-render when the shell changes the page language.
      const [, bump] = React.useState(0)
      React.useEffect(() => {
        if (typeof MutationObserver !== 'function' || !document.documentElement) return undefined
        const observer = new MutationObserver(() => bump((count) => count + 1))
        observer.observe(document.documentElement, { attributeFilter: ['lang'] })
        return () => observer.disconnect()
      }, [])

      const load = React.useCallback(async () => {
        try {
          // Settled, not all: one unavailable route must not blank the whole page. The settings
          // and diagnostics sections are the newest and most optional, and a load that fails
          // entirely because of them would take the channel switch down with it.
          const [status, login, settings] = await Promise.allSettled([
            request(`${PREFIX}/status`),
            request(`${PREFIX}/login`),
            request(`${PREFIX}/settings`),
          ]).then((results) =>
            results.map((result) => (result.status === 'fulfilled' ? result.value : undefined)),
          )

          // Status is the one the page cannot do without, so its failure is still fatal.
          if (status === undefined) throw new Error('status unavailable')

          setState((prev) => ({
            ...prev,
            phase: 'ready',
            error: '',
            status,
            login: login ?? prev.login,
            settings: settings?.settings,
            defaults: settings?.defaults,
            // A reload discards an in-progress edit, which is the honest behaviour: what is shown
            // is what is stored.
            draft: settings?.settings ?? prev.draft,
          }))
        } catch (error) {
          reportFailure('load', error)
          setState((prev) => ({
            ...prev,
            phase: 'error',
            error: error instanceof Error ? error.message : String(error),
          }))
        }
      }, [])

      React.useEffect(() => {
        void load()
        // Poll while a QR code is on screen, and refresh when the tab regains focus.
        const timer = setInterval(() => {
          setState((prev) => {
            if (prev.phase !== 'ready') return prev
            if (prev.login?.phase !== 'running') return prev
            void refreshLogin()
            return prev
          })
        }, 1500)
        const onFocus = () => {
          void load()
        }
        window.addEventListener?.('focus', onFocus)
        return () => {
          clearInterval(timer)
          window.removeEventListener?.('focus', onFocus)
        }
      }, [load])

      /** Cheap refresh used by the poll: only the login task and status change often. */
      const refreshLogin = React.useCallback(async () => {
        try {
          const [login, status] = await Promise.all([
            request(`${PREFIX}/login`),
            request(`${PREFIX}/status`),
          ])
          setState((prev) => ({ ...prev, login, status }))
        } catch {
          // Polling failures are noise; the visible error path is the explicit load.
        }
      }, [])

      const t = text()

      async function startLogin() {
        setState((prev) => ({ ...prev, busy: true, verifyCode: '' }))
        try {
          const login = await request(`${PREFIX}/login/start`, { method: 'POST', body: '{}' })
          setState((prev) => ({ ...prev, login, busy: false }))
        } catch (error) {
          reportFailure('login', error)
          setState((prev) => ({
            ...prev,
            busy: false,
            error: error instanceof Error ? error.message : String(error),
          }))
        }
      }

      async function cancelLogin() {
        await request(`${PREFIX}/login/cancel`, { method: 'POST', body: '{}' })
        await refreshLogin()
      }

      async function submitVerify() {
        const code = state.verifyCode.trim()
        if (code === '') return
        setState((prev) => ({ ...prev, busy: true }))
        try {
          await request(`${PREFIX}/login/verify`, {
            method: 'POST',
            body: JSON.stringify({ code }),
          })
          setState((prev) => ({ ...prev, busy: false, verifyCode: '' }))
          await refreshLogin()
        } catch (error) {
          setState((prev) => ({
            ...prev,
            busy: false,
            error: error instanceof Error ? error.message : String(error),
          }))
        }
      }

      /** Post one action and fold the returned status back in. */
      async function act(path, body) {
        setState((prev) => ({ ...prev, busy: true }))
        try {
          const result = await request(path, { method: 'POST', body: JSON.stringify(body) })
          setState((prev) => ({
            ...prev,
            busy: false,
            ...(result?.status === undefined ? {} : { status: result.status }),
          }))
        } catch (error) {
          setState((prev) => ({
            ...prev,
            busy: false,
            error: error instanceof Error ? error.message : String(error),
          }))
        }
      }

      async function toggle(enabled) {
        await act(`${PREFIX}/toggle`, { enabled })
      }

      async function saveSettings() {
        if (state.draft === undefined) return
        setState((prev) => ({ ...prev, busy: true, saved: false }))
        try {
          const result = await request(`${PREFIX}/settings`, {
            method: 'POST',
            body: JSON.stringify(state.draft),
          })
          const saved = result?.settings ?? state.draft
          setState((prev) => ({ ...prev, busy: false, saved: true, settings: saved, draft: saved }))
          // The confirmation is transient: it describes one save, not a state of the form.
          setTimeout(() => setState((prev) => ({ ...prev, saved: false })), 2500)
        } catch (error) {
          setState((prev) => ({
            ...prev,
            busy: false,
            error: error instanceof Error ? error.message : String(error),
          }))
        }
      }

      /**
       * End the link between one WeChat account and DSH.
       *
       * Different from switching the channel off: that only stops listening and can be turned back
       * on, while this forgets the credentials and needs a new scan.
       */
      async function disconnect(accountId) {
        await act(`${PREFIX}/disconnect`, { accountId })
      }

      /** One editable field, with its label and explanation. */
      function field(label, hint, control) {
        return h(
          'div',
          { className: 'dsh-wechat-field' },
          h('label', null, label),
          control,
          hint ? h('span', { className: 'dsh-wechat-hint' }, hint) : null,
        )
      }

      /** Patch one draft field, leaving the rest of the form alone. */
      function edit(key, value) {
        setState((prev) => ({ ...prev, draft: { ...(prev.draft ?? {}), [key]: value } }))
      }

      if (state.phase === 'loading') {
        return h('div', { className: 'dsh-wechat' }, h('p', null, t.loading))
      }
      if (state.phase === 'error') {
        return h(
          'div',
          { className: 'dsh-wechat' },
          h('p', { className: 'dsh-wechat-error', role: 'alert' }, `${t.loadFailed}: ${state.error}`),
          h('button', { type: 'button', className: 'dsh-wechat-button dsh-wechat-outline', onClick: () => void load() }, t.retry),
        )
      }

      const status = state.status ?? { enabled: false, accounts: [], needsLogin: false, errors: [] }
      const login = state.login ?? { phase: 'idle' }

      return h(
        'div',
        { className: 'dsh-wechat' },
        h(
          'div',
          { className: 'dsh-wechat-header' },
          h('h2', null, t.title),
          h('p', { className: 'dsh-wechat-lead' }, t.intro),
        ),

        state.error
          ? h('p', { className: 'dsh-wechat-error', role: 'alert' }, `${t.saveFailed}: ${state.error}`)
          : null,

        /*
         * The guide, first.
         *
         * It answers the questions the settings themselves raise — how to install, what each switch
         * does, why a message did not arrive — so it belongs above them rather than after the
         * diagnostics, which is where a docs link usually ends up and where nobody looks until they
         * have already given up.
         *
         * An ordinary `target="_blank"` anchor, and that is the mechanism rather than a style
         * choice: it is what the desktop shell intercepts and hands to the system browser, while
         * `window.open` and scripted navigation are denied by the same handler.
         */
        h(
          Group,
          { title: t.groupHelp },
          h(
            Card,
            null,
            h('h3', null, t.helpTitle),
            h('span', { className: 'dsh-wechat-hint' }, t.helpHint),
            h(
              'p',
              { className: 'dsh-wechat-actions' },
              h(
                'a',
                {
                  className: 'dsh-wechat-button dsh-wechat-outline',
                  href: HANDBOOK_URL,
                  target: '_blank',
                  rel: 'noopener noreferrer',
                },
                t.helpOpen,
              ),
            ),
          ),
        ),

        // Connection: what is bound, and how to bind more.
        h(
          Group,
          { title: t.groupConnection, hint: t.groupConnectionHint },
          // Channel switch and bound accounts.
          h(
            Card,
            null,
            h(
              'div',
              { className: 'dsh-wechat-row' },
              h(
                'div',
                { className: 'dsh-wechat-row-text' },
                h('h3', null, t.statusTitle),
                h('span', { className: 'dsh-wechat-hint' }, t.enabledHint),
              ),
              h(Toggle, {
                checked: status.enabled === true,
                label: t.enabled,
                disabled: state.busy,
                onChange: (next) => void toggle(next),
              }),
            ),
            h('h3', null, t.accounts),
            status.accounts.length === 0
              ? h('p', null, t.noAccounts)
              : h(
                  'ul',
                  { className: 'dsh-wechat-list' },
                  ...status.accounts.map((account) =>
                    h(
                      'li',
                      { key: account.accountId },
                      h(
                        'span',
                        null,
                        h('span', { className: 'dsh-wechat-mono' }, account.accountId),
                        account.userId
                          ? h('span', { className: 'dsh-wechat-mono' }, ` ← ${account.userId}`)
                          : null,
                      ),
                      h(
                        'span',
                        { className: `dsh-wechat-badge${account.polling ? ' is-on' : ''}` },
                        account.polling ? t.polling : t.idle,
                      ),
                      // Ends the link itself, which the channel switch does not: switching off only
                      // stops listening, while this forgets the account and needs a new scan.
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsh-wechat-button dsh-wechat-danger',
                          disabled: state.busy,
                          onClick: () => disconnect(account.accountId),
                        },
                        t.disconnect,
                      ),
                    ),
                  ),
                ),
            status.accounts.length > 0
              ? h('p', { className: 'dsh-wechat-hint' }, t.disconnectHint)
              : null,
            status.needsLogin ? h('p', { className: 'dsh-wechat-error' }, t.needsLogin) : null,
          ),

        // Login: QR code, verification code, terminal states.
        h(
          Card,
          null,
          h('h3', null, t.loginTitle),
          login.phase === 'running' && login.qrDataUrl
            ? h(
                'div',
                { className: 'dsh-wechat-qr' },
                h('img', { src: login.qrDataUrl, alt: t.qrAlt, width: 220, height: 220 }),
                h('p', null, login.step || t.qrHint),
              )
            : h('p', null, login.step || t.qrHint),

          login.awaitingVerifyCode
            ? h(
                'div',
                null,
                h('h3', null, t.verifyTitle),
                field(
                  t.verifyPlaceholder,
                  t.verifyHint,
                  h('div', { className: 'dsh-wechat-actions' },
                    h('input', {
                      className: 'dsh-wechat-input',
                      value: state.verifyCode,
                      placeholder: t.verifyPlaceholder,
                      onChange: (event) =>
                        setState((prev) => ({ ...prev, verifyCode: event.target.value })),
                      onKeyDown: (event) => {
                        if (event.key === 'Enter') void submitVerify()
                      },
                    }),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dsh-wechat-button dsh-wechat-primary',
                        disabled: state.busy,
                        onClick: () => void submitVerify(),
                      },
                      t.verifySubmit,
                    ),
                  ),
                ),
              )
            : null,

          login.phase === 'succeeded'
            ? h('p', null, `${t.phaseSucceeded}${login.accountId ? `：${login.accountId}` : ''}`)
            : null,
          login.phase === 'already-bound' ? h('p', null, t.phaseAlreadyBound) : null,
          login.phase === 'failed'
            ? h('p', { className: 'dsh-wechat-error' }, `${t.phaseFailed}: ${login.error ?? ''}`)
            : null,

          h(
            'div',
            { className: 'dsh-wechat-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-wechat-button dsh-wechat-primary',
                disabled: state.busy || login.phase === 'running',
                onClick: () => void startLogin(),
              },
              status.accounts.length > 0 ? t.loginAgain : t.loginStart,
            ),
            login.phase === 'running'
              ? h(
                  'button',
                  { type: 'button', className: 'dsh-wechat-button dsh-wechat-outline', onClick: () => void cancelLogin() },
                  t.loginCancel,
                )
              : null,
          ),
        ),
        ),

        // Tuned behaviour. Everything here applies without a restart.
        state.draft !== undefined
          ? h(
              Group,
              { title: t.groupBehaviour, hint: t.groupBehaviourHint },
              h(
              Card,
              null,
              h('h3', null, t.settingsTitle),
              h('p', null, t.settingsHint),

              /*
               * The permission preset, as a select.
               *
               * It sits first because it is the setting people come here to change: a session that
               * asks before every tool call sends a permission prompt to WeChat and then waits, which
               * on a phone means the task stalls until the user answers a conversation. The channel's
               * sessions therefore default to full access, and this is where that is turned off.
               *
               * It only affects sessions created after the change; DSH locks a preset once a session's
               * first turn has begun, which the hint says out loud rather than leaving as a surprise.
               */
              field(
                t.permissionPreset,
                t.permissionPresetHint,
                h(
                  'select',
                  {
                    className: 'dsh-wechat-input',
                    value: state.draft.permissionPreset ?? 'danger-full-access',
                    onChange: (event) => edit('permissionPreset', event.target.value),
                  },
                  h('option', { value: 'danger-full-access' }, t.permissionFull),
                  h('option', { value: 'auto' }, t.permissionAuto),
                  h('option', { value: 'default' }, t.permissionProfile),
                ),
              ),

              /*
               * On by default, unlike every other toggle here that widens access, because the feature
               * is useless otherwise: the whole point is to hear about work that finished after the
               * user left the desk, and the session doing that work is usually not the bound one.
               */
              h(
                'div',
                { className: 'dsh-wechat-row' },
                h(
                  'div',
                  { className: 'dsh-wechat-row-text' },
                  h('label', null, t.allowCrossSessionNotify),
                  h('span', { className: 'dsh-wechat-hint' }, t.allowCrossSessionNotifyHint),
                ),
                h(Toggle, {
                  checked: state.draft.allowCrossSessionNotify === true,
                  label: t.allowCrossSessionNotify,
                  disabled: state.busy,
                  onChange: (next) => edit('allowCrossSessionNotify', next),
                }),
              ),

              h(
                'div',
                { className: 'dsh-wechat-row' },
                h(
                  'div',
                  { className: 'dsh-wechat-row-text' },
                  h('label', null, t.requireConfirmation),
                  h('span', { className: 'dsh-wechat-hint' }, t.requireConfirmationHint),
                ),
                h(Toggle, {
                  checked: state.draft.requireConfirmation === true,
                  label: t.requireConfirmation,
                  disabled: state.busy,
                  onChange: (next) => edit('requireConfirmation', next),
                }),
              ),

              field(
                t.mergeWindow,
                t.mergeWindowHint,
                h('input', {
                  type: 'number',
                  min: 0,
                  max: 600,
                  className: 'dsh-wechat-input',
                  value: Math.round((state.draft.mergeWindowMs ?? 0) / 1000),
                  onChange: (event) => edit('mergeWindowMs', Number(event.target.value) * 1000),
                }),
              ),

              h(
                'div',
                { className: 'dsh-wechat-row' },
                h(
                  'div',
                  { className: 'dsh-wechat-row-text' },
                  h('label', null, t.autoReplyAttachments),
                  h('span', { className: 'dsh-wechat-hint' }, t.autoReplyAttachmentsHint),
                ),
                h(Toggle, {
                  checked: state.draft.autoReplyAttachments === true,
                  label: t.autoReplyAttachments,
                  disabled: state.busy,
                  onChange: (next) => edit('autoReplyAttachments', next),
                }),
              ),

              field(
                t.maxReplyChars,
                t.maxReplyCharsHint,
                h('input', {
                  type: 'number',
                  min: 0,
                  className: 'dsh-wechat-input',
                  value: state.draft.maxReplyChars ?? 0,
                  onChange: (event) => edit('maxReplyChars', Number(event.target.value)),
                }),
              ),

              field(
                t.settleMs,
                t.settleMsHint,
                h('input', {
                  type: 'number',
                  min: 0,
                  className: 'dsh-wechat-input',
                  value: state.draft.settleMs ?? 0,
                  onChange: (event) => edit('settleMs', Number(event.target.value)),
                }),
              ),

              field(
                t.quoteHistory,
                t.quoteHistoryHint,
                h('input', {
                  type: 'number',
                  min: 0,
                  className: 'dsh-wechat-input',
                  value: state.draft.quoteHistory ?? 0,
                  onChange: (event) => edit('quoteHistory', Number(event.target.value)),
                }),
              ),

              field(
                t.presenceNote,
                t.presenceNoteHint,
                h('textarea', {
                  rows: 4,
                  value: state.draft.presenceNote ?? '',
                  onChange: (event) => edit('presenceNote', event.target.value),
                }),
              ),

              h(
                'div',
                { className: 'dsh-wechat-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-wechat-button dsh-wechat-primary',
                    disabled: state.busy,
                    onClick: () => void saveSettings(),
                  },
                  t.settingsSave,
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-wechat-button dsh-wechat-outline',
                    disabled: state.busy || state.defaults === undefined,
                    onClick: () => setState((prev) => ({ ...prev, draft: prev.defaults })),
                  },
                  t.settingsReset,
                ),
                state.saved ? h('span', { className: 'dsh-wechat-ok' }, t.settingsSaved) : null,
              ),
            )
            )
          : null,

        // The command reference. Slash commands are the fast path and the escape hatch when the
        // agent misreads a request, but they only help someone who knows they exist — so the page
        // that configures the channel is where they belong.
        h(
          Group,
          { title: t.groupCommands },
          h(
            Card,
            null,
            h('h3', null, t.commandsSlash),
            h('span', { className: 'dsh-wechat-hint' }, t.commandsSlashHint),
            h(
              'dl',
              { className: 'dsh-wechat-commands' },
              h('div', { className: 'dsh-wechat-command' }, h('dt', null, '/help'), h('dd', null, t.commandHelp)),
              h('div', { className: 'dsh-wechat-command' }, h('dt', null, '/new [标题]'), h('dd', null, t.commandNew)),
              h('div', { className: 'dsh-wechat-command' }, h('dt', null, '/list'), h('dd', null, t.commandList)),
              h('div', { className: 'dsh-wechat-command' }, h('dt', null, '/switch <编号>'), h('dd', null, t.commandSwitch)),
              h('div', { className: 'dsh-wechat-command' }, h('dt', null, '/current'), h('dd', null, t.commandCurrent)),
              h('div', { className: 'dsh-wechat-command' }, h('dt', null, '/cancel'), h('dd', null, t.commandCancel)),
            ),
            h('span', { className: 'dsh-wechat-hint' }, t.commandsSeparator),
            h('h3', null, t.commandsPlain),
            h('span', { className: 'dsh-wechat-hint' }, t.commandsPlainHint),
          ),
        ),

        // Diagnostics: where the files are, and what the log last said.
        status.diagnostics !== undefined || status.errors.length > 0
          ? h(
              Group,
              { title: t.groupDiagnostics },
              status.diagnostics !== undefined
                ? h(
                    Card,
                    null,
                    h('h3', null, t.diagnosticsTitle),
                    h('span', { className: 'dsh-wechat-hint' }, t.diagnosticsHint),
                    // A definition list rather than rows: the labels get a fixed column, so the
                    // paths line up instead of ragging against the right edge.
                    h(
                      'dl',
                      { className: 'dsh-wechat-facts' },
                      h(
                        'div',
                        { className: 'dsh-wechat-fact' },
                        h('dt', null, t.logPath),
                        h('dd', null, status.diagnostics.logPath),
                      ),
                      h(
                        'div',
                        { className: 'dsh-wechat-fact' },
                        h('dt', null, t.statePath),
                        h('dd', null, status.diagnostics.statePath),
                      ),
                      h(
                        'div',
                        { className: 'dsh-wechat-fact' },
                        h('dt', null, t.workspacePath),
                        h('dd', null, status.diagnostics.workspace),
                      ),
                    ),
                    h('h3', null, t.logTail),
                    h(
                      'pre',
                      { className: 'dsh-wechat-log' },
                      (status.diagnostics.logTail ?? []).length === 0
                        ? t.noLog
                        : status.diagnostics.logTail.slice(-60).join('\n'),
                    ),
                  )
                : null,

              status.errors.length > 0
                ? h(
                    Card,
                    null,
                    h('h3', null, t.errorsTitle),
                    h(
                      'ul',
                      { className: 'dsh-wechat-errors' },
                      ...status.errors.slice(-6).map((line, index) => h('li', { key: index }, line)),
                    ),
                  )
                : null,
            )
          : null,
      )
    }

    /** Cordis plugin name. The loader patch id must match this. */
    const name = 'dsh-wechat-plugin'

    /**
     * Client services this plugin needs before it may activate.
     *
     * Declaring `slots` is load-bearing, not tidiness. Cordis will not activate a
     * plugin until every injected service is available; without this entry the plugin
     * activates before the slot registry exists, `ctx.slots` is undefined, and
     * `ctx.slots.inject(...)` throws. The runtime then records the entry as `failed`,
     * the shell's boot audit refuses to start the whole application, and the failure
     * text never names the missing service — it only reports the entry as failed.
     *
     * The official client-plugin template declares the same list, for the same reason.
     */
    const inject = ['slots']

    // The client-plugin rules call for factories free of side effects and for
    // `apply` to register every resource through `ctx.effect`, returning cleanup.
    function apply(ctx) {
      ctx.effect(() => {
        const removeStyles = installStyles()
        const disposeSection = ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'wechat',
              // After the built-in sections, which sit in the 10..30 range.
              order: 40,
              label: () => text().nav,
              inject: () => ({}),
            },
            WechatSettings,
          ),
        )
        return () => {
          if (typeof disposeSection === 'function') disposeSection()
          removeStyles()
        }
      })
    }

    // Returning the exports object directly is the documented factory shape.
    return { name, inject, apply }
  },
})
