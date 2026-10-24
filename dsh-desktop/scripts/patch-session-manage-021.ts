import fs = require('node:fs');
import path = require('node:path');

const MARKER = 'dsh-desktop:session-delete-021-v1';
const FILES = {
  loop: 'dsh-agent-loop/lib/index.js',
  storage: 'dsh-session-persistence-jsonl/lib/index.js',
  workspace: 'dsh-workspace/lib/index.js',
  host: 'dsh-api-workspace-controller/lib/index.js',
  codecs: 'dsh-api-workspace-controller/lib/typert.host.js',
  client: 'dsh-api-workspace-controller/lib/client.js',
  remotes: 'dsh-api-remotes/lib/client.js',
  ui: 'dsh-client-ui-workspace/lib/client.js',
};

// 0.2.1 的生命周期由 AgentLoop 拥有；必须等待其原生 teardown（含 handle.close），
// 不能通过同步移除 SessionStore 条目代替释放持久化写入所有权。
const LOOP_DISPOSE = `
  async disposeSession(id) {
    const dispose = this.__eacSessionDisposers?.get(id);
    if (dispose === void 0) return false;
    await dispose();
    return true;
  }
`;
const STORAGE_DELETE = `
  async deleteSession(id) {
    this.tracker.claimWrite(id);
    let lease;
    try {
      const selected = await this.findLog(id);
      if (selected === void 0) return false;
      const dir = dirname(selected.currentPath);
      const root = await realpath(this.root);
      const target = await realpath(dir);
      const within = relative(root, target);
      if (!within || within === ".." || within.startsWith(".." + pathSep) || isAbsolute(within) || (await lstat(dir)).isSymbolicLink()) {
        throw new Error("session deletion target is outside the storage root");
      }
      lease = await this.acquireLease(id, void 0, dir);
      // session.lock 必须留在原位：unlink 会让其他进程通过新 inode 绕过在途锁。
      for (const name of await readdir(dir)) {
        if (name !== LEASE_FILENAME) await rm(join(dir, name), { recursive: true, force: true });
      }
      this.coldLogMemo.delete(id);
      return true;
    } finally {
      try { await lease?.release(); }
      finally { this.tracker.releaseClaim(id); }
    }
  }
`;
const WORKSPACE_DELETE = `
  deleteSession(sessionId) {
    return this.enqueueOperation(async () => {
      const persistence = this.ctx.sessionPersistence;
      const sessions = this.ctx.get("sessions");
      const loop = this.ctx.get("agentLoop");
      if (typeof persistence.deleteSession !== "function") throw new Error("session persistence does not support deletion");
      const before = this.requireState();
      const live = sessions?.get(sessionId);
      const stored = await persistence.stat(sessionId);
      if (live === void 0 && stored === void 0 && !before.archivedSessionIds.includes(sessionId)) {
        throw new WorkspaceUnknownSessionError(sessionId, "delete");
      }
      if (live !== void 0 && !loop?.__eacSessionDisposers?.has(sessionId)) {
        throw new Error("session lifecycle cannot be released by this runtime");
      }
      const checkActivity = async () => {
        const activity = await this.ctx.waterfall("workspace/session-activity", { sessionId }, () => Promise.resolve([]));
        if (activity.length > 0) throw new WorkspaceActiveSessionError(sessionId, activity);
      };
      await checkActivity();
      // 原生 archive gate 在 Agent admission/pre-step 阶段阻止新的写入。
      await this.setState({ ...before,
        archivedSessionIds: before.archivedSessionIds.includes(sessionId) ? before.archivedSessionIds : [...before.archivedSessionIds, sessionId],
        pinnedSessionIds: before.pinnedSessionIds.filter(id => id !== sessionId)
      });
      let deleting = false;
      try {
        if (live !== void 0) await sessions.flush(live);
        await checkActivity();
        if (live !== void 0) {
          await loop.disposeSession(sessionId);
          if (sessions.get(sessionId) !== void 0) throw new Error("session lifecycle did not release the live session");
        }
        deleting = true;
        await persistence.deleteSession(sessionId);
      } catch (error) {
        // 还未删除数据时恢复原归档/置顶选择；I/O 删除失败则保留归档门控以便重试。
        if (!deleting) {
          try { await this.setState(before); }
          catch (rollback) { throw new AggregateError([error, rollback], "session deletion and state rollback failed"); }
        }
        throw error;
      }
      for (const entity of this.entities.values()) await entity.detachSession(sessionId);
      this.headers.delete(sessionId);
      this.sessionPaths.delete(sessionId);
      this.missingSessionPaths.delete(sessionId);
      this.invalidSessionPaths.delete(sessionId);
      const state = this.requireState();
      await this.setState({ ...state,
        archivedSessionIds: state.archivedSessionIds.filter(id => id !== sessionId),
        pinnedSessionIds: state.pinnedSessionIds.filter(id => id !== sessionId)
      });
      // 原生事件接收真实 id，不伪造 Session 对象；冷会话也从 Client 列表移除。
      this.ctx.emit("api-session/removed", sessionId);
      return { deleted: true };
    });
  }
`;
const HOST_DELETE = `
    async deleteSession(request) {
      try { return await this.ctx.workspaceRegistry.deleteSession(request.sessionId); }
      catch (error) {
        if (error instanceof WorkspaceUnknownSessionError) throw new RemoteError("session/not-found", error.message, { sessionId: request.sessionId }, { cause: error });
        if (error instanceof WorkspaceActiveSessionError) throw new RemoteError("workspace/session-active", error.message, { sessionId: request.sessionId, activity: error.activity }, { cause: error });
        throw error;
      }
    }
`;
const UI_DELETE = `
    function DeleteSessionMenuItem({ sessionId, useMenuOpenState, workspaces, t }) {
      const [, setMenuOpen] = useMenuOpenState();
      return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MenuItemButton, {
        danger: true,
        onSelect: () => {
          setMenuOpen(false);
          const manager = window.__dshSessionManager;
          if (typeof manager?.deleteSession === "function") { manager.deleteSession(sessionId); return; }
          if (!window.confirm(t("confirm.deleteSession"))) return;
          workspaces.deleteSession(sessionId).catch(error => window.alert(t("error.deleteSession") + " " + error.message));
        },
        children: t("menu.deleteSession")
      });
    }
`;

function replaceOnce(source: string, anchor: string, replacement: string): string {
  if (source.split(anchor).length !== 2) throw new Error('session-delete 0.2.1 anchor changed: ' + anchor.slice(0, 90));
  return source.replace(anchor, () => replacement);
}

function remoteEntry(client: boolean): string {
  const request = '_deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_parameter_0';
  const result = '_deepseek_ai_dsh_api_workspace_controller_workspace_delete_result$schema';
  const requestJson = JSON.stringify({ type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'], additionalProperties: false });
  const resultJson = JSON.stringify({ type: 'object', properties: { deleted: { type: 'boolean', const: true } }, required: ['deleted'], additionalProperties: false });
  const quote = client ? '"' : "'";
  return `${quote}workspace/deleteSession${quote}: {
      service: "workspaceController", invocation: { kind: "direct" },
      description: "Delete one idle Session and its stored history.",
      parameters: [{ name: "request", source: "json",
        codec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceUnarchiveSessionRequest", create: ${request}$schema, jsonSchema: ${requestJson} },
        strictCodec: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceUnarchiveSessionRequest", create: ${request}_strict$schema, jsonSchema: ${requestJson} }
      }],
      result: { mode: "strict", typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceDeleteValue", create: ${result}, jsonSchema: ${resultJson} }
    },
    `;
}

export function patchSession021Sources(input: Record<string, string>): Record<string, string> {
  const output = { ...input };
  for (const key of Object.keys(FILES)) {
    let source = input[key];
    if (source === undefined) throw new Error('session-delete 0.2.1 missing target: ' + key);
    if (source.includes(MARKER)) continue;
    const edit = (anchor: string, replacement: string) => { source = replaceOnce(source!, anchor, replacement); };
    switch (key) {
      case 'loop':
        edit('\townership;\n', '\t__eacSessionDisposers = new Map();\n\townership;\n');
        edit('\tprepare(ownerCtx, id, options, session, callerSignal, handle, parentAgent) {', LOOP_DISPOSE + '\tprepare(ownerCtx, id, options, session, callerSignal, handle, parentAgent) {');
        edit('const untrack = this.ownership.track(dispose);', 'const untrackFactory = this.ownership.track(dispose);\n\t\tconst untrack = () => { if (this.__eacSessionDisposers.get(id) === dispose) this.__eacSessionDisposers.delete(id); untrackFactory(); };\n\t\tthis.__eacSessionDisposers.set(id, dispose);');
        break;
      case 'storage':
        edit('import { basename, dirname, isAbsolute, join, parse, resolve, toNamespacedPath } from "node:path";', 'import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep as pathSep, toNamespacedPath } from "node:path";');
        edit('\tflush() {\n\t\treturn this.tracker.flushAll();\n\t}', '\tflush() {\n\t\treturn this.tracker.flushAll();\n\t}' + STORAGE_DELETE);
        break;
      case 'workspace':
        edit('\tunarchiveSession(sessionId) {', WORKSPACE_DELETE + '\tunarchiveSession(sessionId) {');
        break;
      case 'host': {
        edit('\tlet _unarchiveSession_decorators;', '\tlet _deleteSession_decorators;\n\tlet _unarchiveSession_decorators;');
        edit('_unarchiveSession_decorators = [Remote("unarchiveSession")];', '_deleteSession_decorators = [Remote("deleteSession")];\n\t\t\t_unarchiveSession_decorators = [Remote("unarchiveSession")];');
        const start = source!.indexOf('\t\t\t__esDecorate(this, null, _unarchiveSession_decorators, {');
        const end = source!.indexOf('null, _instanceExtraInitializers);', start) + 'null, _instanceExtraInitializers);'.length;
        if (start < 0 || end < start) throw new Error('session-delete decorator anchor changed');
        const decorator = source!.slice(start, end);
        edit(decorator, decorator + '\n' + decorator.replaceAll('unarchiveSession', 'deleteSession'));
        edit('\t\tunarchiveSession(request) {', HOST_DELETE + '\t\tunarchiveSession(request) {');
        break;
      }
      case 'codecs':
        edit("'workspace/unarchiveSession': {", remoteEntry(false) + "'workspace/unarchiveSession': {");
        break;
      case 'remotes':
        edit('"workspace/unarchiveSession": {', remoteEntry(true) + '"workspace/unarchiveSession": {');
        break;
      case 'client':
        edit('\t\t\tasync unarchiveSession(sessionId) {\n\t\t\t\tconst requestSeq = ++this.archiveRequestSeq;', `\t\t\tasync deleteSession(sessionId) { return await this.remote.deleteSession({ sessionId }); }\n\t\t\tasync unarchiveSession(sessionId) {\n\t\t\t\tconst requestSeq = ++this.archiveRequestSeq;`);
        // 第二个 unarchive 是命令服务，参数不带 async 结果重命名，因此使用完整原生方法锚点。
        edit('\t\t\tasync unarchiveSession(sessionId) {\n\t\t\t\tconst result = await this.model.unarchiveSession(sessionId);', `\t\t\tasync deleteSession(sessionId) {\n\t\t\t\tconst result = await this.model.deleteSession(sessionId);\n\t\t\t\tif (!result.ok) throw Object.assign(new Error(result.error.message), { rpcError: result.error });\n\t\t\t}\n\t\t\tasync unarchiveSession(sessionId) {\n\t\t\t\tconst result = await this.model.unarchiveSession(sessionId);`);
        break;
      case 'ui':
        edit('\t\tfunction ArchiveSessionMenuItem(', UI_DELETE + '\t\tfunction ArchiveSessionMenuItem(');
        edit('}, ArchiveSessionMenuItem);', `}, ArchiveSessionMenuItem);\n\t\t\t\tyield ctx.slots.register({ name: "sidebar.workspaces.session.menu.item", id: "eac-delete", order: 425, locale: NS, inject: () => ({ workspaces: ctx.workspaces }) }, DeleteSessionMenuItem);`);
        edit('"menu.archiveSession": "归档会话",', '"menu.archiveSession": "归档会话",\n"menu.deleteSession": "删除对话",\n"confirm.deleteSession": "永久删除此对话及其历史记录？此操作无法撤销。",\n"error.deleteSession": "删除失败：",');
        edit('"menu.archiveSession": "Archive session",', '"menu.archiveSession": "Archive session",\n"menu.deleteSession": "Delete conversation",\n"confirm.deleteSession": "Permanently delete this conversation and its history? This cannot be undone.",\n"error.deleteSession": "Deletion failed:",');
        break;
    }
    output[key] = '// ' + MARKER + '\n' + source;
  }
  return output;
}

export function patchSessionManage021(nmRoot: string, log: (message: string) => void): number {
  const input = Object.fromEntries(Object.entries(FILES).map(([key, relative]) => [key,
    fs.readFileSync(path.join(nmRoot, '@deepseek-ai', relative), 'utf8')]));
  // 所有目标先完成锚点验证，避免 UI 已显示删除但 RPC/存储只应用了一半。
  const output = patchSession021Sources(input);
  let changed = 0;
  for (const [key, relative] of Object.entries(FILES)) {
    if (output[key] === input[key]) continue;
    const file = path.join(nmRoot, '@deepseek-ai', relative);
    const tmp = file + '.eac-delete.tmp';
    fs.writeFileSync(tmp, output[key]!);
    fs.renameSync(tmp, file);
    changed++;
  }
  log('session-manage: 0.2.1 删除链路已适配；原生 archive/unarchive 保留（修改 ' + changed + ' 个文件）');
  return changed;
}
