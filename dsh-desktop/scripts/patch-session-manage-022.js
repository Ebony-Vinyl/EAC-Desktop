"use strict";
// 0.2.2 内核（dsh 0.2.2-rc.1）的「删除会话」补丁：Host API 面从 dsh-host-apiproxy
// 拆到 dsh-api-* 之后，0.2.1 世代那套 apiproxy 锚点全部失效，本文件按 0.2.2 的
// 实际结构重新落锚（WorkspaceRegistry / WorkspaceController / api-remotes 契约表 /
// contextMenus 数据式菜单）。
Object.defineProperty(exports, "__esModule", { value: true });
exports.patchSession022Sources = patchSession022Sources;
exports.patchSessionManage022 = patchSessionManage022;
const fs = require("node:fs");
const path = require("node:path");

const MARKER = 'dsh-desktop:session-delete-022-v1';
const FILES = {
    loop: 'dsh-agent-loop/lib/index.js',
    storage: 'dsh-session-persistence-jsonl/lib/index.js',
    session: 'dsh-session/lib/index.js',
    workspace: 'dsh-workspace/lib/index.js',
    host: 'dsh-api-workspace-controller/lib/index.js',
    codecs: 'dsh-api-workspace-controller/lib/typert.host.js',
    client: 'dsh-api-workspace-controller/lib/client.js',
    remotes: 'dsh-api-remotes/lib/client.js',
    ui: 'dsh-client-ui-workspace/lib/client.js',
};

// 生命周期由 AgentLoop 拥有：删除前必须拿到该会话的 dispose（含 handle.close），
// 不能只从 SessionStore 摘条目。
const LOOP_DISPOSE = [
    '',
    '\t/** dsh-desktop patch (session manage): 释放一个会话的 agent 生命周期。 */',
    '\tasync disposeSession(id) {',
    '\t\tconst dispose = this.__eacSessionDisposers?.get(id);',
    '\t\tif (dispose === void 0) return false;',
    '\t\tawait dispose();',
    '\t\treturn true;',
    '\t}',
    '',
].join('\n');

const STORAGE_DELETE = [
    '',
    '  async deleteSession(id) {',
    '    this.tracker.claimWrite(id);',
    '    let lease;',
    '    try {',
    '      const selected = await this.findLog(id);',
    '      if (selected === void 0) return false;',
    '      const dir = dirname(selected.currentPath);',
    '      const root = await realpath(this.root);',
    '      const target = await realpath(dir);',
    '      const within = relative(root, target);',
    '      if (!within || within === ".." || within.startsWith(".." + pathSep) || isAbsolute(within) || (await lstat(dir)).isSymbolicLink()) {',
    '        throw new Error("session deletion target is outside the storage root");',
    '      }',
    '      lease = await this.acquireLease(id, void 0, dir);',
    '      // session.lock 必须留在原位：unlink 会让其他进程通过新 inode 绕过在途锁。',
    '      for (const name of await readdir(dir)) {',
    '        if (name !== LEASE_FILENAME) await rm(join(dir, name), { recursive: true, force: true });',
    '      }',
    '      this.coldLogMemo.delete(id);',
    '      return true;',
    '    } finally {',
    '      try { await lease?.release(); }',
    '      finally { this.tracker.releaseClaim(id); }',
    '    }',
    '  }',
    '',
].join('\n');

// SessionStore 摘除：detachEntered 会按 announcement 发配对的 session/disposed，
// SessionController 据此转发 api-session/removed。
const SESSION_REMOVE = [
    '',
    '\t/** dsh-desktop patch (session manage): 从 live 注册表摘除一个会话并广播处置事件。 */',
    '\tremove(id) {',
    '\t\tconst entry = this.store.get(id);',
    '\t\tif (entry === void 0) return false;',
    '\t\tthis.detachEntered(entry);',
    '\t\treturn true;',
    '\t}',
    '',
].join('\n');

const WORKSPACE_DELETE = [
    '',
    '\t/** dsh-desktop patch (session manage): 删除一个空闲会话及其持久化历史。 */',
    '\tdeleteSession(sessionId) {',
    '\t\treturn this.enqueueOperation(async () => {',
    '\t\t\tconst persistence = this.ctx.sessionPersistence;',
    '\t\t\tconst sessions = this.ctx.get("sessions");',
    '\t\t\tconst loop = this.ctx.get("agentLoop");',
    '\t\t\tif (persistence === void 0 || typeof persistence.deleteSession !== "function") throw new Error("session persistence does not support deletion");',
    '\t\t\tconst before = this.requireState();',
    '\t\t\tconst live = sessions?.get(sessionId);',
    '\t\t\tconst stored = await persistence.stat(sessionId);',
    '\t\t\tif (live === void 0 && stored === void 0 && !before.archivedSessionIds.includes(sessionId)) {',
    '\t\t\t\tthrow new WorkspaceUnknownSessionError(sessionId, "delete");',
    '\t\t\t}',
    '\t\t\tif (live !== void 0 && !loop?.__eacSessionDisposers?.has(sessionId)) {',
    '\t\t\t\tthrow new Error("session lifecycle cannot be released by this runtime");',
    '\t\t\t}',
    '\t\t\tconst checkActivity = async () => {',
    '\t\t\t\tconst activity = await this.ctx.waterfall("workspace/session-activity", { sessionId }, () => Promise.resolve([]));',
    '\t\t\t\tif (activity.length > 0) throw new WorkspaceActiveSessionError(sessionId, activity);',
    '\t\t\t};',
    '\t\t\tawait checkActivity();',
    '\t\t\t// 原生 archive gate 在 Agent admission/pre-step 阶段阻止新的写入。',
    '\t\t\tawait this.setState({ ...before,',
    '\t\t\t\tarchivedSessionIds: before.archivedSessionIds.includes(sessionId) ? before.archivedSessionIds : [...before.archivedSessionIds, sessionId],',
    '\t\t\t\tpinnedSessionIds: before.pinnedSessionIds.filter((id) => id !== sessionId)',
    '\t\t\t});',
    '\t\t\tlet deleting = false;',
    '\t\t\ttry {',
    '\t\t\t\tif (live !== void 0) await sessions.flush(live);',
    '\t\t\t\tawait checkActivity();',
    '\t\t\t\tif (live !== void 0) {',
    '\t\t\t\t\tawait loop.disposeSession(sessionId);',
    '\t\t\t\t\tif (sessions.get(sessionId) !== void 0) throw new Error("session lifecycle did not release the live session");',
    '\t\t\t\t}',
    '\t\t\t\tdeleting = true;',
    '\t\t\t\tawait persistence.deleteSession(sessionId);',
    '\t\t\t} catch (error) {',
    '\t\t\t\t// 还未删除数据时恢复原归档/置顶选择；I/O 删除失败则保留归档门控以便重试。',
    '\t\t\t\tif (!deleting) {',
    '\t\t\t\t\ttry { await this.setState(before); }',
    '\t\t\t\t\tcatch (rollback) { throw new AggregateError([error, rollback], "session deletion and state rollback failed"); }',
    '\t\t\t\t}',
    '\t\t\t\tthrow error;',
    '\t\t\t}',
    '\t\t\tfor (const entity of this.entities.values()) await entity.detachSession(sessionId);',
    '\t\t\tthis.headers.delete(sessionId);',
    '\t\t\tthis.sessionPaths.delete(sessionId);',
    '\t\t\tthis.missingSessionPaths.delete(sessionId);',
    '\t\t\tthis.invalidSessionPaths.delete(sessionId);',
    '\t\t\tconst state = this.requireState();',
    '\t\t\tawait this.setState({ ...state,',
    '\t\t\t\tarchivedSessionIds: state.archivedSessionIds.filter((id) => id !== sessionId),',
    '\t\t\t\tpinnedSessionIds: state.pinnedSessionIds.filter((id) => id !== sessionId)',
    '\t\t\t});',
    '\t\t\t// 冷会话没有 live 生命周期可释放，客户端只能靠这条 API 事件从列表移除。',
    '\t\t\tthis.ctx.emit("api-session/removed", sessionId);',
    '\t\t\treturn { deleted: true };',
    '\t\t});',
    '\t}',
    '',
].join('\n');

const HOST_DELETE = [
    '',
    '\t\t/**',
    '\t\t* dsh-desktop patch (session manage): delete one Session.',
    '\t\t* 错误按内核原生 RemoteError 语义映射，客户端据 code 区分「不存在」与「运行中」。',
    '\t\t*/',
    '\t\tasync deleteSession(request) {',
    '\t\t\ttry { return await this.ctx.workspaceRegistry.deleteSession(request.sessionId); }',
    '\t\t\tcatch (error) {',
    '\t\t\t\tif (error instanceof WorkspaceUnknownSessionError) throw new RemoteError("session/not-found", error.message, { sessionId: request.sessionId }, { cause: error });',
    '\t\t\t\tif (error instanceof WorkspaceActiveSessionError) throw new RemoteError("workspace/session-active", error.message, { sessionId: request.sessionId, activity: error.activity }, { cause: error });',
    '\t\t\t\tthrow error;',
    '\t\t\t}',
    '\t\t}',
    '',
].join('\n');

function replaceOnce(source, anchor, replacement) {
    if (source.split(anchor).length !== 2)
        throw new Error('session-delete 0.2.2 anchor changed: ' + anchor.slice(0, 90));
    return source.replace(anchor, () => replacement);
}

const DELETE_RESULT_SCHEMA = '_eac_workspace_delete_result$schema';

function schemaDefHost() {
    return [
        'let _eac_workspace_delete_result$schema$value',
        "const _eac_workspace_delete_result$schema = () => (_eac_workspace_delete_result$schema$value ??= z.object({ 'deleted': z.literal(true).readonly() }))",
        '',
    ].join('\n');
}

function schemaDefRemote() {
    return [
        '\t\tlet _eac_workspace_delete_result$schema$value;',
        '\t\tconst _eac_workspace_delete_result$schema = () => _eac_workspace_delete_result$schema$value ??= zod.z.object({ "deleted": zod.z.literal(true).readonly() });',
        '',
    ].join('\n');
}

function remoteEntry(client) {
    const request = '_deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_parameter_0';
    const requestJson = JSON.stringify({ type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'], additionalProperties: false });
    const resultJson = JSON.stringify({ type: 'object', properties: { deleted: { type: 'boolean', const: true } }, required: ['deleted'], additionalProperties: false });
    const quote = client ? '"' : "'";
    return [
        quote + 'workspace/deleteSession' + quote + ': {',
        '      service: "workspaceController", invocation: { kind: "direct" },',
        '      description: "Delete one idle Session and its stored history.",',
        '      parameters: [{ name: "request", source: "json",',
        '        codec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceUnarchiveSessionRequest", create: ' + request + '$schema, jsonSchema: ' + requestJson + ' },',
        '        strictCodec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceUnarchiveSessionRequest", create: ' + request + '_strict$schema, jsonSchema: ' + requestJson + ' }',
        '      }],',
        '      result: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceDeleteValue", create: ' + DELETE_RESULT_SCHEMA + ', jsonSchema: ' + resultJson + ' },',
        '    },',
        '    ',
    ].join('\n');
}

const UI_ACTION = [
    '',
    '\t\t\t/** dsh-desktop patch (session manage): 删除一个会话（不可逆，菜单确认后调用）。 */',
    '\t\t\tasync deleteSession(sessionId) {',
    '\t\t\t\tawait this.workspaces.deleteSession(sessionId);',
    '\t\t\t\tif (this.mainReference?.sessionId === sessionId) this.clearMain();',
    '\t\t\t}',
    '',
].join('\n');

const UI_ACTIONS_INJECT = [
    '\t\t\tconst deleteInjected = () => ({',
    '\t\t\t\tdeleteSession: (sessionId) => {',
    '\t\t\t\t\tconst t = ctx.locale.bind("workspace");',
    '\t\t\t\t\tif (!window.confirm(t("confirm.deleteSession"))) return;',
    '\t\t\t\t\tuiWorkspace.deleteSession(sessionId).catch((reason) => {',
    '\t\t\t\t\t\twindow.alert(t("error.deleteSession") + " " + reason.message);',
    '\t\t\t\t\t});',
    '\t\t\t\t}',
    '\t\t\t});',
    '\t\t\t',
].join('\n');

const UI_MENU = [
    '\t\t\tregister("delete", 700, ["workspace/deleteSession"], (target) => {',
    '\t\t\t\tif (!allowed(target, "workspace/deleteSession")) return [];',
    '\t\t\t\treturn [{',
    '\t\t\t\t\tid: "delete",',
    '\t\t\t\t\tlabel: t("menu.deleteSession"),',
    '\t\t\t\t\tseparatorBefore: true,',
    '\t\t\t\t\trun: () => {',
    '\t\t\t\t\t\tactions.deleteSession(target.sessionId);',
    '\t\t\t\t\t}',
    '\t\t\t\t}];',
    '\t\t\t});',
    '\t\t\t',
].join('\n');

function patchSession022Sources(input) {
    const output = { ...input };
    for (const key of Object.keys(FILES)) {
        let source = input[key];
        if (source === undefined)
            throw new Error('session-delete 0.2.2 missing target: ' + key);
        if (source.includes(MARKER))
            continue;
        const edit = (anchor, replacement) => { source = replaceOnce(source, anchor, replacement); };
        switch (key) {
            case 'loop':
                edit('\townership;\n', '\t__eacSessionDisposers = /* @__PURE__ */ new Map();\n\townership;\n');
                edit('\tasync createAgent(ownerCtx, options) {', LOOP_DISPOSE + '\tasync createAgent(ownerCtx, options) {');
                edit('const untrack = this.ownership.track(dispose);', 'const untrackFactory = this.ownership.track(dispose);\n\t\tconst untrack = () => { if (this.__eacSessionDisposers.get(id) === dispose) this.__eacSessionDisposers.delete(id); untrackFactory(); };\n\t\tthis.__eacSessionDisposers.set(id, dispose);');
                break;
            case 'storage':
                edit('import { basename, dirname, isAbsolute, join, parse, resolve, toNamespacedPath } from "node:path";', 'import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep as pathSep, toNamespacedPath } from "node:path";');
                edit('\tflush() {\n\t\treturn this.tracker.flushAll();\n\t}', '\tflush() {\n\t\treturn this.tracker.flushAll();\n\t}' + STORAGE_DELETE);
                break;
            case 'session':
                edit('\tdetachEntered(entry) {', SESSION_REMOVE + '\tdetachEntered(entry) {');
                break;
            case 'workspace':
                edit('\tunarchiveSession(sessionId) {', WORKSPACE_DELETE + '\tunarchiveSession(sessionId) {');
                break;
            case 'host': {
                edit('\tlet _unarchiveSession_decorators;', '\tlet _deleteSession_decorators;\n\tlet _unarchiveSession_decorators;');
                edit('_unarchiveSession_decorators = [Remote("unarchiveSession")];', '_deleteSession_decorators = [Remote("deleteSession")];\n\t\t\t_unarchiveSession_decorators = [Remote("unarchiveSession")];');
                const start = source.indexOf('\t\t\t__esDecorate(this, null, _unarchiveSession_decorators, {');
                const end = source.indexOf('null, _instanceExtraInitializers);', start) + 'null, _instanceExtraInitializers);'.length;
                if (start < 0 || end <= start)
                    throw new Error('session-delete decorator anchor changed');
                const decorator = source.slice(start, end);
                edit(decorator, decorator + '\n' + decorator.replaceAll('unarchiveSession', 'deleteSession'));
                edit('\t\tunarchiveSession(request) {', HOST_DELETE + '\t\tunarchiveSession(request) {');
                break;
            }
            case 'codecs':
                edit('let _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_parameter_0$schema$value', schemaDefHost() + 'let _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_parameter_0$schema$value');
                edit("'workspace/unarchiveSession': {", remoteEntry(false) + "'workspace/unarchiveSession': {");
                break;
            case 'remotes':
                edit('\t\tlet _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_parameter_0$schema$value;', schemaDefRemote() + '\t\tlet _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_parameter_0$schema$value;');
                edit('"workspace/unarchiveSession": {', remoteEntry(true) + '"workspace/unarchiveSession": {');
                break;
            case 'client':
                edit('\t\t\tasync unarchiveSession(sessionId) {\n\t\t\t\tconst requestSeq = ++this.archiveRequestSeq;', '\t\t\tasync deleteSession(sessionId) { return await this.remote.deleteSession({ sessionId }); }\n\t\t\tasync unarchiveSession(sessionId) {\n\t\t\t\tconst requestSeq = ++this.archiveRequestSeq;');
                edit('\t\t\tasync unarchiveSession(sessionId) {\n\t\t\t\tconst result = await this.model.unarchiveSession(sessionId);', '\t\t\tasync deleteSession(sessionId) {\n\t\t\t\tconst result = await this.model.deleteSession(sessionId);\n\t\t\t\tif (!result.ok) throw Object.assign(new Error(result.error.message), { rpcError: result.error });\n\t\t\t}\n\t\t\tasync unarchiveSession(sessionId) {\n\t\t\t\tconst result = await this.model.unarchiveSession(sessionId);');
                break;
            case 'ui':
                edit('\t\t\tasync unarchiveSession(sessionId) {\n\t\t\t\tawait this.workspaces.unarchiveSession(sessionId);\n\t\t\t}', '\t\t\tasync unarchiveSession(sessionId) {\n\t\t\t\tawait this.workspaces.unarchiveSession(sessionId);\n\t\t\t}' + UI_ACTION);
                edit('\t\t\tconst archiveInjected = () => ({', UI_ACTIONS_INJECT + '\t\t\tconst archiveInjected = () => ({');
                edit('\t\t\t\t...pinInjected(),\n\t\t\t\t...archiveInjected(),', '\t\t\t\t...pinInjected(),\n\t\t\t\t...deleteInjected(),\n\t\t\t\t...archiveInjected(),');
                edit('\t\t\tregister("archive", 600,', UI_MENU + '\t\t\tregister("archive", 600,');
                edit('"menu.archiveSession": "归档会话",', '"menu.archiveSession": "归档会话",\n"menu.deleteSession": "删除对话",\n"confirm.deleteSession": "永久删除此对话及其历史记录？此操作无法撤销。",\n"error.deleteSession": "删除失败：",');
                edit('"menu.archiveSession": "Archive session",', '"menu.archiveSession": "Archive session",\n"menu.deleteSession": "Delete conversation",\n"confirm.deleteSession": "Permanently delete this conversation and its history? This cannot be undone.",\n"error.deleteSession": "Deletion failed:",');
                break;
        }
        output[key] = '// ' + MARKER + '\n' + source;
    }
    return output;
}

function patchSessionManage022(nmRoot, log = () => {}) {
    const input = Object.fromEntries(Object.entries(FILES).map(([key, relative]) => [key,
        fs.readFileSync(path.join(nmRoot, '@deepseek-ai', relative), 'utf8')]));
    // 所有目标先完成锚点验证，避免 UI 已显示删除但 RPC/存储只应用了一半。
    const output = patchSession022Sources(input);
    let changed = 0;
    for (const [key, relative] of Object.entries(FILES)) {
        if (output[key] === input[key])
            continue;
        const file = path.join(nmRoot, '@deepseek-ai', relative);
        const tmp = file + '.eac-delete.tmp';
        fs.writeFileSync(tmp, output[key]);
        fs.renameSync(tmp, file);
        changed++;
    }
    log('session-manage: 0.2.2 删除链路已适配；原生 archive/unarchive 保留（修改 ' + changed + ' 个文件）');
    return changed;
}
