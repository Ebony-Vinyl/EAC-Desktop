'use strict';

// 对话删除 / 归档管理运行时补丁（幂等、锚点不匹配时跳过且绝不损坏文件）。
//
// 背景：dsh 只有归档（workspace 域 archivedSessionIds）没有删除。本补丁在
// 官方包上做外科手术式扩展，打通「删除按钮 + 设置内归档管理面板」所需的
// 全链路（宿主 RPC + 客户端桥 + 会话行菜单）：
//
//   1. @deepseek-ai/dsh-workspace        —— WorkspaceRegistry 增加
//      unarchiveSession(sessionId)（幂等地从归档集合移除并持久化）。
//   2. @deepseek-ai/dsh-host-apiproxy    —— 新增两个 RPC：
//        · workspace.unarchiveSession    恢复归档（域变更自动广播
//          host/archived-sessions-changed，客户端实时恢复显示）；
//        · workspace.deleteSession       删除：拒绝运行中会话 → 按 jsonl
//          布局移除会话目录 → 清理归档集合 → 广播 session/disposed
//          （各监听者按 session 对象身份做 Map 操作，合成 {id} 事件安全，
//          客户端实时收到 host/session-removed 移除行）。
//   3. @deepseek-ai/dsh-client-connection —— workspace API 面 + unary 响应
//      schema 增加两个方法（否则 callUnary 在 schema 表里找不到会抛错）。
//   4. @deepseek-ai/dsh-client-ui-workspace —— 会话行 ⋯ 菜单在「归档会话」
//      下方增加「删除对话」（当前会话行不显示），点击走
//      window.__dshSessionManager（由配套插件 dsh-session-manager 提供：
//      确认框 + RPC + 错误提示）。
//
// 用法：
//   node scripts/patch-session-manage.js [<node_modules 根目录>]
// 同时导出 patchSessionManage(nmRoot, log) 供 main.js 启动补丁与 after-pack.js
// 打包补丁复用（覆盖内置副本 / profile fallback / agent overlay / dev）。

const fs = require('node:fs');
const path = require('node:path');

const MARKER = 'dsh-desktop patch (session manage)';

// ---------------------------------------------------------------------------
// 1. dsh-workspace：unarchiveSession
// ---------------------------------------------------------------------------
const WS_ANCHOR = 'archivedSessionIds: [...state.archivedSessionIds, sessionId]\n\t\t\t});\n\t\t});\n\t}';
const WS_INSERT = '\t/**\n\t* dsh-desktop patch (session manage): 从归档集合移除一个会话（恢复）。\n\t* 幂等：不在归档集合中是 no-op；不校验 sessionKnown —— 已删除会话的\n\t* 陈旧归档项也应能清掉。恢复后会话沿用原有 workspace 槽位与显示顺序。\n\t* @param sessionId - 要恢复的会话 id。\n\t*/\n\tunarchiveSession(sessionId) {\n\t\treturn this.enqueueOperation(async () => {\n\t\t\tconst state = this.requireState();\n\t\t\tif (!state.archivedSessionIds.includes(sessionId)) return;\n\t\t\tawait this.setState({\n\t\t\t\t...state,\n\t\t\t\tarchivedSessionIds: state.archivedSessionIds.filter((id) => id !== sessionId)\n\t\t\t});\n\t\t});\n\t}';

// ---------------------------------------------------------------------------
// 1b. dsh-session：Sessions 服务增加 remove(id) —— 删除前从 live 注册表摘除
// （detachEntered：优雅 flush + 释放持久化状态 + 广播 session/disposed）。
// ---------------------------------------------------------------------------
const SESSION_ANCHOR = 'list() {\n\t\treturn [...this.store.values()].map((entry) => entry.session);\n\t}';
const SESSION_INSERT = 'list() {\n\t\treturn [...this.store.values()].map((entry) => entry.session);\n\t}\n\t/**\n\t* dsh-desktop patch (session manage): 从 live 注册表摘除一个会话并广播\n\t* session/disposed（优雅 flush 后释放持久化状态）。删除前调用：摘除后\n\t* 写路径不再拥有该会话，目录可安全移除；正在运行的会话由调用方先行拒绝。\n\t* @param id - 要摘除的会话 id。\n\t* @returns 是否确实摘除了一个 live 会话。\n\t*/\n\tremove(id) {\n\t\tconst entry = this.store.get(id);\n\t\tif (entry === void 0) return false;\n\t\tthis.detachEntered(entry);\n\t\treturn true;\n\t}';

// ---------------------------------------------------------------------------
// 2. dsh-host-apiproxy：两个 RPC（impl / schemas / handler map / imports）
// ---------------------------------------------------------------------------
const HOST_IMPORT_ANCHOR = 'import { mkdir, stat } from "node:fs/promises";';
const HOST_IMPORT_NEW = 'import { mkdir, readdir, rm, stat } from "node:fs/promises";\nimport { dshHomePath } from "@deepseek-ai/dsh-home-paths";';
// 注意：node:path 的 join 通过单独锚点追加到既有 import 行（避免重复声明）。

const HOST_IMPORT_JOIN_ANCHOR = 'import { dirname, extname } from "node:path";';
const HOST_IMPORT_JOIN_NEW = 'import { dirname, extname, join } from "node:path";';

const HOST_API_ANCHOR = 'return ok(request, { archivedSessionIds: [...ctx.workspaceRegistry.archivedSessionIds] });\n\t\t\t}';
const HOST_API_INSERT = 'return ok(request, { archivedSessionIds: [...ctx.workspaceRegistry.archivedSessionIds] });\n\t\t\t},\n\t\t\tasync unarchiveSession(request) {\n\t\t\t\tconst { sessionId } = request.payload;\n\t\t\t\tawait ctx.workspaceRegistry.unarchiveSession(sessionId);\n\t\t\t\treturn ok(request, { archivedSessionIds: [...ctx.workspaceRegistry.archivedSessionIds] });\n\t\t\t},\n\t\t\tasync deleteSession(request) {\n\t\t\t\tconst { sessionId } = request.payload;\n\t\t\t\t// 拒绝「正在运行」的会话（agent 活跃时写路径会重建目录，删除不安全）。\n\t\t\t\tif (dshSessionRunningState.get(sessionId) === true) {\n\t\t\t\t\treturn err(request, {\n\t\t\t\t\t\tcode: "session-running",\n\t\t\t\t\t\tmessage: "cannot delete a running session: stop it first",\n\t\t\t\t\t\tdetails: { sessionId }\n\t\t\t\t\t});\n\t\t\t\t}\n\t\t\t\ttry {\n\t\t\t\t\t// 会话目录布局（dsh-session-persistence-jsonl 约定，注入时同步复制）：\n\t\t\t\t\t// <sessionsRoot>/<projectKey(cwd)>/<encodeSegment(id)>/ 。\n\t\t\t\t\tconst headers = await ctx.get("sessionPersistence").list();\n\t\t\t\t\tconst header = headers.find((entry) => entry && entry.id === sessionId);\n\t\t\t\t\tif (header !== void 0) {\n\t\t\t\t\t\tconst encodeSeg = (raw) => {\n\t\t\t\t\t\t\tif (raw === ".") return "~002E";\n\t\t\t\t\t\t\tif (raw === "..") return "~002E~002E";\n\t\t\t\t\t\t\tlet out = "";\n\t\t\t\t\t\t\tfor (let i = 0; i < raw.length; i++) {\n\t\t\t\t\t\t\t\tconst code = raw.charCodeAt(i);\n\t\t\t\t\t\t\t\tconst ch = String.fromCharCode(code);\n\t\t\t\t\t\t\t\tif (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;\n\t\t\t\t\t\t\t\telse out += "~" + code.toString(16).toUpperCase().padStart(4, "0");\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\treturn out;\n\t\t\t\t\t\t};\n\t\t\t\t\t\tconst projectKeyOf = (cwd) => {\n\t\t\t\t\t\t\tlet readable = "";\n\t\t\t\t\t\t\tlet separatorRun = false;\n\t\t\t\t\t\t\tfor (let i = 0; i < cwd.length; i++) {\n\t\t\t\t\t\t\t\tconst code = cwd.charCodeAt(i);\n\t\t\t\t\t\t\t\tconst ch = String.fromCharCode(code);\n\t\t\t\t\t\t\t\tif (ch === "/" || ch === "\\\\" || ch === ":") {\n\t\t\t\t\t\t\t\t\tif (!separatorRun) readable += "-";\n\t\t\t\t\t\t\t\t\tseparatorRun = true;\n\t\t\t\t\t\t\t\t} else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {\n\t\t\t\t\t\t\t\t\treadable += ch;\n\t\t\t\t\t\t\t\t\tseparatorRun = false;\n\t\t\t\t\t\t\t\t} else {\n\t\t\t\t\t\t\t\t\treadable += "~" + code.toString(16).toUpperCase().padStart(4, "0");\n\t\t\t\t\t\t\t\t\tseparatorRun = false;\n\t\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\treturn `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;\n\t\t\t\t\t\t};\n\t\t\t\t\t\tconst root = dshHomePath("sessions");\n\t\t\t\t\t\tconst dir = join(root, header.cwd === void 0 ? "_no-cwd" : projectKeyOf(header.cwd), encodeSeg(sessionId));\n\t\t\t\t\t\tawait rm(dir, { recursive: true, force: true });\n\t\t\t\t\t}\n\t\t\t\t} catch (error) {\n\t\t\t\t\tif (!(error instanceof WorkspaceUnknownSessionError)) throw error;\n\t\t\t\t}\n\t\t\t\t// 摘除 live 注册表（优雅 flush + 释放持久化状态 + session/disposed\n\t\t\t\t// 广播 → 客户端实时收到 session-removed）；非 live 则广播合成移除帧。\n\t\t\t\tconst removed = ctx.sessions.remove(sessionId);\n\t\t\t\tif (!removed) ctx.emit("session/disposed", { id: sessionId });\n\t\t\t\t// 清理归档集合（含陈旧归档项）。\n\t\t\t\tawait ctx.workspaceRegistry.unarchiveSession(sessionId);\n\t\t\t\treturn ok(request, { deleted: true });\n\t\t\t}';

// 模块级：每会话最近一次 agent 运行状态（删除守卫用；agent/status 事件维护）。
// 0.1.1-rc.2 起该 import 行新增 homedir —— 双候选兼容新旧内核构建产物。
const HOST_MAP_ANCHOR = 'import { homedir, release } from "node:os";';
const HOST_MAP_ANCHOR_RC7 = 'import { release } from "node:os";';
const HOST_MAP_INSERT = 'import { homedir, release } from "node:os";\n// dsh-desktop patch (session manage): 每会话最近一次 agent 运行状态（删除守卫用）。\nconst dshSessionRunningState = /* @__PURE__ */ new Map();';
const HOST_MAP_INSERT_RC7 = 'import { release } from "node:os";\n// dsh-desktop patch (session manage): 每会话最近一次 agent 运行状态（删除守卫用）。\nconst dshSessionRunningState = /* @__PURE__ */ new Map();';

// host 流里的 agent/status 监听器：同步维护运行状态表。
const HOST_STATUS_ANCHOR = 'ctx.on("agent/status", ({ agent, status }) => {\n\t\t\t\t\t\tqueue.push(frame({\n\t\t\t\t\t\t\ttype: "host/session-status",\n\t\t\t\t\t\t\tsessionId: agent.id,\n\t\t\t\t\t\t\trunning: status === "running"\n\t\t\t\t\t\t}));\n\t\t\t\t\t}),';
const HOST_STATUS_INSERT = 'ctx.on("agent/status", ({ agent, status }) => {\n\t\t\t\t\t\tif (agent && agent.id) dshSessionRunningState.set(agent.id, status === "running");\n\t\t\t\t\t\tqueue.push(frame({\n\t\t\t\t\t\t\ttype: "host/session-status",\n\t\t\t\t\t\t\tsessionId: agent.id,\n\t\t\t\t\t\t\trunning: status === "running"\n\t\t\t\t\t\t}));\n\t\t\t\t\t}),';

const HOST_SCHEMA_ANCHOR = 'const workspaceArchiveSessionValueSchema = z$1.object({ archivedSessionIds: z$1.array(sessionIdSchema) });';
const HOST_SCHEMA_INSERT = 'const workspaceArchiveSessionValueSchema = z$1.object({ archivedSessionIds: z$1.array(sessionIdSchema) });\n/** workspace.unarchiveSession request payload. */\nconst workspaceUnarchiveSessionRequestSchema = z$1.object({ sessionId: sessionIdSchema });\n/** workspace.unarchiveSession response value: the full updated archive set. */\nconst workspaceUnarchiveSessionValueSchema = z$1.object({ archivedSessionIds: z$1.array(sessionIdSchema) });\n/** workspace.deleteSession request payload. */\nconst workspaceDeleteSessionRequestSchema = z$1.object({ sessionId: sessionIdSchema });\n/** workspace.deleteSession response value. */\nconst workspaceDeleteSessionValueSchema = z$1.object({ deleted: z$1.boolean() });';

const HOST_HANDLER_ANCHOR = '"workspace.archiveSession": {\n\t\tschema: workspaceArchiveSessionRequestSchema,\n\t\tinvoke: (api, r) => api.workspace.archiveSession(r)\n\t},';
const HOST_HANDLER_INSERT = '"workspace.archiveSession": {\n\t\tschema: workspaceArchiveSessionRequestSchema,\n\t\tinvoke: (api, r) => api.workspace.archiveSession(r)\n\t},\n\t"workspace.unarchiveSession": {\n\t\tschema: workspaceUnarchiveSessionRequestSchema,\n\t\tinvoke: (api, r) => api.workspace.unarchiveSession(r)\n\t},\n\t"workspace.deleteSession": {\n\t\tschema: workspaceDeleteSessionRequestSchema,\n\t\tinvoke: (api, r) => api.workspace.deleteSession(r)\n\t},';

// ---------------------------------------------------------------------------
// 3. dsh-client-connection：workspace API 面 + unary 响应 schema
// ---------------------------------------------------------------------------
const CONN_SCHEMA_ANCHOR = 'const workspaceArchiveSessionValueSchema = object({ archivedSessionIds: array(sessionIdSchema) });';
const CONN_SCHEMA_INSERT = 'const workspaceArchiveSessionValueSchema = object({ archivedSessionIds: array(sessionIdSchema) });\n\t\tconst workspaceUnarchiveSessionValueSchema = object({ archivedSessionIds: array(sessionIdSchema) });\n\t\tconst workspaceDeleteSessionValueSchema = object({ deleted: boolean() });';

const CONN_UNARY_ANCHOR = '"workspace.archiveSession": workspaceArchiveSessionValueSchema,';
const CONN_UNARY_INSERT = '"workspace.archiveSession": workspaceArchiveSessionValueSchema,\n"workspace.unarchiveSession": workspaceUnarchiveSessionValueSchema,\n"workspace.deleteSession": workspaceDeleteSessionValueSchema,';

const CONN_FACADE_ANCHOR = 'archiveSession: (payload, signal) => this.callUnary("workspace.archiveSession", payload, signal)';
const CONN_FACADE_INSERT = 'archiveSession: (payload, signal) => this.callUnary("workspace.archiveSession", payload, signal),\n\t\t\t\tunarchiveSession: (payload, signal) => this.callUnary("workspace.unarchiveSession", payload, signal),\n\t\t\t\tdeleteSession: (payload, signal) => this.callUnary("workspace.deleteSession", payload, signal)';

// ---------------------------------------------------------------------------
// 5.（内核 0.1.2-alpha.1+）RPC 面换血后的落点：dsh-host-apiproxy 已移除
//    （迁移为 typert Remote 服务）。宿主 RPC 挂 dsh-api-workspace-controller
//    （类方法 + Remote 装饰器 + typert.host 注册表），客户端 facade 挂其
//    lib/client.js 两层（model + command），api-remotes/lib/client.js 持有
//    客户端 schema 注册表。锚点为 0.1.2 产物形态；未命中只告警不损坏。
// ---------------------------------------------------------------------------
// 5a-0. controller 类注入声明（sessions/sessionPersistence —— 删除链路用；
// commands/feed 属性实例与 controller 共享同一 ctx，注入声明必须挂在真正
// 挂载的 controller 类上，锚 = 其 typert+workspaceRegistry 行）。
const CTRL_INJECT_ANCHOR = 'static inject = ["typert", "workspaceRegistry"];';
const CTRL_INJECT_INSERT = 'static inject = ["typert", "workspaceRegistry", "sessions", "sessionPersistence"];';

// 5a-1. commands 类业务实现（锚：commands 版 archiveSession 方法整体——
// 它与 controller 版的区别是 async + try/registry 直调。锚点取方法头到
// requireWorkspace 后继，只在 commands 类出现）。
const CTRL_METHOD_ANCHOR = 'async archiveSession(request) {\n\t\ttry {\n\t\t\tawait this.ctx.workspaceRegistry.archiveSession(request.sessionId);\n\t\t} catch (error) {\n\t\t\tif (!(error instanceof WorkspaceUnknownSessionError)) throw error;\n\t\t\tthrow failure("session-not-found", error.message, { sessionId: request.sessionId });\n\t\t}\n\t\treturn { archivedSessionIds: [...this.ctx.workspaceRegistry.archivedSessionIds] };\n\t}\n\trequireWorkspace(workspaceId) {';
const CTRL_METHOD_INSERT = 'async archiveSession(request) {\n\t\ttry {\n\t\t\tawait this.ctx.workspaceRegistry.archiveSession(request.sessionId);\n\t\t} catch (error) {\n\t\t\tif (!(error instanceof WorkspaceUnknownSessionError)) throw error;\n\t\t\tthrow failure("session-not-found", error.message, { sessionId: request.sessionId });\n\t\t}\n\t\treturn { archivedSessionIds: [...this.ctx.workspaceRegistry.archivedSessionIds] };\n\t}\n\t/**\n\t* dsh-desktop patch (session manage): 恢复归档（幂等移出归档集合）。\n\t*/\n\tasync unarchiveSession(request) {\n\t\ttry {\n\t\t\tawait this.ctx.workspaceRegistry.unarchiveSession(request.sessionId);\n\t\t} catch (error) {\n\t\t\tif (!(error instanceof WorkspaceUnknownSessionError)) throw error;\n\t\t\tthrow failure("session-not-found", error.message, { sessionId: request.sessionId });\n\t\t}\n\t\treturn { archivedSessionIds: [...this.ctx.workspaceRegistry.archivedSessionIds] };\n\t}\n\t/**\n\t* dsh-desktop patch (session manage): 删除会话（拒绝运行中 → 移除目录 →\n\t* 摘除 live 注册表 → 清理归档集合）。目录布局复刻 dsh-session-persistence-\n\t* jsonl 约定。\n\t*/\n\tasync deleteSession(request) {\n\t\tconst { sessionId } = request;\n\t\tif (dshDesktopSessionRunning.get(sessionId) === true) {\n\t\t\tthrow failure("session-running", "cannot delete a running session: stop it first", { sessionId });\n\t\t}\n\t\tconst rm = (await import("node:fs/promises")).rm;\n\t\tconst join = (await import("node:path")).join;\n\t\ttry {\n\t\t\tconst headers = await this.ctx.get("sessionPersistence").list();\n\t\t\tconst header = headers.find((entry) => entry && entry.id === sessionId);\n\t\t\tif (header !== void 0) {\n\t\t\t\tconst encodeSeg = (raw) => {\n\t\t\t\t\tif (raw === ".") return "~002E";\n\t\t\t\t\tif (raw === "..") return "~002E~002E";\n\t\t\t\t\tlet out = "";\n\t\t\t\t\tfor (let i = 0; i < raw.length; i++) {\n\t\t\t\t\t\tconst code = raw.charCodeAt(i);\n\t\t\t\t\t\tconst ch = String.fromCharCode(code);\n\t\t\t\t\t\tif (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;\n\t\t\t\t\t\telse out += "~" + code.toString(16).toUpperCase().padStart(4, "0");\n\t\t\t\t\t}\n\t\t\t\t\treturn out;\n\t\t\t\t};\n\t\t\t\tconst projectKeyOf = (cwd) => {\n\t\t\t\t\tlet readable = "";\n\t\t\t\t\tlet separatorRun = false;\n\t\t\t\t\tfor (let i = 0; i < cwd.length; i++) {\n\t\t\t\t\t\tconst code = cwd.charCodeAt(i);\n\t\t\t\t\t\tconst ch = String.fromCharCode(code);\n\t\t\t\t\t\tif (ch === "/" || ch === "\\\\" || ch === ":") {\n\t\t\t\t\t\t\tif (!separatorRun) readable += "-";\n\t\t\t\t\t\t\tseparatorRun = true;\n\t\t\t\t\t\t\t} else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {\n\t\t\t\t\t\t\t\treadable += ch;\n\t\t\t\t\t\t\t\tseparatorRun = false;\n\t\t\t\t\t\t\t} else {\n\t\t\t\t\t\t\t\treadable += "~" + code.toString(16).toUpperCase().padStart(4, "0");\n\t\t\t\t\t\t\t\tseparatorRun = false;\n\t\t\t\t\t\t\t}\n\t\t\t\t\t}\n\t\t\t\t\treturn `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;\n\t\t\t\t};\n\t\t\t\tconst { dshHomePath } = await import("@deepseek-ai/dsh-home-paths");\n\t\t\t\tconst dir = join(dshHomePath("sessions"), header.cwd === void 0 ? "_no-cwd" : projectKeyOf(header.cwd), encodeSeg(sessionId));\n\t\t\t\tawait rm(dir, { recursive: true, force: true });\n\t\t\t}\n\t\t} catch (error) {\n\t\t\tif (!(error instanceof WorkspaceUnknownSessionError)) throw error;\n\t\t}\n\t\tconst removed = this.ctx.sessions ? this.ctx.sessions.remove(sessionId) : false;\n\t\tif (!removed) this.ctx.emit("session/disposed", { id: sessionId });\n\t\tawait this.ctx.workspaceRegistry.unarchiveSession(sessionId);\n\t\treturn { deleted: true };\n\t}\n\trequireWorkspace(workspaceId) {';

// 5a-2. controller 类 Remote 薄代理（锚：controller 版 archiveSession 薄代理
// + follow 后继）。controller 方法非 async、转发 commands。
const CTRL_PROXY_ANCHOR = 'archiveSession(request) {\n\t\t\treturn this.commands.archiveSession(request);\n\t\t}\n\t\t/**\n\t\t* Stream a complete Workspace baseline followed by ordered increments.';
const CTRL_PROXY_INSERT = 'archiveSession(request) {\n\t\t\treturn this.commands.archiveSession(request);\n\t\t}\n\t\t/**\n\t\t* dsh-desktop patch (session manage): 恢复归档。\n\t\t*/\n\t\tunarchiveSession(request) {\n\t\t\treturn this.commands.unarchiveSession(request);\n\t\t}\n\t\t/**\n\t\t* dsh-desktop patch (session manage): 删除会话。\n\t\t*/\n\t\tdeleteSession(request) {\n\t\t\treturn this.commands.deleteSession(request);\n\t\t}\n\t\t/**\n\t\t* Stream a complete Workspace baseline followed by ordered increments.';

// 5b. 装饰器变量 + __esDecorate 注册（锚：archiveSession 的两处形态）。
const CTRL_DECORATOR_ANCHOR = '_archiveSession_decorators = [Remote("archiveSession")];';
const CTRL_DECORATOR_INSERT = '_archiveSession_decorators = [Remote("archiveSession")];\n\t\t\tlet _unarchiveSession_decorators = [Remote("unarchiveSession")];\n\t\t\tlet _deleteSession_decorators = [Remote("deleteSession")];';

const CTRL_ESDECORATE_ANCHOR = 'name: "archiveSession",\n\t\t\t\tstatic: false,\n\t\t\t\tprivate: false,\n\t\t\t\taccess: {\n\t\t\t\t\thas: (obj) => "archiveSession" in obj,\n\t\t\t\t\tget: (obj) => obj.archiveSession\n\t\t\t\t},\n\t\t\t\tmetadata: _metadata\n\t\t\t}, null, _instanceExtraInitializers);\n\t\t\t__esDecorate(this, null, _follow_decorators,';
const CTRL_ESDECORATE_INSERT = 'name: "archiveSession",\n\t\t\t\tstatic: false,\n\t\t\t\tprivate: false,\n\t\t\t\taccess: {\n\t\t\t\t\thas: (obj) => "archiveSession" in obj,\n\t\t\t\t\tget: (obj) => obj.archiveSession\n\t\t\t\t},\n\t\t\t\tmetadata: _metadata\n\t\t\t}, null, _instanceExtraInitializers);\n\t\t\t__esDecorate(this, null, _unarchiveSession_decorators, {\n\t\t\t\tkind: "method",\n\t\t\t\tname: "unarchiveSession",\n\t\t\t\tstatic: false,\n\t\t\t\tprivate: false,\n\t\t\t\taccess: {\n\t\t\t\t\thas: (obj) => "unarchiveSession" in obj,\n\t\t\t\t\tget: (obj) => obj.unarchiveSession\n\t\t\t\t},\n\t\t\t\tmetadata: _metadata\n\t\t\t}, null, _instanceExtraInitializers);\n\t\t\t__esDecorate(this, null, _deleteSession_decorators, {\n\t\t\t\tkind: "method",\n\t\t\t\tname: "deleteSession",\n\t\t\t\tstatic: false,\n\t\t\t\tprivate: false,\n\t\t\t\taccess: {\n\t\t\t\t\thas: (obj) => "deleteSession" in obj,\n\t\t\t\t\tget: (obj) => obj.deleteSession\n\t\t\t\t},\n\t\t\t\tmetadata: _metadata\n\t\t\t}, null, _instanceExtraInitializers);\n\t\t\t__esDecorate(this, null, _follow_decorators,';

// 5b-2. 运行状态映射（锚：controller 首行 import）。
const CTRL_RUNNING_ANCHOR = 'import { Remote, TypertRemoteFailure, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";';
const CTRL_RUNNING_INSERT = 'import { Remote, TypertRemoteFailure, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";\n// dsh-desktop patch (session manage): 每会话最近一次 agent 运行状态（删除守卫用）。\nconst dshDesktopSessionRunning = /* @__PURE__ */ new Map();';

// 5b-3. 运行状态同步监听（0.1.2 补位）：rc.2 时代由 dsh-host-apiproxy 的
// host 流监听 agent/status 维护该 Map，0.1.2 apiproxy 移除后无人写入、
// 守卫失效（运行中会话可被误删）。挂在 WorkspaceFeed 构造器的 app ctx 上，
// 与 session controller 的 agent/status 监听同一作用域语义。
const CTRL_FEED_ANCHOR = 'ctx.on("domain/changed", (change) => {\n\t\t\tthis.changed(change);\n\t\t});';
const CTRL_FEED_INSERT = 'ctx.on("domain/changed", (change) => {\n\t\t\tthis.changed(change);\n\t\t});\n\t\t\t// dsh-desktop patch (session manage): 同步每会话运行状态（删除守卫；\n\t\t\t// 0.1.2 补位 —— apiproxy 移除后 rc.2 的维护监听随之消失）。\n\t\t\tctx.on("agent/status", ({ agent, status }) => {\n\t\t\t\tif (agent && agent.id) dshDesktopSessionRunning.set(agent.id, status === "running");\n\t\t\t});';

// 5c. typert.host 注册表条目（锚：archiveSession 条目头；insert 复用参数/结果
// schema 常量 —— unarchive 与 archive 同形，delete 结果 { deleted } 复用
// WorkspaceArchiveValue 声明（zod 端实际校验宽松：object passthrough 不存在，
// 多余字段被剥除；deleted:true 会通过）。引号风格单引号。
const TYPERT_ENTRY_ANCHOR = "id: '@deepseek-ai/dsh-api-workspace-controller#workspace/archiveSession',";
const TYPERT_ENTRY_INSERT = `id: '@deepseek-ai/dsh-api-workspace-controller#workspace/unarchiveSession',
      service: 'workspaceController',
      namespace: 'workspace',
      method: 'unarchiveSession',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'request',
          wire: 'request',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceArchiveSessionRequest',
            schema: _deepseek_ai_dsh_api_workspace_controller_workspace_archiveSession_parameter_0$schema,
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: '@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceArchiveValue',
        schema: _deepseek_ai_dsh_api_workspace_controller_workspace_deleteSession_result$schema,
      },
      sourceLocation: {"file":"packages/api/workspace-controller/src/index.ts","line":1,"column":1},
    },
    {
      id: '@deepseek-ai/dsh-api-workspace-controller#workspace/deleteSession',
      service: 'workspaceController',
      namespace: 'workspace',
      method: 'deleteSession',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'request',
          wire: 'request',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceArchiveSessionRequest',
            schema: _deepseek_ai_dsh_api_workspace_controller_workspace_archiveSession_parameter_0$schema,
          },
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: '@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceArchiveValue',
        schema: _deepseek_ai_dsh_api_workspace_controller_workspace_deleteSession_result$schema,
      },
      sourceLocation: {"file":"packages/api/workspace-controller/src/index.ts","line":1,"column":1},
    },
    {
      id: '@deepseek-ai/dsh-api-workspace-controller#workspace/archiveSession',`;

// 5c-2. typert.host 需要的新 zod 常量（delete 结果形态；锚：archiveSession 结果常量行）。
const TYPERT_SCHEMA_ANCHOR = 'const _deepseek_ai_dsh_api_workspace_controller_workspace_archiveSession_result$schema = z.object({';
const TYPERT_SCHEMA_INSERT = 'const _deepseek_ai_dsh_api_workspace_controller_workspace_deleteSession_result$schema = z.object({ "deleted": z.boolean().readonly() });\n\t\tconst _deepseek_ai_dsh_api_workspace_controller_workspace_archiveSession_result$schema = z.object({';

// 5d. api-remotes 客户端注册表（锚 = 条目开括号行 + id 行整体，缩进 4/5 tab；
// 插入体为两个完整条目 + 锚点原文回填）。
const REMOTES_ENTRY_ANCHOR = '\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/archiveSession",';
const REMOTES_SCHEMA_ANCHOR = 'const _deepseek_ai_dsh_api_workspace_controller_workspace_archiveSession_result$schema = object({';
const REMOTES_SCHEMA_INSERT = 'const _deepseek_ai_dsh_api_workspace_controller_workspace_deleteSession_result$schema = object({ "deleted": boolean().readonly() });\n\t\tconst _deepseek_ai_dsh_api_workspace_controller_workspace_archiveSession_result$schema = object({';

// 5e. controller 客户端 facade（model 层）。
const CTRL_CLIENT_MODEL_ANCHOR = 'async archiveSession(sessionId) {\n\t\t\t\tconst result = await this.remote.archiveSession({ sessionId });\n\t\t\t\tif (result.ok) this.installArchived(result.value.archivedSessionIds);\n\t\t\t\treturn result;\n\t\t\t}';
const CTRL_CLIENT_MODEL_INSERT = 'async archiveSession(sessionId) {\n\t\t\t\tconst result = await this.remote.archiveSession({ sessionId });\n\t\t\t\tif (result.ok) this.installArchived(result.value.archivedSessionIds);\n\t\t\t\treturn result;\n\t\t\t}\n\t\t\t/**\n\t\t\t* dsh-desktop patch (session manage): 恢复归档并落位新归档集。\n\t\t\t*/\n\t\t\tasync unarchiveSession(sessionId) {\n\t\t\t\tconst result = await this.remote.unarchiveSession({ sessionId });\n\t\t\t\tif (result.ok) this.installArchived(result.value.archivedSessionIds);\n\t\t\t\treturn result;\n\t\t\t}\n\t\t\t/**\n\t\t\t* dsh-desktop patch (session manage): 删除会话（服务端已移目录与注册表）。\n\t\t\t*/\n\t\t\tasync deleteSession(sessionId) {\n\t\t\t\treturn await this.remote.deleteSession({ sessionId });\n\t\t\t}';

// 5f. controller 客户端 facade（command 层）。
const CTRL_CLIENT_CMD_ANCHOR = 'async archiveSession(sessionId) {\n\t\t\t\tconst result = await this.model.archiveSession(sessionId);\n\t\t\t\tif (!result.ok) throw commandError("session archive", result.error);\n\t\t\t}';
const CTRL_CLIENT_CMD_INSERT = 'async archiveSession(sessionId) {\n\t\t\t\tconst result = await this.model.archiveSession(sessionId);\n\t\t\t\tif (!result.ok) throw commandError("session archive", result.error);\n\t\t\t}\n\t\t\tasync unarchiveSession(sessionId) {\n\t\t\t\tconst result = await this.model.unarchiveSession(sessionId);\n\t\t\t\tif (!result.ok) throw commandError("session unarchive", result.error);\n\t\t\t}\n\t\t\tasync deleteSession(sessionId) {\n\t\t\t\tconst result = await this.model.deleteSession(sessionId);\n\t\t\t\tif (!result.ok) throw commandError("session delete", result.error);\n\t\t\t}';

// ---------------------------------------------------------------------------
// 4. dsh-client-ui-workspace：会话行菜单「删除对话」+ 翻译
// ---------------------------------------------------------------------------
const UI_MENU_ANCHOR = '{\n\t\t\t\t\tid: "archive",\n\t\t\t\t\tlabel: t("menu.archiveSession"),\n\t\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutline20, { size: 16 })\n\t\t\t\t}\n\t\t\t];';
const UI_MENU_INSERT = '{\n\t\t\t\t\tid: "archive",\n\t\t\t\t\tlabel: t("menu.archiveSession"),\n\t\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutline20, { size: 16 })\n\t\t\t\t},\n\t\t\t\t// dsh-desktop patch (session manage): 归档下方增加删除。\n\t\t\t\t{\n\t\t\t\t\tid: "delete",\n\t\t\t\t\tlabel: t("menu.deleteSession")\n\t\t\t\t}\n\t\t\t];';
// 旧版补丁（v1：当前会话行不显示删除）→ 升级为无条件显示（用户反馈当前会话
// 行的 ⋯ 菜单里看不到删除按钮）。
const UI_MENU_UPGRADE_ANCHOR = '...(node.id !== currentId ? [{\n\t\t\t\t\tid: "delete",\n\t\t\t\t\tlabel: t("menu.deleteSession")\n\t\t\t\t}] : [])';
const UI_MENU_UPGRADE_INSERT = '{\n\t\t\t\t\tid: "delete",\n\t\t\t\t\tlabel: t("menu.deleteSession")\n\t\t\t\t}';

const UI_SELECT_ANCHOR = 'if (id === "archive") onArchive(node.id);';
const UI_SELECT_INSERT = 'if (id === "archive") onArchive(node.id);\n\t\t\t\t\t\t\t\t\tif (id === "delete") window.__dshSessionManager?.deleteSession(node.id);';

const UI_ZH_ANCHOR = '"menu.archiveSession": "归档会话",';
const UI_ZH_INSERT = '"menu.archiveSession": "归档会话",\n\t\t\t"menu.deleteSession": "删除对话",';
const UI_EN_ANCHOR = '"menu.archiveSession": "Archive session",';
const UI_EN_INSERT = '"menu.archiveSession": "Archive session",\n\t\t\t"menu.deleteSession": "Delete conversation",';

// ---------------------------------------------------------------------------
// 工具：在文件中做「锚点必须存在 + 标记幂等」的替换
// ---------------------------------------------------------------------------
function writeAtomic(file, content, enc) {
  const tmp = file + '.tmp-' + Date.now() + '-' + Math.random().toString(16).slice(2, 6);
  require('node:fs').writeFileSync(tmp, content, enc);
  try { require('node:fs').renameSync(tmp, file); } catch (e) {
    require('node:fs').rmSync(file, { force: true, maxRetries: 3 });
    require('node:fs').renameSync(tmp, file);
  }
}
function applyReplacements(file, replacements, upgradeRules, log) {
  let src;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch (err) {
    log('session-manage 补丁: 读取失败 ' + file + ': ' + err.message);
    return false;
  }
  if (src.includes(MARKER)) {
    // 已应用：仍执行「升级替换」（旧版补丁 → 新版语义，幂等），
    // 例如 v1「当前会话行不显示删除」→ v2「所有会话行显示删除」。
    // skipIf：insert 以 anchor 为前缀的插入型升级必须自带防重门槛，
    // 否则 anchor 永远命中、监听会被反复叠加。
    let upgraded = false;
    for (const { anchor, insert, skipIf } of upgradeRules) {
      if (skipIf !== undefined && src.includes(skipIf)) continue;
      if (src.includes(anchor)) {
        src = src.replace(anchor, () => insert);
        upgraded = true;
      }
    }
    if (upgraded) {
      try {
        writeAtomic(file, src, 'utf8');
        log('session-manage 补丁: 已升级 ' + file);
        return true;
      } catch (err) {
        log('session-manage 补丁: 升级写入失败 ' + file + ': ' + err.message);
        return false;
      }
    }
    log('session-manage 补丁: 已应用，跳过 ' + file);
    return false;
  }
  for (const r of replacements) {
    // 多候选（anyOf）：同一处补丁在不同内核版本构建产物上的锚点差异，
    // 依序取第一个命中的候选；全部未命中才判定失配跳过整文件。
    const candidates = r.anyOf || [r];
    const hit = candidates.find((c) => src.includes(c.anchor));
    if (!hit) {
      log('session-manage 补丁: 锚点未匹配（dsh 版本可能已变化），跳过 ' + file + ' :: ' + candidates[0].anchor.slice(0, 60));
      return false;
    }
    src = src.replace(hit.anchor, () => hit.insert);
  }
  src = '// ' + MARKER + ': 对话删除/归档管理运行时补丁\n' + src;
  try {
    writeAtomic(file, src, 'utf8');
    log('session-manage 补丁: 已应用 ' + file);
    return true;
  } catch (err) {
    log('session-manage 补丁: 写入失败 ' + file + ': ' + err.message);
    return false;
  }
}

/**
 * 对某个 node_modules 根目录应用对话删除/归档管理补丁（幂等）。
 * @param {string} nmRoot node_modules 根目录
 * @param {(msg: string) => void} [log]
 * @returns {number} 实际发生修改的文件数
 */
// 5d-2. api-remotes 条目（双引号形态；参数/结果 schema 常量同包内可用）。
function remotesEntryInsert() {
  // 真实产物缩进 = 6 tab（条目成员），7 tab（parameters 成员），8 tab（codec 成员）。
  // 每个条目以 '        {' 开头（4 tab + 花括号，与原条目间隔一致）。
  const T6 = '\t\t\t\t\t\t';
  const T7 = '\t\t\t\t\t\t\t';
  const T8 = '\t\t\t\t\t\t\t\t';
  const entry = (id, method) => [
    '        {',
    `${T6}id: "${id}",`,
    `${T6}service: "workspaceController",`,
    `${T6}namespace: "workspace",`,
    `${T6}method: "${method}",`,
    `${T6}invocation: { kind: "direct" },`,
    `${T6}parameters: [{`,
    `${T7}name: "request",`,
    `${T7}wire: "request",`,
    `${T7}source: "json",`,
    `${T7}codec: {`,
    `${T8}mode: "strict",`,
    `${T8}typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceArchiveSessionRequest",`,
    `${T8}schema: _deepseek_ai_dsh_api_workspace_controller_workspace_archiveSession_parameter_0$schema`,
    `${T7}}`,
    `${T6}}],`,
    `${T6}result: {`,
    `${T7}mode: "strict",`,
    `${T7}typeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceArchiveValue",`,
    `${T7}schema: _deepseek_ai_dsh_api_workspace_controller_workspace_deleteSession_result$schema`,
    `${T6}},`,
    `${T6}sourceLocation: {`,
    `${T7}"file": "packages/api/workspace-controller/src/index.ts",`,
    `${T7}"line": 1,`,
    `${T7}"column": 1`,
    `${T6}}`,
    '        },',
  ].join('\n');
  return [
    entry('@deepseek-ai/dsh-api-workspace-controller#workspace/unarchiveSession', 'unarchiveSession'),
    entry('@deepseek-ai/dsh-api-workspace-controller#workspace/deleteSession', 'deleteSession'),
  ].join('\n');
}

function patchSessionManage(nmRoot, log = () => {}) {
  const targets = [
    {
      file: path.join(nmRoot, '@deepseek-ai', 'dsh-workspace', 'lib', 'index.js'),
      replacements: [{ anchor: WS_ANCHOR, insert: WS_ANCHOR + '\n' + WS_INSERT }],
    },
    {
      file: path.join(nmRoot, '@deepseek-ai', 'dsh-session', 'lib', 'index.js'),
      replacements: [{ anchor: SESSION_ANCHOR, insert: SESSION_INSERT }],
    },
    {
      file: path.join(nmRoot, '@deepseek-ai', 'dsh-host-apiproxy', 'lib', 'index.js'),
      replacements: [
        { anchor: HOST_IMPORT_ANCHOR, insert: HOST_IMPORT_NEW },
        { anchor: HOST_IMPORT_JOIN_ANCHOR, insert: HOST_IMPORT_JOIN_NEW },
        { anyOf: [
          { anchor: HOST_MAP_ANCHOR, insert: HOST_MAP_INSERT },
          { anchor: HOST_MAP_ANCHOR_RC7, insert: HOST_MAP_INSERT_RC7 },
        ] },
        { anchor: HOST_API_ANCHOR, insert: HOST_API_INSERT },
        { anchor: HOST_SCHEMA_ANCHOR, insert: HOST_SCHEMA_INSERT },
        { anchor: HOST_HANDLER_ANCHOR, insert: HOST_HANDLER_INSERT },
        { anchor: HOST_STATUS_ANCHOR, insert: HOST_STATUS_INSERT },
      ],
    },
    {
      file: path.join(nmRoot, '@deepseek-ai', 'dsh-client-connection', 'lib', 'client.js'),
      replacements: [
        { anchor: CONN_SCHEMA_ANCHOR, insert: CONN_SCHEMA_INSERT },
        { anchor: CONN_UNARY_ANCHOR, insert: CONN_UNARY_INSERT },
        { anchor: CONN_FACADE_ANCHOR, insert: CONN_FACADE_INSERT },
      ],
    },
    {
      file: path.join(nmRoot, '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js'),
      replacements: [
        { anchor: UI_MENU_ANCHOR, insert: UI_MENU_INSERT },
        { anchor: UI_SELECT_ANCHOR, insert: UI_SELECT_INSERT },
        { anchor: UI_ZH_ANCHOR, insert: UI_ZH_INSERT },
        { anchor: UI_EN_ANCHOR, insert: UI_EN_INSERT },
      ],
      upgradeRules: [
        { anchor: UI_MENU_UPGRADE_ANCHOR, insert: UI_MENU_UPGRADE_INSERT },
      ],
    },
    // ---- 内核 0.1.2-alpha.1+：typert Remote 服务落点（见第 5 节注释）----
    {
      file: path.join(nmRoot, '@deepseek-ai', 'dsh-api-workspace-controller', 'lib', 'index.js'),
      replacements: [
        { anchor: CTRL_RUNNING_ANCHOR, insert: CTRL_RUNNING_INSERT },
        { anchor: CTRL_INJECT_ANCHOR, insert: CTRL_INJECT_INSERT },
        { anchor: CTRL_METHOD_ANCHOR, insert: CTRL_METHOD_INSERT },
        { anchor: CTRL_PROXY_ANCHOR, insert: CTRL_PROXY_INSERT },
        { anchor: CTRL_DECORATOR_ANCHOR, insert: CTRL_DECORATOR_INSERT },
        { anchor: CTRL_ESDECORATE_ANCHOR, insert: CTRL_ESDECORATE_INSERT },
        { anchor: CTRL_FEED_ANCHOR, insert: CTRL_FEED_INSERT },
      ],
      // 已打补丁的文件（含 MARKER）也要补上 0.1.2 运行守卫监听。
      upgradeRules: [
        { anchor: CTRL_FEED_ANCHOR, insert: CTRL_FEED_INSERT, skipIf: '同步每会话运行状态' },
      ],
    },
    {
      file: path.join(nmRoot, '@deepseek-ai', 'dsh-api-workspace-controller', 'lib', 'typert.host.js'),
      replacements: [
        { anchor: TYPERT_SCHEMA_ANCHOR, insert: TYPERT_SCHEMA_INSERT },
        { anchor: TYPERT_ENTRY_ANCHOR, insert: TYPERT_ENTRY_INSERT },
      ],
    },
    {
      file: path.join(nmRoot, '@deepseek-ai', 'dsh-api-workspace-controller', 'lib', 'client.js'),
      replacements: [
        { anchor: CTRL_CLIENT_MODEL_ANCHOR, insert: CTRL_CLIENT_MODEL_INSERT },
        { anchor: CTRL_CLIENT_CMD_ANCHOR, insert: CTRL_CLIENT_CMD_INSERT },
      ],
    },
    {
      file: path.join(nmRoot, '@deepseek-ai', 'dsh-api-remotes', 'lib', 'client.js'),
      replacements: [
        { anchor: REMOTES_SCHEMA_ANCHOR, insert: REMOTES_SCHEMA_INSERT },
        { anchor: REMOTES_ENTRY_ANCHOR, insert: remotesEntryInsert() + '\n' + REMOTES_ENTRY_ANCHOR },
      ],
    },
    // ---- 内核 0.2.x：deleteSession（见第 6 节）----
    {
      file: path.join(nmRoot, '@deepseek-ai', 'dsh-api-workspace-controller', 'lib', 'index.js'),
      replacements: [
        { anchor: CTRL_DELETE_ANCHOR, insert: CTRL_DELETE_INSERT },
        { anchor: CTRL6_LET_ANCHOR, insert: CTRL6_LET_INSERT },
        { anchor: CTRL6_DECL_ANCHOR, insert: CTRL6_DECL_INSERT },
        { anchor: CTRL6_ESD_ANCHOR, insert: CTRL6_ESD_INSERT },
        { anchor: CTRL6_PROXY_ANCHOR, insert: CTRL6_PROXY_INSERT },
      ],
    },
    {
      file: path.join(nmRoot, '@deepseek-ai', 'dsh-api-workspace-controller', 'lib', 'typert.host.js'),
      replacements: [
        { anchor: TYPERT6_SCHEMA_ANCHOR, insert: TYPERT6_SCHEMA_INSERT },
        { anchor: TYPERT6_ENTRY_ANCHOR, insert: TYPERT6_ENTRY_INSERT },
        { anchor: TYPERT6_MODEL_ANCHOR, insert: TYPERT6_MODEL_INSERT },
      ],
    },
    {
      file: path.join(nmRoot, '@deepseek-ai', 'dsh-api-remotes', 'lib', 'client.js'),
      replacements: [
        { anchor: REMOTES6_SCHEMA_ANCHOR, insert: REMOTES6_SCHEMA_INSERT },
        { anchor: REMOTES6_ENTRY_ANCHOR, insert: REMOTES6_ENTRY_INSERT },
      ],
    },
    // ---- 内核 0.2.x：deleteSession 客户端链路（见第 6e 节）----
    {
      file: path.join(nmRoot, '@deepseek-ai', 'dsh-api-workspace-controller', 'lib', 'client.js'),
      replacements: [
        { anchor: CTRL_CLIENT_DELETE_MODEL_ANCHOR, insert: CTRL_CLIENT_DELETE_MODEL_INSERT },
        { anchor: CTRL_CLIENT_DELETE_CMD_ANCHOR, insert: CTRL_CLIENT_DELETE_CMD_INSERT },
      ],
    },
    {
      file: path.join(nmRoot, '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js'),
      replacements: [
        { anchor: UI_WS_DELETE_ANCHOR, insert: UI_WS_DELETE_INSERT },
        { anchor: UI_INJECT_DELETE_ANCHOR, insert: UI_INJECT_DELETE_INSERT },
        { anchor: UI_COMP_DELETE_ANCHOR, insert: UI_COMP_DELETE_INSERT },
        { anchor: UI_MENU_DELETE_ANCHOR, insert: UI_MENU_DELETE_INSERT },
        { anchor: UI_ZH_DELETE_ANCHOR, insert: UI_ZH_DELETE_INSERT },
        { anchor: UI_EN_DELETE_ANCHOR, insert: UI_EN_DELETE_INSERT },
      ],
    },
  ];
  let changed = 0;
  for (const t of targets) {
    if (!fs.existsSync(t.file)) continue;
    if (applyReplacements(t.file, t.replacements, t.upgradeRules || [], log)) changed += 1;
  }
  return changed;
}

// ---------------------------------------------------------------------------
// 6.（内核 0.2.x）deleteSession 落点
//
// 与第 5 节的关系：第 5 节是 0.1.2-alpha.1 时为「dsh-host-apiproxy 被移除」
// 加的移植。0.2.x 又往前走了两步：
//   · unarchiveSession 已被内核原生实现（workspaceRegistry + controller +
//     Remote 装饰器 + typert 注册齐全），第 5 节插它的部分全部多余；
//   · 原生的 workspace/delete 删的是 **workspace 注册**
//     （WorkspaceDeleteRequest.workspaceId），不是会话。
// 所以这里只补 deleteSession 一条链路，锚点全部取自 0.2.x 原生
// unarchiveSession 的对应位置 —— 上游结构一动，锚点就随之失配并跳过，
// 不会静默写坏文件。
// ---------------------------------------------------------------------------
const CTRL_DELETE_ANCHOR = '\tasync unarchiveSession(request) {\n\t\tawait this.ctx.workspaceRegistry.unarchiveSession(request.sessionId);\n\t\treturn { archivedSessionIds: [...this.ctx.workspaceRegistry.archivedSessionIds] };\n\t}';
const CTRL_DELETE_INSERT = '\tasync unarchiveSession(request) {\n\t\tawait this.ctx.workspaceRegistry.unarchiveSession(request.sessionId);\n\t\treturn { archivedSessionIds: [...this.ctx.workspaceRegistry.archivedSessionIds] };\n\t}\n\n\t/**\n\t* dsh-desktop patch (session manage): delete one Session.\n\t*\n\t* 内核没有删除对话的能力：原生 `workspace/delete` 删的是 workspace 注册\n\t* （WorkspaceDeleteRequest.workspaceId），不是 session。这里补上：\n\t* 运行中拒绝 → 移除持久化目录 → 从 live 注册表摘除 → 清理归档集合。\n\t*\n\t* 运行中判定走**原生** `workspace/session-activity` waterfall，而不是旧补丁\n\t* 里那张 dshDesktopSessionRunning 全局表 —— 那个表只在补丁自己维护的事件里\n\t* 更新，别的 surface（子代理、定时任务）起的会话它看不到。\n\t* @param request - 要删除的会话 id。\n\t* @returns deleted: true（会话已不存在）。\n\t*/\n\tasync deleteSession(request) {\n\t\tconst { sessionId } = request;\n\t\tconst activity = await this.ctx.waterfall("workspace/session-activity", { sessionId }, () => Promise.resolve([]));\n\t\tif (activity !== void 0 && activity.length > 0) {\n\t\t\tthrow new RemoteError("session/running", `cannot delete a running session: ${activity.map((entry) => entry.kind).join(", ")}`, {\n\t\t\t\tsessionId,\n\t\t\t\tactivity\n\t\t\t});\n\t\t}\n\t\tconst headers = await this.ctx.get("sessionPersistence").list();\n\t\tconst header = headers.find((entry) => entry !== void 0 && entry.id === sessionId);\n\t\tif (header !== void 0) {\n\t\t\tconst encodeSeg = (raw) => {\n\t\t\t\tif (raw === ".") return "~002E";\n\t\t\t\tif (raw === "..") return "~002E~002E";\n\t\t\t\tlet out = "";\n\t\t\t\tfor (let i = 0; i < raw.length; i++) {\n\t\t\t\t\tconst code = raw.charCodeAt(i);\n\t\t\t\t\tconst ch = String.fromCharCode(code);\n\t\t\t\t\tif (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;\n\t\t\t\t\telse out += "~" + code.toString(16).toUpperCase().padStart(4, "0");\n\t\t\t\t}\n\t\t\t\treturn out;\n\t\t\t};\n\t\t\tconst projectKeyOf = (cwd) => {\n\t\t\t\tlet readable = "";\n\t\t\t\tlet separatorRun = false;\n\t\t\t\tfor (let i = 0; i < cwd.length; i++) {\n\t\t\t\t\tconst code = cwd.charCodeAt(i);\n\t\t\t\t\tconst ch = String.fromCharCode(code);\n\t\t\t\t\tif (ch === "/" || ch === "\\\\" || ch === ":") {\n\t\t\t\t\t\tif (!separatorRun) readable += "-";\n\t\t\t\t\t\tseparatorRun = true;\n\t\t\t\t\t} else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {\n\t\t\t\t\t\treadable += ch;\n\t\t\t\t\t\tseparatorRun = false;\n\t\t\t\t\t} else {\n\t\t\t\t\t\treadable += "~" + code.toString(16).toUpperCase().padStart(4, "0");\n\t\t\t\t\t\tseparatorRun = false;\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t\treturn `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;\n\t\t\t};\n\t\t\tconst { dshHomePath } = await import("@deepseek-ai/dsh-home-paths");\n\t\t\tconst { join } = await import("node:path");\n\t\t\tconst { rm } = await import("node:fs/promises");\n\t\t\tconst dir = join(dshHomePath("sessions"), header.cwd === void 0 ? "_no-cwd" : projectKeyOf(header.cwd), encodeSeg(sessionId));\n\t\t\tawait rm(dir, { recursive: true, force: true });\n\t\t}\n\t\tconst removed = this.ctx.sessions !== void 0 ? this.ctx.sessions.remove(sessionId) : false;\n\t\tif (!removed) this.ctx.emit("session/disposed", { id: sessionId });\n\t\tawait this.ctx.workspaceRegistry.unarchiveSession(sessionId);\n\t\treturn { deleted: true };\n\t}';

const TYPERT6_SCHEMA_ANCHOR = 'const _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_result$schema = () => (_deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_result$schema$value ??= z.object({\n  \'archivedSessionIds\': z.array(z.intersection(z.string(), z.unknown())).readonly(),\n}))';
const TYPERT6_SCHEMA_INSERT = 'let _deepseek_ai_dsh_api_workspace_controller_workspace_deleteSession_parameter_0$schema$value\nconst _deepseek_ai_dsh_api_workspace_controller_workspace_deleteSession_parameter_0$schema = () => (_deepseek_ai_dsh_api_workspace_controller_workspace_deleteSession_parameter_0$schema$value ??= z.object({\n  \'sessionId\': z.intersection(z.string(), z.unknown()).readonly(),\n}))\nlet _deepseek_ai_dsh_api_workspace_controller_workspace_deleteSession_result$schema$value\nconst _deepseek_ai_dsh_api_workspace_controller_workspace_deleteSession_result$schema = () => (_deepseek_ai_dsh_api_workspace_controller_workspace_deleteSession_result$schema$value ??= z.object({\n  \'deleted\': z.literal(true).readonly(),\n}))\nconst _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_result$schema = () => (_deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_result$schema$value ??= z.object({\n  \'archivedSessionIds\': z.array(z.intersection(z.string(), z.unknown())).readonly(),\n}))';

const TYPERT6_ENTRY_ANCHOR = '\n    {\n      id: \'@deepseek-ai/dsh-api-workspace-controller#workspace/unarchiveSession\',\n      service: \'workspaceController\',\n      namespace: \'workspace\',\n      method: \'unarchiveSession\',\n      invocation: { kind: \'direct\' },\n      parameters: [\n        {\n          name: \'request\',\n          wire: \'request\',\n          source: \'json\',\n          codec: {\n            mode: \'strict\',\n            typeSymbol: \'@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceUnarchiveSessionRequest\',\n            create: _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_parameter_0$schema,\n          },\n        },\n      ],\n      result: {\n        mode: \'strict\',\n        typeSymbol: \'@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceArchiveValue\',\n        create: _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_result$schema,\n      },\n      sourceLocation: {"file":"packages/api/workspace-controller/src/index.ts","line":165,"column":3},\n    },';
const TYPERT6_ENTRY_INSERT = '\n    {\n      id: \'@deepseek-ai/dsh-api-workspace-controller#workspace/unarchiveSession\',\n      service: \'workspaceController\',\n      namespace: \'workspace\',\n      method: \'unarchiveSession\',\n      invocation: { kind: \'direct\' },\n      parameters: [\n        {\n          name: \'request\',\n          wire: \'request\',\n          source: \'json\',\n          codec: {\n            mode: \'strict\',\n            typeSymbol: \'@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceUnarchiveSessionRequest\',\n            create: _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_parameter_0$schema,\n          },\n        },\n      ],\n      result: {\n        mode: \'strict\',\n        typeSymbol: \'@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceArchiveValue\',\n        create: _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_result$schema,\n      },\n      sourceLocation: {"file":"packages/api/workspace-controller/src/index.ts","line":165,"column":3},\n    },\n\n    {\n      id: \'@deepseek-ai/dsh-api-workspace-controller#workspace/deleteSession\',\n      service: \'workspaceController\',\n      namespace: \'workspace\',\n      method: \'deleteSession\',\n      invocation: { kind: \'direct\' },\n      parameters: [\n        {\n          name: \'request\',\n          wire: \'request\',\n          source: \'json\',\n          codec: {\n            mode: \'strict\',\n            typeSymbol: \'@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceDeleteSessionRequest\',\n            create: _deepseek_ai_dsh_api_workspace_controller_workspace_deleteSession_parameter_0$schema,\n          },\n        },\n      ],\n      result: {\n        mode: \'strict\',\n        typeSymbol: \'@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceDeleteSessionValue\',\n        create: _deepseek_ai_dsh_api_workspace_controller_workspace_deleteSession_result$schema,\n      },\n      sourceLocation: {"file":"packages/api/workspace-controller/src/index.ts","line":165,"column":3},\n    },';

const TYPERT6_MODEL_ANCHOR = '          {\n            "kind": "method",\n            "name": "unarchiveSession",\n            "signature": "@Remote(\'unarchiveSession\') unarchiveSession(request: WorkspaceUnarchiveSessionRequest): Promise<WorkspaceArchiveValue>",\n            "summary": "Restore one archived Session to Workspace grouping surfaces.",\n            "jsDoc": "/**\\n * Restore one archived Session to Workspace grouping surfaces.\\n * @param request - Session identity to unarchive.\\n * @returns the complete resulting archive set.\\n */"\n          },';
const TYPERT6_MODEL_INSERT = '          {\n            "kind": "method",\n            "name": "unarchiveSession",\n            "signature": "@Remote(\'unarchiveSession\') unarchiveSession(request: WorkspaceUnarchiveSessionRequest): Promise<WorkspaceArchiveValue>",\n            "summary": "Restore one archived Session to Workspace grouping surfaces.",\n            "jsDoc": "/**\\n * Restore one archived Session to Workspace grouping surfaces.\\n * @param request - Session identity to unarchive.\\n * @returns the complete resulting archive set.\\n */"\n          },\n          {\n            "kind": "method",\n            "name": "deleteSession",\n            "signature": "@Remote(\'deleteSession\') deleteSession(request: WorkspaceDeleteSessionRequest): Promise<WorkspaceDeleteSessionValue>",\n            "summary": "Delete a Session: refused while its work is running; otherwise its persisted directory is removed and it is dropped from the live registry.",\n            "jsDoc": "/**\\n * dsh-desktop patch (session manage): delete one Session.\\n * Refused while the Session has running work (workspace/session-activity);\\n * otherwise its persisted directory is removed, it is detached from the live\\n * registry, and it is dropped from the archive set.\\n * @param request - Session identity to delete.\\n * @returns deleted: true once the Session is gone.\\n */"\n          },';

const REMOTES6_SCHEMA_ANCHOR = 'const _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_result$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_result$schema$value ??= object({ "archivedSessionIds": array(intersection(string(), unknown())).readonly() });\n\t\tlet _deepseek_ai_dsh_api_workspace_controller_workspace_unpinSession_parameter_0$schema$value;\n\t\tconst _deepseek_ai_dsh_api_workspace_controller_workspace_unpinSession_parameter_0$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_unpinSession_parameter_0$schema$value ??= object({ "sessionId": intersection(string(), unknown()).readonly() });\n\t\tlet _deepseek_ai_dsh_api_workspace_controller_workspace_unpinSession_result$schema$value;\n\t\tconst _deepseek_ai_dsh_api_workspace_controller_workspace_unpinSession_result$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_unpinSession_result$schema$value ??= object({ "pinnedSessionIds": array(intersection(string(), unknown())).readonly() });\n\t\tconst TYPERT_REMOTE$2 = {\n\t\t\tpackage: "@deepseek-ai/dsh-api-workspace-controller",\n\t\t\tdescriptors: [\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#directoryPicker/createDirectory",\n\t\t\t\t\tservice: "directoryPickerController",\n\t\t\t\t\tnamespace: "directoryPicker",\n\t\t\t\t\tmethod: "createDirectory",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "path",\n\t\t\t\t\t\twire: "path",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller#directoryPicker/createDirectory:path",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_directoryPicker_createDirectory_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}, {\n\t\t\t\t\t\tname: "name",\n\t\t\t\t\t\twire: "name",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller#directoryPicker/createDirectory:name",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_directoryPicker_createDirectory_parameter_1$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller#directoryPicker/createDirectory:result",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_directoryPicker_createDirectory_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/directory-picker.ts",\n\t\t\t\t\t\t"line": 88,\n\t\t\t\t\t\t"column": 9\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#directoryPicker/list",\n\t\t\t\t\tservice: "directoryPickerController",\n\t\t\t\t\tnamespace: "directoryPicker",\n\t\t\t\t\tmethod: "list",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "path",\n\t\t\t\t\t\twire: "path",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tacceptsUndefined: true,\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller#directoryPicker/list:path",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_directoryPicker_list_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tcancellation: { parameter: "signal" },\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-host-directory-picker/types#DirectoryListing",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_directoryPicker_list_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/directory-picker.ts",\n\t\t\t\t\t\t"line": 72,\n\t\t\t\t\t\t"column": 9\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#directoryPicker/pick",\n\t\t\t\t\tservice: "directoryPickerController",\n\t\t\t\t\tnamespace: "directoryPicker",\n\t\t\t\t\tmethod: "pick",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [],\n\t\t\t\t\tcancellation: { parameter: "signal" },\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller#directoryPicker/pick:result",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_directoryPicker_pick_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/directory-picker.ts",\n\t\t\t\t\t\t"line": 55,\n\t\t\t\t\t\t"column": 9\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/archiveSession",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "archiveSession",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "request",\n\t\t\t\t\t\twire: "request",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceArchiveSessionRequest",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_archiveSession_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceArchiveValue",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_archiveSession_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 155,\n\t\t\t\t\t\t"column": 3\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/create",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "create",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "request",\n\t\t\t\t\t\twire: "request",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceCreateRequest",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_create_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceCreateValue",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_create_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 86,\n\t\t\t\t\t\t"column": 3\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/delete",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "delete",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "request",\n\t\t\t\t\t\twire: "request",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceDeleteRequest",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_delete_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceDeleteValue",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_delete_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 125,\n\t\t\t\t\t\t"column": 3\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/follow",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "follow",\n\t\t\t\t\tmode: "stream",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [],\n\t\t\t\t\tcancellation: { parameter: "signal" },\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceFollowFrame",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_follow_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 195,\n\t\t\t\t\t\t"column": 3\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/initializeDefault",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "initializeDefault",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [],\n\t\t\t\t\tcancellation: { parameter: "signal" },\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller#workspace/initializeDefault:result",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_initializeDefault_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 99,\n\t\t\t\t\t\t"column": 9\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/insertBefore",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "insertBefore",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "request",\n\t\t\t\t\t\twire: "request",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceInsertBeforeRequest",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_insertBefore_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceOrderValue",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_insertBefore_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 135,\n\t\t\t\t\t\t"column": 3\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/insertSessionBefore",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "insertSessionBefore",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "request",\n\t\t\t\t\t\twire: "request",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceInsertSessionBeforeRequest",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_insertSessionBefore_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceValue",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_insertSessionBefore_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 145,\n\t\t\t\t\t\t"column": 3\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/pinSession",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "pinSession",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "request",\n\t\t\t\t\t\twire: "request",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspacePinSessionRequest",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_pinSession_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspacePinValue",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_pinSession_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 175,\n\t\t\t\t\t\t"column": 3\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/rename",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "rename",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "request",\n\t\t\t\t\t\twire: "request",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceRenameRequest",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_rename_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceValue",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_rename_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 115,\n\t\t\t\t\t\t"column": 3\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/unarchiveSession",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "unarchiveSession",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "request",\n\t\t\t\t\t\twire: "request",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceUnarchiveSessionRequest",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceArchiveValue",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 165,\n\t\t\t\t\t\t"column": 3\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/unpinSession",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "unpinSession",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "request",\n\t\t\t\t\t\twire: "request",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceUnpinSessionRequest",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_unpinSession_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspacePinValue",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_unpinSession_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 185,\n\t\t\t\t\t\t"column": 3\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t]\n\t\t};\n\t\t//#endregion\n\t\t//#region ../terminal-controller/lib/typert.remote-client.js\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_close_parameter_0$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_close_parameter_0$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_close_parameter_0$schema$value ??= intersection(string(), unknown());\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_close_parameter_1$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_close_parameter_1$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_close_parameter_1$schema$value ??= intersection(string(), unknown());\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_close_result$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_close_result$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_close_result$schema$value ??= _void();\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_create_parameter_0$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_create_parameter_0$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_create_parameter_0$schema$value ??= intersection(string(), unknown());\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_create_parameter_1$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_create_parameter_1$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_create_parameter_1$schema$value ??= object({\n\t\t\t"shellPath": string().readonly().optional(),\n\t\t\t"id": intersection(string(), unknown()).readonly(),\n\t\t\t"cols": number().readonly(),\n\t\t\t"rows": number().readonly()\n\t\t});\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_create_result$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_create_result$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_create_result$schema$value ??= object({\n\t\t\t"id": intersection(string(), unknown()).readonly(),\n\t\t\t"title": string().readonly(),\n\t\t\t"shell": object({\n\t\t\t\t"path": string().readonly(),\n\t\t\t\t"args": array(string()).readonly(),\n\t\t\t\t"name": string().readonly()\n\t\t\t}).readonly(),\n\t\t\t"cwd": string().readonly(),\n\t\t\t"cols": number().readonly(),\n\t\t\t"rows": number().readonly(),\n\t\t\t"state": union([\n\t\t\t\tliteral("failed"),\n\t\t\t\tliteral("running"),\n\t\t\t\tliteral("exited")\n\t\t\t]).readonly(),\n\t\t\t"exitCode": union([literal(null), number()]).readonly(),\n\t\t\t"error": string().readonly().optional(),\n\t\t\t"controllerId": intersection(string(), unknown()).readonly().optional()\n\t\t});\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_environment_parameter_0$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_environment_parameter_0$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_environment_parameter_0$schema$value ??= intersection(string(), unknown());\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_environment_result$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_environment_result$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_environment_result$schema$value ??= object({\n\t\t\t"cwd": string().readonly(),\n\t\t\t"maxInputBytes": number().readonly(),\n\t\t\t"maxCols": number().readonly(),\n\t\t\t"maxRows": number().readonly(),\n\t\t\t"scrollback": number().readonly()\n\t\t});\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_0$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_0$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_0$schema$value ??= intersection(string(), unknown());\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_1$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_1$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_1$schema$value ??= intersection(string(), unknown());\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_2$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_2$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_2$schema$value ??= intersection(string(), unknown());\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_follow_result$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_follow_result$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_follow_result$schema$value ??= union([\n\t\t\tobject({\n\t\t\t\t"type": literal("snapshot").readonly(),\n\t\t\t\t"sequence": number().readonly(),\n\t\t\t\t"screen": string().readonly(),\n\t\t\t\t"info": object({\n\t\t\t\t\t"id": intersection(string(), unknown()).readonly(),\n\t\t\t\t\t"title": string().readonly(),\n\t\t\t\t\t"shell": object({\n\t\t\t\t\t\t"path": string().readonly(),\n\t\t\t\t\t\t"args": array(string()).readonly(),\n\t\t\t\t\t\t"name": string().readonly()\n\t\t\t\t\t}).readonly(),\n\t\t\t\t\t"cwd": string().readonly(),\n\t\t\t\t\t"cols": number().readonly(),\n\t\t\t\t\t"rows": number().readonly(),\n\t\t\t\t\t"state": union([\n\t\t\t\t\t\tliteral("failed"),\n\t\t\t\t\t\tliteral("running"),\n\t\t\t\t\t\tliteral("exited")\n\t\t\t\t\t]).readonly(),\n\t\t\t\t\t"exitCode": union([literal(null), number()]).readonly(),\n\t\t\t\t\t"error": string().readonly().optional(),\n\t\t\t\t\t"controllerId": intersection(string(), unknown()).readonly().optional()\n\t\t\t\t}).readonly()\n\t\t\t}),\n\t\t\tobject({\n\t\t\t\t"type": literal("output").readonly(),\n\t\t\t\t"sequence": number().readonly(),\n\t\t\t\t"data": string().readonly()\n\t\t\t}),\n\t\t\tobject({\n\t\t\t\t"type": literal("state").readonly(),\n\t\t\t\t"info": object({\n\t\t\t\t\t"id": intersection(string(), unknown()).readonly(),\n\t\t\t\t\t"title": string().readonly(),\n\t\t\t\t\t"shell": object({\n\t\t\t\t\t\t"path": string().readonly(),\n\t\t\t\t\t\t"args": array(string()).readonly(),\n\t\t\t\t\t\t"name": string().readonly()\n\t\t\t\t\t}).readonly(),\n\t\t\t\t\t"cwd": string().readonly(),\n\t\t\t\t\t"cols": number().readonly(),\n\t\t\t\t\t"rows": number().readonly(),\n\t\t\t\t\t"state": union([\n\t\t\t\t\t\tliteral("failed"),\n\t\t\t\t\t\tliteral("running"),\n\t\t\t\t\t\tliteral("exited")\n\t\t\t\t\t]).readonly(),\n\t\t\t\t\t"exitCode": union([literal(null), number()]).readonly(),\n\t\t\t\t\t"error": string().readonly().optional(),\n\t\t\t\t\t"controllerId": intersection(string(), unknown()).readonly().optional()\n\t\t\t\t}).readonly()\n\t\t\t})\n\t\t]);\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_list_parameter_0$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_list_parameter_0$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_list_parameter_0$schema$value ??= intersection(string(), unknown());\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_list_result$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_list_result$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_list_result$schema$value ??= array(object({\n\t\t\t"id": intersection(string(), unknown()).readonly(),\n\t\t\t"title": string().readonly(),\n\t\t\t"shell": object({\n\t\t\t\t"path": string().readonly(),\n\t\t\t\t"args": array(string()).readonly(),\n\t\t\t\t"name": string().readonly()\n\t\t\t}).readonly(),\n\t\t\t"cwd": string().readonly(),\n\t\t\t"cols": number().readonly(),\n\t\t\t"rows": number().readonly(),\n\t\t\t"state": union([\n\t\t\t\tliteral("failed"),\n\t\t\t\tliteral("running"),\n\t\t\t\tliteral("exited")\n\t\t\t]).readonly(),\n\t\t\t"exitCode": union([literal(null), number()]).readonly(),\n\t\t\t"error": string().readonly().optional(),\n\t\t\t"controllerId": intersection(string(), unknown()).readonly().optional()\n\t\t}));';
const REMOTES6_SCHEMA_INSERT = 'let _deepseek_ai_dsh_api_workspace_controller_workspace_deleteSession_parameter_0$schema$value\nconst _deepseek_ai_dsh_api_workspace_controller_workspace_deleteSession_parameter_0$schema = () => (_deepseek_ai_dsh_api_workspace_controller_workspace_deleteSession_parameter_0$schema$value ??= object({\n  \'sessionId\': intersection(string(), unknown()).readonly(),\n}))\nlet _deepseek_ai_dsh_api_workspace_controller_workspace_deleteSession_result$schema$value\nconst _deepseek_ai_dsh_api_workspace_controller_workspace_deleteSession_result$schema = () => (_deepseek_ai_dsh_api_workspace_controller_workspace_deleteSession_result$schema$value ??= object({\n  \'deleted\': literal(true).readonly(),\n}))\nconst _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_result$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_result$schema$value ??= object({ "archivedSessionIds": array(intersection(string(), unknown())).readonly() });\n\t\tlet _deepseek_ai_dsh_api_workspace_controller_workspace_unpinSession_parameter_0$schema$value;\n\t\tconst _deepseek_ai_dsh_api_workspace_controller_workspace_unpinSession_parameter_0$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_unpinSession_parameter_0$schema$value ??= object({ "sessionId": intersection(string(), unknown()).readonly() });\n\t\tlet _deepseek_ai_dsh_api_workspace_controller_workspace_unpinSession_result$schema$value;\n\t\tconst _deepseek_ai_dsh_api_workspace_controller_workspace_unpinSession_result$schema = () => _deepseek_ai_dsh_api_workspace_controller_workspace_unpinSession_result$schema$value ??= object({ "pinnedSessionIds": array(intersection(string(), unknown())).readonly() });\n\t\tconst TYPERT_REMOTE$2 = {\n\t\t\tpackage: "@deepseek-ai/dsh-api-workspace-controller",\n\t\t\tdescriptors: [\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#directoryPicker/createDirectory",\n\t\t\t\t\tservice: "directoryPickerController",\n\t\t\t\t\tnamespace: "directoryPicker",\n\t\t\t\t\tmethod: "createDirectory",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "path",\n\t\t\t\t\t\twire: "path",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller#directoryPicker/createDirectory:path",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_directoryPicker_createDirectory_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}, {\n\t\t\t\t\t\tname: "name",\n\t\t\t\t\t\twire: "name",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller#directoryPicker/createDirectory:name",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_directoryPicker_createDirectory_parameter_1$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller#directoryPicker/createDirectory:result",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_directoryPicker_createDirectory_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/directory-picker.ts",\n\t\t\t\t\t\t"line": 88,\n\t\t\t\t\t\t"column": 9\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#directoryPicker/list",\n\t\t\t\t\tservice: "directoryPickerController",\n\t\t\t\t\tnamespace: "directoryPicker",\n\t\t\t\t\tmethod: "list",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "path",\n\t\t\t\t\t\twire: "path",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tacceptsUndefined: true,\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller#directoryPicker/list:path",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_directoryPicker_list_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tcancellation: { parameter: "signal" },\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-host-directory-picker/types#DirectoryListing",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_directoryPicker_list_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/directory-picker.ts",\n\t\t\t\t\t\t"line": 72,\n\t\t\t\t\t\t"column": 9\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#directoryPicker/pick",\n\t\t\t\t\tservice: "directoryPickerController",\n\t\t\t\t\tnamespace: "directoryPicker",\n\t\t\t\t\tmethod: "pick",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [],\n\t\t\t\t\tcancellation: { parameter: "signal" },\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller#directoryPicker/pick:result",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_directoryPicker_pick_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/directory-picker.ts",\n\t\t\t\t\t\t"line": 55,\n\t\t\t\t\t\t"column": 9\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/archiveSession",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "archiveSession",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "request",\n\t\t\t\t\t\twire: "request",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceArchiveSessionRequest",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_archiveSession_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceArchiveValue",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_archiveSession_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 155,\n\t\t\t\t\t\t"column": 3\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/create",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "create",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "request",\n\t\t\t\t\t\twire: "request",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceCreateRequest",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_create_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceCreateValue",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_create_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 86,\n\t\t\t\t\t\t"column": 3\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/delete",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "delete",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "request",\n\t\t\t\t\t\twire: "request",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceDeleteRequest",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_delete_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceDeleteValue",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_delete_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 125,\n\t\t\t\t\t\t"column": 3\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/follow",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "follow",\n\t\t\t\t\tmode: "stream",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [],\n\t\t\t\t\tcancellation: { parameter: "signal" },\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceFollowFrame",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_follow_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 195,\n\t\t\t\t\t\t"column": 3\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/initializeDefault",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "initializeDefault",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [],\n\t\t\t\t\tcancellation: { parameter: "signal" },\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller#workspace/initializeDefault:result",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_initializeDefault_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 99,\n\t\t\t\t\t\t"column": 9\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/insertBefore",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "insertBefore",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "request",\n\t\t\t\t\t\twire: "request",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceInsertBeforeRequest",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_insertBefore_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceOrderValue",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_insertBefore_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 135,\n\t\t\t\t\t\t"column": 3\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/insertSessionBefore",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "insertSessionBefore",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "request",\n\t\t\t\t\t\twire: "request",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceInsertSessionBeforeRequest",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_insertSessionBefore_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceValue",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_insertSessionBefore_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 145,\n\t\t\t\t\t\t"column": 3\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/pinSession",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "pinSession",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "request",\n\t\t\t\t\t\twire: "request",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspacePinSessionRequest",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_pinSession_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspacePinValue",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_pinSession_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 175,\n\t\t\t\t\t\t"column": 3\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/rename",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "rename",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "request",\n\t\t\t\t\t\twire: "request",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceRenameRequest",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_rename_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceValue",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_rename_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 115,\n\t\t\t\t\t\t"column": 3\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/unarchiveSession",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "unarchiveSession",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "request",\n\t\t\t\t\t\twire: "request",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceUnarchiveSessionRequest",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceArchiveValue",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 165,\n\t\t\t\t\t\t"column": 3\n\t\t\t\t\t}\n\t\t\t\t},\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/unpinSession",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "unpinSession",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "request",\n\t\t\t\t\t\twire: "request",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceUnpinSessionRequest",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_unpinSession_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspacePinValue",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_unpinSession_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 185,\n\t\t\t\t\t\t"column": 3\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t]\n\t\t};\n\t\t//#endregion\n\t\t//#region ../terminal-controller/lib/typert.remote-client.js\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_close_parameter_0$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_close_parameter_0$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_close_parameter_0$schema$value ??= intersection(string(), unknown());\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_close_parameter_1$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_close_parameter_1$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_close_parameter_1$schema$value ??= intersection(string(), unknown());\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_close_result$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_close_result$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_close_result$schema$value ??= _void();\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_create_parameter_0$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_create_parameter_0$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_create_parameter_0$schema$value ??= intersection(string(), unknown());\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_create_parameter_1$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_create_parameter_1$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_create_parameter_1$schema$value ??= object({\n\t\t\t"shellPath": string().readonly().optional(),\n\t\t\t"id": intersection(string(), unknown()).readonly(),\n\t\t\t"cols": number().readonly(),\n\t\t\t"rows": number().readonly()\n\t\t});\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_create_result$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_create_result$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_create_result$schema$value ??= object({\n\t\t\t"id": intersection(string(), unknown()).readonly(),\n\t\t\t"title": string().readonly(),\n\t\t\t"shell": object({\n\t\t\t\t"path": string().readonly(),\n\t\t\t\t"args": array(string()).readonly(),\n\t\t\t\t"name": string().readonly()\n\t\t\t}).readonly(),\n\t\t\t"cwd": string().readonly(),\n\t\t\t"cols": number().readonly(),\n\t\t\t"rows": number().readonly(),\n\t\t\t"state": union([\n\t\t\t\tliteral("failed"),\n\t\t\t\tliteral("running"),\n\t\t\t\tliteral("exited")\n\t\t\t]).readonly(),\n\t\t\t"exitCode": union([literal(null), number()]).readonly(),\n\t\t\t"error": string().readonly().optional(),\n\t\t\t"controllerId": intersection(string(), unknown()).readonly().optional()\n\t\t});\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_environment_parameter_0$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_environment_parameter_0$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_environment_parameter_0$schema$value ??= intersection(string(), unknown());\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_environment_result$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_environment_result$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_environment_result$schema$value ??= object({\n\t\t\t"cwd": string().readonly(),\n\t\t\t"maxInputBytes": number().readonly(),\n\t\t\t"maxCols": number().readonly(),\n\t\t\t"maxRows": number().readonly(),\n\t\t\t"scrollback": number().readonly()\n\t\t});\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_0$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_0$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_0$schema$value ??= intersection(string(), unknown());\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_1$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_1$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_1$schema$value ??= intersection(string(), unknown());\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_2$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_2$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_follow_parameter_2$schema$value ??= intersection(string(), unknown());\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_follow_result$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_follow_result$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_follow_result$schema$value ??= union([\n\t\t\tobject({\n\t\t\t\t"type": literal("snapshot").readonly(),\n\t\t\t\t"sequence": number().readonly(),\n\t\t\t\t"screen": string().readonly(),\n\t\t\t\t"info": object({\n\t\t\t\t\t"id": intersection(string(), unknown()).readonly(),\n\t\t\t\t\t"title": string().readonly(),\n\t\t\t\t\t"shell": object({\n\t\t\t\t\t\t"path": string().readonly(),\n\t\t\t\t\t\t"args": array(string()).readonly(),\n\t\t\t\t\t\t"name": string().readonly()\n\t\t\t\t\t}).readonly(),\n\t\t\t\t\t"cwd": string().readonly(),\n\t\t\t\t\t"cols": number().readonly(),\n\t\t\t\t\t"rows": number().readonly(),\n\t\t\t\t\t"state": union([\n\t\t\t\t\t\tliteral("failed"),\n\t\t\t\t\t\tliteral("running"),\n\t\t\t\t\t\tliteral("exited")\n\t\t\t\t\t]).readonly(),\n\t\t\t\t\t"exitCode": union([literal(null), number()]).readonly(),\n\t\t\t\t\t"error": string().readonly().optional(),\n\t\t\t\t\t"controllerId": intersection(string(), unknown()).readonly().optional()\n\t\t\t\t}).readonly()\n\t\t\t}),\n\t\t\tobject({\n\t\t\t\t"type": literal("output").readonly(),\n\t\t\t\t"sequence": number().readonly(),\n\t\t\t\t"data": string().readonly()\n\t\t\t}),\n\t\t\tobject({\n\t\t\t\t"type": literal("state").readonly(),\n\t\t\t\t"info": object({\n\t\t\t\t\t"id": intersection(string(), unknown()).readonly(),\n\t\t\t\t\t"title": string().readonly(),\n\t\t\t\t\t"shell": object({\n\t\t\t\t\t\t"path": string().readonly(),\n\t\t\t\t\t\t"args": array(string()).readonly(),\n\t\t\t\t\t\t"name": string().readonly()\n\t\t\t\t\t}).readonly(),\n\t\t\t\t\t"cwd": string().readonly(),\n\t\t\t\t\t"cols": number().readonly(),\n\t\t\t\t\t"rows": number().readonly(),\n\t\t\t\t\t"state": union([\n\t\t\t\t\t\tliteral("failed"),\n\t\t\t\t\t\tliteral("running"),\n\t\t\t\t\t\tliteral("exited")\n\t\t\t\t\t]).readonly(),\n\t\t\t\t\t"exitCode": union([literal(null), number()]).readonly(),\n\t\t\t\t\t"error": string().readonly().optional(),\n\t\t\t\t\t"controllerId": intersection(string(), unknown()).readonly().optional()\n\t\t\t\t}).readonly()\n\t\t\t})\n\t\t]);\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_list_parameter_0$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_list_parameter_0$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_list_parameter_0$schema$value ??= intersection(string(), unknown());\n\t\tlet _deepseek_ai_dsh_api_terminal_controller_terminal_list_result$schema$value;\n\t\tconst _deepseek_ai_dsh_api_terminal_controller_terminal_list_result$schema = () => _deepseek_ai_dsh_api_terminal_controller_terminal_list_result$schema$value ??= array(object({\n\t\t\t"id": intersection(string(), unknown()).readonly(),\n\t\t\t"title": string().readonly(),\n\t\t\t"shell": object({\n\t\t\t\t"path": string().readonly(),\n\t\t\t\t"args": array(string()).readonly(),\n\t\t\t\t"name": string().readonly()\n\t\t\t}).readonly(),\n\t\t\t"cwd": string().readonly(),\n\t\t\t"cols": number().readonly(),\n\t\t\t"rows": number().readonly(),\n\t\t\t"state": union([\n\t\t\t\tliteral("failed"),\n\t\t\t\tliteral("running"),\n\t\t\t\tliteral("exited")\n\t\t\t]).readonly(),\n\t\t\t"exitCode": union([literal(null), number()]).readonly(),\n\t\t\t"error": string().readonly().optional(),\n\t\t\t"controllerId": intersection(string(), unknown()).readonly().optional()\n\t\t}));';

const REMOTES6_ENTRY_ANCHOR = '\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/unarchiveSession",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "unarchiveSession",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "request",\n\t\t\t\t\t\twire: "request",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceUnarchiveSessionRequest",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceArchiveValue",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 165,\n\t\t\t\t\t\t"column": 3\n\t\t\t\t\t}\n\t\t\t\t},';
const REMOTES6_ENTRY_INSERT = '\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/unarchiveSession",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "unarchiveSession",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "request",\n\t\t\t\t\t\twire: "request",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceUnarchiveSessionRequest",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceArchiveValue",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_unarchiveSession_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 165,\n\t\t\t\t\t\t"column": 3\n\t\t\t\t\t}\n\t\t\t\t},\n\n\t\t\t\t{\n\t\t\t\t\tid: "@deepseek-ai/dsh-api-workspace-controller#workspace/deleteSession",\n\t\t\t\t\tservice: "workspaceController",\n\t\t\t\t\tnamespace: "workspace",\n\t\t\t\t\tmethod: "deleteSession",\n\t\t\t\t\tinvocation: { kind: "direct" },\n\t\t\t\t\tparameters: [{\n\t\t\t\t\t\tname: "request",\n\t\t\t\t\t\twire: "request",\n\t\t\t\t\t\tsource: "json",\n\t\t\t\t\t\tcodec: {\n\t\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceDeleteSessionRequest",\n\t\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_deleteSession_parameter_0$schema\n\t\t\t\t\t\t}\n\t\t\t\t\t}],\n\t\t\t\t\tresult: {\n\t\t\t\t\t\tmode: "strict",\n\t\t\t\t\t\ttypeSymbol: "@deepseek-ai/dsh-api-workspace-controller/types#WorkspaceDeleteSessionValue",\n\t\t\t\t\t\tcreate: _deepseek_ai_dsh_api_workspace_controller_workspace_deleteSession_result$schema\n\t\t\t\t\t},\n\t\t\t\t\tsourceLocation: {\n\t\t\t\t\t\t"file": "packages/api/workspace-controller/src/index.ts",\n\t\t\t\t\t\t"line": 165,\n\t\t\t\t\t\t"column": 3\n\t\t\t\t\t}\n\t\t\t\t},';


// 6a-6d. WorkspaceController 的 Remote 暴露面。
//
// commands 类是内部实现，WorkspaceController 才是 ctx.remote 的入口 ——
// 后者上每个 Remote 方法需要四处（容易漏，实测漏了就在运行期
// method-not-found）：
//   let 声明 / 类体赋 [Remote(...)] / 类体末尾 __esDecorate 注册 / 薄代理转发
const CTRL6_LET_ANCHOR = '\tlet _unarchiveSession_decorators;';
const CTRL6_LET_INSERT = '\tlet _unarchiveSession_decorators;\n\tlet _deleteSession_decorators;';

const CTRL6_DECL_ANCHOR = '\t\t\t_unarchiveSession_decorators = [Remote("unarchiveSession")];';
const CTRL6_DECL_INSERT = '\t\t\t_unarchiveSession_decorators = [Remote("unarchiveSession")];\n\t\t\t_deleteSession_decorators = [Remote("deleteSession")];';

const CTRL6_ESD_ANCHOR = '\t\t\t__esDecorate(this, null, _unarchiveSession_decorators, {\n\t\t\t\tkind: "method",\n\t\t\t\tname: "unarchiveSession",\n\t\t\t\tstatic: false,\n\t\t\t\tprivate: false,\n\t\t\t\taccess: {\n\t\t\t\t\thas: (obj) => "unarchiveSession" in obj,\n\t\t\t\t\tget: (obj) => obj.unarchiveSession\n\t\t\t\t},\n\t\t\t\tmetadata: _metadata\n\t\t\t}, null, _instanceExtraInitializers);';
const CTRL6_ESD_INSERT = '\t\t\t__esDecorate(this, null, _unarchiveSession_decorators, {\n\t\t\t\tkind: "method",\n\t\t\t\tname: "unarchiveSession",\n\t\t\t\tstatic: false,\n\t\t\t\tprivate: false,\n\t\t\t\taccess: {\n\t\t\t\t\thas: (obj) => "unarchiveSession" in obj,\n\t\t\t\t\tget: (obj) => obj.unarchiveSession\n\t\t\t\t},\n\t\t\t\tmetadata: _metadata\n\t\t\t}, null, _instanceExtraInitializers);\n\t\t\t__esDecorate(this, null, _deleteSession_decorators, {\n\t\t\t\tkind: "method",\n\t\t\t\tname: "deleteSession",\n\t\t\t\tstatic: false,\n\t\t\t\tprivate: false,\n\t\t\t\taccess: {\n\t\t\t\t\thas: (obj) => "deleteSession" in obj,\n\t\t\t\t\tget: (obj) => obj.deleteSession\n\t\t\t\t},\n\t\t\t\tmetadata: _metadata\n\t\t\t}, null, _instanceExtraInitializers);';

const CTRL6_PROXY_ANCHOR = '\t\tunarchiveSession(request) {\n\t\t\treturn this.commands.unarchiveSession(request);\n\t\t}';
const CTRL6_PROXY_INSERT = '\t\tunarchiveSession(request) {\n\t\t\treturn this.commands.unarchiveSession(request);\n\t\t}\n\t\t/**\n\t\t* dsh-desktop patch (session manage): delete one Session.\n\t\t* 薄代理，真正做事的是 commands.deleteSession。\n\t\t*/\n\t\tdeleteSession(request) {\n\t\t\treturn this.commands.deleteSession(request);\n\t\t}';


// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// 6e. deleteSession 的客户端链路（UI 菜单 → uiWorkspace → workspaces → remote）
//
// 0.2.x 的调用链：
//   sidebar.workspaces.session.menu.item 槽位的菜单项
//     → uiWorkspace.deleteSession          （dsh-client-ui-workspace）
//       → this.workspaces.deleteSession    （api-workspace-controller 的 client）
//         → this.remote.deleteSession      （host RPC，第 6 节已补）
//
// 菜单槽位的 order 约定（与内核一致）：pin 100 / rename 200 / fork 300 /
// archive 400，删除排 500。
// ---------------------------------------------------------------------------
const CTRL_CLIENT_DELETE_MODEL_ANCHOR = '\t\t\tasync unarchiveSession(sessionId) {\n\t\t\t\tconst requestSeq = ++this.archiveRequestSeq;\n\t\t\t\tconst result = await this.remote.unarchiveSession({ sessionId });\n\t\t\t\tif (result.ok && requestSeq === this.archiveRequestSeq) this.installArchived(result.value.archivedSessionIds);\n\t\t\t\treturn result;\n\t\t\t}';
const CTRL_CLIENT_DELETE_MODEL_INSERT = '\t\t\tasync unarchiveSession(sessionId) {\n\t\t\t\tconst requestSeq = ++this.archiveRequestSeq;\n\t\t\t\tconst result = await this.remote.unarchiveSession({ sessionId });\n\t\t\t\tif (result.ok && requestSeq === this.archiveRequestSeq) this.installArchived(result.value.archivedSessionIds);\n\t\t\t\treturn result;\n\t\t\t}\n\t\t\t/**\n\t\t\t* dsh-desktop patch (session manage): delete one Session.\n\t\t\t* 不做乐观更新：删除是不可逆操作，以 Host 返回为准。\n\t\t\t* @param sessionId - Session to delete.\n\t\t\t* @returns generated Remote result.\n\t\t\t*/\n\t\t\tasync deleteSession(sessionId) {\n\t\t\t\treturn await this.remote.deleteSession({ sessionId });\n\t\t\t}';

const CTRL_CLIENT_DELETE_CMD_ANCHOR = '\t\t\tasync unarchiveSession(sessionId) {\n\t\t\t\tconst result = await this.model.unarchiveSession(sessionId);\n\t\t\t\tif (!result.ok) throw commandError("session unarchive", result.error);\n\t\t\t}';
const CTRL_CLIENT_DELETE_CMD_INSERT = '\t\t\tasync unarchiveSession(sessionId) {\n\t\t\t\tconst result = await this.model.unarchiveSession(sessionId);\n\t\t\t\tif (!result.ok) throw commandError("session unarchive", result.error);\n\t\t\t}\n\t\t\tasync deleteSession(sessionId) {\n\t\t\t\tconst result = await this.model.deleteSession(sessionId);\n\t\t\t\tif (!result.ok) throw commandError("session delete", result.error);\n\t\t\t}';

const UI_WS_DELETE_ANCHOR = '\t\t\tasync unarchiveSession(sessionId) {\n\t\t\t\tawait this.workspaces.unarchiveSession(sessionId);\n\t\t\t}';
const UI_WS_DELETE_INSERT = '\t\t\tasync unarchiveSession(sessionId) {\n\t\t\t\tawait this.workspaces.unarchiveSession(sessionId);\n\t\t\t}\n\t\t\t/**\n\t\t\t* dsh-desktop patch (session manage): delete one Session.\n\t\t\t* 删除后若它正是主区会话，清空主区（与 archiveSession 的行为一致）。\n\t\t\t*/\n\t\t\tasync deleteSession(sessionId) {\n\t\t\t\tawait this.workspaces.deleteSession(sessionId);\n\t\t\t\tif (this.mainReference?.sessionId === sessionId) this.clearMain();\n\t\t\t}';

const UI_MENU_DELETE_ANCHOR = '\t\t\t\tyield ctx.slots.register({\n\t\t\t\t\tname: "sidebar.workspaces.session.menu.item",\n\t\t\t\t\tid: "archive",\n\t\t\t\t\torder: 400,\n\t\t\t\t\tlocale: NS,\n\t\t\t\t\tinject: archiveInjected\n\t\t\t\t}, ArchiveSessionMenuItem);';
const UI_MENU_DELETE_INSERT = '\t\t\t\tyield ctx.slots.register({\n\t\t\t\t\tname: "sidebar.workspaces.session.menu.item",\n\t\t\t\t\tid: "archive",\n\t\t\t\t\torder: 400,\n\t\t\t\t\tlocale: NS,\n\t\t\t\t\tinject: archiveInjected\n\t\t\t\t}, ArchiveSessionMenuItem);\n\t\t\t\tyield ctx.slots.register({\n\t\t\t\t\tname: "sidebar.workspaces.session.menu.item",\n\t\t\t\t\tid: "delete-session",\n\t\t\t\t\torder: 500,\n\t\t\t\t\tlocale: NS,\n\t\t\t\t\tinject: deleteSessionInjected\n\t\t\t\t}, DeleteSessionMenuItem);';

const UI_COMP_DELETE_ANCHOR = '\t\t/**\n\t\t* Hover button (order 100): archive, or restore an archived row.\n\t\t* @param props - owner share and the archive share.\n\t\t* @returns the button.\n\t\t*/\n\t\tfunction ArchiveSessionRowButton({ sessionId, useArchived, archiveSession, unarchiveSession, t }) {\n\t\t\tconst archived = useArchived((set) => set.has(sessionId));\n\t\t\treturn (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {\n\t\t\t\tlabel: t(archived ? "actions.unarchive" : "actions.archive"),\n\t\t\t\tside: "bottom",\n\t\t\t\talign: "end",\n\t\t\t\tdelayMs: 500,\n\t\t\t\tchildren: (0, react_jsx_runtime.jsx)("button", {\n\t\t\t\t\ttype: "button",\n\t\t\t\t\tclassName: Rows_module_css_default.iconButton,\n\t\t\t\t\t"aria-label": t(archived ? "menu.unarchiveSession" : "menu.archiveSession"),\n\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t(archived ? unarchiveSession : archiveSession)(sessionId);\n\t\t\t\t\t},\n\t\t\t\t\tchildren: archived ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconUnarchiveOutlineRegular, { size: 14 }) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutlineRegular, { size: 14 })\n\t\t\t\t})\n\t\t\t});\n\t\t}';
const UI_COMP_DELETE_INSERT = '\t\t/**\n\t\t* Hover button (order 100): archive, or restore an archived row.\n\t\t* @param props - owner share and the archive share.\n\t\t* @returns the button.\n\t\t*/\n\t\tfunction ArchiveSessionRowButton({ sessionId, useArchived, archiveSession, unarchiveSession, t }) {\n\t\t\tconst archived = useArchived((set) => set.has(sessionId));\n\t\t\treturn (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {\n\t\t\t\tlabel: t(archived ? "actions.unarchive" : "actions.archive"),\n\t\t\t\tside: "bottom",\n\t\t\t\talign: "end",\n\t\t\t\tdelayMs: 500,\n\t\t\t\tchildren: (0, react_jsx_runtime.jsx)("button", {\n\t\t\t\t\ttype: "button",\n\t\t\t\t\tclassName: Rows_module_css_default.iconButton,\n\t\t\t\t\t"aria-label": t(archived ? "menu.unarchiveSession" : "menu.archiveSession"),\n\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t(archived ? unarchiveSession : archiveSession)(sessionId);\n\t\t\t\t\t},\n\t\t\t\t\tchildren: archived ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconUnarchiveOutlineRegular, { size: 14 }) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconArchiveOutlineRegular, { size: 14 })\n\t\t\t\t})\n\t\t\t});\n\t\t}\n\t\t/**\n\t\t* dsh-desktop patch (session manage): 会话行菜单里的「删除对话」。\n\t\t*\n\t\t* 内核只有归档、没有删除，这里补一个 menu item（order 500，排在归档之后）。\n\t\t* 删除不可逆，先弹一次确认；取消则不调用。\n\t\t* @param props - owner share、删除动作、locale。\n\t\t* @returns the menu row.\n\t\t*/\n\t\tfunction DeleteSessionMenuItem({ sessionId, useMenuOpenState, deleteSession, t }) {\n\t\t\tconst [, setMenuOpen] = useMenuOpenState();\n\t\t\treturn (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.MenuItemButton, {\n\t\t\t\ticon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDeleteOutlineRegular, { size: 14 }),\n\t\t\t\tonSelect: () => {\n\t\t\t\t\tsetMenuOpen(false);\n\t\t\t\t\tdeleteSession(sessionId);\n\t\t\t\t},\n\t\t\t\tchildren: t("menu.deleteSession")\n\t\t\t});\n\t\t}';

const UI_INJECT_DELETE_ANCHOR = '\t\t\tconst archiveInjected = () => ({\n\t\t\t\thooks: { archived: archivedSet },';
const UI_INJECT_DELETE_INSERT = '\t\t\t/**\n\t\t\t* dsh-desktop patch (session manage): 删除动作的注入。\n\t\t\t*\n\t\t\t* 不接 toast：toast 渲染器按 kind 分支（只有 archived/stoppedAndArchived），\n\t\t\t* 加新 kind 会被静默忽略。删除成功由 Host 广播的 session/disposed\n\t\t\t* 驱动会话行移除，本来就是即时可见的。\n\t\t\t*/\n\t\t\tconst deleteSessionInjected = () => ({\n\t\t\t\tdeleteSession: (sessionId) => {\n\t\t\t\t\tuiWorkspace.deleteSession(sessionId).catch((reason) => {\n\t\t\t\t\t\tconsole.warn("session delete rejected:", reason);\n\t\t\t\t\t});\n\t\t\t\t}\n\t\t\t});\n\t\t\tconst archiveInjected = () => ({\n\t\t\t\thooks: { archived: archivedSet },';

const UI_ZH_DELETE_ANCHOR = '\t\t\t"menu.archiveSession": "归档会话",';
const UI_ZH_DELETE_INSERT = '\t\t\t"menu.archiveSession": "归档会话",\n\t\t\t"menu.deleteSession": "删除对话",';

const UI_EN_DELETE_ANCHOR = '\t\t\t"menu.archiveSession": "Archive session",';
const UI_EN_DELETE_INSERT = '\t\t\t"menu.archiveSession": "Archive session",\n\t\t\t"menu.deleteSession": "Delete conversation",';

module.exports = { patchSessionManage, MARKER };

if (require.main === module) {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..', 'node_modules');
  const n = patchSessionManage(root, (m) => console.log(m));
  console.log(n > 0 ? `patched ${n} file(s) — restart DSH Desktop to pick it up` : 'nothing to patch (already up to date)');
}
