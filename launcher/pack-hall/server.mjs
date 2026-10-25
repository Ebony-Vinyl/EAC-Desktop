// EAC 整合包大厅 · 零依赖参考服务器
// 启动：node server.mjs   （默认端口 4317，可用 PORT 环境变量覆盖）
// 数据：同目录 data/store.json；只保存整合包“清单”（引用列表），不保存任何插件本体。
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.HALL_DATA_DIR ? resolve(process.env.HALL_DATA_DIR) : join(root, "data");
const storeFile = join(dataDir, "store.json");
const PORT = Number(process.env.PORT || 4317);
const MAX_BODY = 64 * 1024;
const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;
const PLUGIN_ID = /^[A-Za-z0-9._:@/-]{1,300}$/;
const CLIENT_ID = /^[A-Za-z0-9-]{8,80}$/;

function loadStore() {
  try {
    const parsed = JSON.parse(readFileSync(storeFile, "utf8"));
    if (parsed && Array.isArray(parsed.packs)) {
      parsed.plugins ??= {};
      parsed.announcement ??= null;
      for (const entry of Object.values(parsed.plugins)) {
        entry.downloads ??= {};
        entry.seen ??= {};
        entry.likes ??= {};
      }
      return parsed;
    }
  } catch { /* 首次启动或文件损坏时重建 */ }
  return { packs: [], plugins: {}, announcement: null };
}
const store = loadStore();
function save() {
  mkdirSync(dataDir, { recursive: true });
  const tmp = `${storeFile}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  renameSync(tmp, storeFile);
}
function dayKey(offset = 0) {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}
function pluginEntry(id) {
  const entry = store.plugins[id] ??= { downloads: {}, seen: {}, likes: {} };
  entry.downloads ??= {};
  entry.seen ??= {};
  entry.likes ??= {};
  return entry;
}
function prunePlugin(entry) {
  const cutoff = dayKey(-120);
  for (const day of Object.keys(entry.downloads)) if (day < cutoff) delete entry.downloads[day];
  for (const key of Object.keys(entry.seen)) if (key.slice(0, 10) < cutoff) delete entry.seen[key];
}
function periodStart(period) {
  const days = period === "day" ? 0 : period === "week" ? 6 : 29;
  return dayKey(-days);
}
function downloadTotal(entry, period) {
  const start = periodStart(period);
  return Object.entries(entry.downloads).reduce((sum, [day, count]) => day >= start ? sum + count : sum, 0);
}
function pluginStat(id, entry, period) {
  return {
    id,
    downloads: entry ? downloadTotal(entry, period) : 0,
    likes: entry ? Object.keys(entry.likes).length : 0,
  };
}
function validRef(ref) {
  if (typeof ref !== "string" || !ref || ref.length > 300 || ref.startsWith("-") || /[\s\u0000-\u001f]/.test(ref)) return false;
  if (ref.startsWith("https://")) return true;
  if (ref.startsWith("github:")) {
    const pieces = ref.slice(7).split("#")[0].split("/");
    return pieces.length === 2 && pieces.every((p) => p && p !== "." && p !== ".." && /^[a-zA-Z0-9._-]+$/.test(p));
  }
  const at = ref.lastIndexOf("@");
  return at > 0 && NPM_NAME.test(ref.slice(0, at)) && !!ref.slice(at + 1).trim();
}
function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") return "manifest 必须是对象";
  if (manifest.format !== "eac-pack" || manifest.version !== 1) return "清单必须是 eac-pack v1 格式";
  if (typeof manifest.name !== "string" || !manifest.name.trim() || manifest.name.length > 60) return "名称缺失或超过 60 字";
  if (manifest.author !== undefined && (typeof manifest.author !== "string" || manifest.author.length > 40)) return "作者名超过 40 字";
  if (manifest.description !== undefined && (typeof manifest.description !== "string" || manifest.description.length > 280)) return "描述超过 280 字";
  if (!Array.isArray(manifest.plugins) || manifest.plugins.length > 300) return "插件列表缺失或超过 300 条";
  for (const plugin of manifest.plugins) {
    if (!plugin || typeof plugin !== "object" || typeof plugin.name !== "string" || !validRef(plugin.ref)) {
      return `插件「${plugin?.name ?? "?"}」引用不可安装`;
    }
  }
  return "";
}
function summary(pack) {
  return {
    id: pack.id,
    name: pack.manifest.name,
    author: pack.manifest.author ?? "匿名",
    description: pack.manifest.description ?? "",
    kernelVersion: pack.manifest.kernelVersion ?? null,
    pluginCount: pack.manifest.plugins.length,
    unresolvedCount: Array.isArray(pack.manifest.unresolved) ? pack.manifest.unresolved.length : 0,
    likes: pack.likes,
    downloads: pack.downloads,
    publishedAt: pack.publishedAt,
    updatedAt: pack.updatedAt ?? pack.publishedAt,
  };
}
function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "cache-control": "no-store",
  });
  res.end(payload);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(new Error("请求体超过 64KB 上限")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const route = url.pathname.replace(/\/+$/, "") || "/";
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type, authorization",
      });
      res.end();
      return;
    }
    if (route === "/api/announcement" && req.method === "GET") {
      send(res, 200, { ok: true, announcement: store.announcement ?? null });
      return;
    }
    if (route === "/api/announcement" && req.method === "POST") {
      const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      if (!process.env.ANNOUNCE_TOKEN || token !== process.env.ANNOUNCE_TOKEN) {
        send(res, 401, { ok: false, error: "公告发布需要正确的 ANNOUNCE_TOKEN" });
        return;
      }
      const body = JSON.parse(await readBody(req));
      const title = typeof body?.title === "string" ? body.title.trim().slice(0, 120) : "";
      const html = typeof body?.html === "string" ? body.html.slice(0, 60_000) : "";
      if (!title || !html.trim()) { send(res, 400, { ok: false, error: "title 与 html 必填（标题 ≤120 字）" }); return; }
      store.announcement = { id: `ann-${Date.now().toString(36)}`, title, html, publishedAt: new Date().toISOString() };
      save();
      console.log(`[hall] 公告发布：${title}`);
      send(res, 200, { ok: true, id: store.announcement.id });
      return;
    }
    if (route === "/api/health") {
      send(res, 200, { ok: true, service: "eac-pack-hall", packs: store.packs.length, plugins: Object.keys(store.plugins).length, time: new Date().toISOString() });
      return;
    }
    if (route === "/api/plugins/stats" && req.method === "GET") {
      const rawPeriod = url.searchParams.get("period");
      const period = ["day", "week", "month"].includes(rawPeriod) ? rawPeriod : "week";
      const ids = (url.searchParams.get("ids") ?? "")
        .split(",")
        .map((id) => decodeURIComponent(id))
        .filter((id) => PLUGIN_ID.test(id))
        .slice(0, 200);
      let plugins;
      if (ids.length) {
        plugins = ids.map((id) => pluginStat(id, store.plugins[id], period));
      } else {
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
        plugins = Object.entries(store.plugins)
          .map(([id, entry]) => pluginStat(id, entry, period))
          .filter((item) => item.downloads > 0 || item.likes > 0)
          .sort((a, b) => b.downloads - a.downloads || b.likes - a.likes)
          .slice(0, limit);
      }
      send(res, 200, { ok: true, period, plugins, time: new Date().toISOString() });
      return;
    }
    const pluginDownload = route.match(/^\/api\/plugins\/([^/]+)\/download$/);
    if (pluginDownload && req.method === "POST") {
      const id = decodeURIComponent(pluginDownload[1]);
      if (!PLUGIN_ID.test(id)) { send(res, 400, { ok: false, error: "插件标识无效" }); return; }
      const body = JSON.parse(await readBody(req));
      const client = typeof body?.client === "string" ? body.client.slice(0, 80) : "";
      if (!CLIENT_ID.test(client)) { send(res, 400, { ok: false, error: "缺少有效的 client 标识" }); return; }
      const entry = pluginEntry(id);
      const today = dayKey();
      const key = `${today}:${client}`;
      if (!entry.seen[key]) {
        entry.seen[key] = 1;
        entry.downloads[today] = (entry.downloads[today] ?? 0) + 1;
        prunePlugin(entry);
        save();
      }
      send(res, 200, { ok: true, id, downloads: downloadTotal(entry, "day"), likes: Object.keys(entry.likes).length });
      return;
    }
    const pluginLike = route.match(/^\/api\/plugins\/([^/]+)\/like$/);
    if (pluginLike && req.method === "POST") {
      const id = decodeURIComponent(pluginLike[1]);
      if (!PLUGIN_ID.test(id)) { send(res, 400, { ok: false, error: "插件标识无效" }); return; }
      const body = JSON.parse(await readBody(req));
      const client = typeof body?.client === "string" ? body.client.slice(0, 80) : "";
      if (!CLIENT_ID.test(client)) { send(res, 400, { ok: false, error: "缺少有效的 client 标识" }); return; }
      const entry = pluginEntry(id);
      if (entry.likes[client]) delete entry.likes[client];
      else entry.likes[client] = new Date().toISOString();
      save();
      send(res, 200, { ok: true, id, likes: Object.keys(entry.likes).length, liked: !!entry.likes[client] });
      return;
    }
    if (route === "/api/packs" && req.method === "GET") {
      const sort = url.searchParams.get("sort") ?? "likes";
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
      const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
      const sorted = [...store.packs].sort((a, b) => {
        if (sort === "new") return b.publishedAt.localeCompare(a.publishedAt);
        if (sort === "downloads") return b.downloads - a.downloads || b.likes - a.likes;
        return b.likes - a.likes || b.downloads - a.downloads;
      });
      send(res, 200, { ok: true, packs: sorted.slice(offset, offset + limit).map(summary), total: store.packs.length });
      return;
    }
    if (route === "/api/packs" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const invalid = validateManifest(body?.manifest);
      if (invalid) { send(res, 400, { ok: false, error: `整合包清单无效：${invalid}` }); return; }
      const manifest = body.manifest;
      manifest.author = (manifest.author ?? "匿名").slice(0, 40);
      manifest.description = (manifest.description ?? "").slice(0, 280);
      const now = new Date().toISOString();
      // 同作者同名视为更新，避免重复刷屏
      const existing = store.packs.find((pack) => pack.manifest.name === manifest.name && pack.manifest.author === manifest.author);
      if (existing) {
        existing.manifest = manifest;
        existing.updatedAt = now;
        existing.publishedAt = now;
        save();
        send(res, 200, { ok: true, id: existing.id, updated: true });
        return;
      }
      const pack = { id: randomUUID().replace(/-/g, "").slice(0, 10), manifest, likes: 0, downloads: 0, likedBy: {}, publishedAt: now, updatedAt: now };
      store.packs.unshift(pack);
      save();
      console.log(`[hall] 发布 ${pack.id} · ${manifest.name} × ${manifest.author} · ${manifest.plugins.length} 个插件`);
      send(res, 200, { ok: true, id: pack.id });
      return;
    }
    const like = route.match(/^\/api\/packs\/([a-f0-9]{6,16})\/like$/);
    if (like && req.method === "POST") {
      const pack = store.packs.find((item) => item.id === like[1]);
      if (!pack) { send(res, 404, { ok: false, error: "整合包不存在或已下架" }); return; }
      const body = JSON.parse(await readBody(req));
      const client = typeof body?.client === "string" ? body.client.slice(0, 64) : "";
      if (!client) { send(res, 400, { ok: false, error: "缺少 client 标识" }); return; }
      if (pack.likedBy[client]) { delete pack.likedBy[client]; pack.likes = Math.max(0, pack.likes - 1); }
      else { pack.likedBy[client] = true; pack.likes += 1; }
      save();
      send(res, 200, { ok: true, likes: pack.likes, liked: !!pack.likedBy[client] });
      return;
    }
    const detail = route.match(/^\/api\/packs\/([a-f0-9]{6,16})$/);
    if (detail) {
      const pack = store.packs.find((item) => item.id === detail[1]);
      if (!pack) { send(res, 404, { ok: false, error: "整合包不存在或已下架" }); return; }
      if (req.method === "GET") {
        pack.downloads += 1;
        save();
        send(res, 200, { ok: true, manifest: pack.manifest, meta: summary(pack) });
        return;
      }
      send(res, 405, { ok: false, error: "此路径只支持 GET" });
      return;
    }
    if (route === "/") { send(res, 200, { ok: true, service: "eac-pack-hall", hint: "GET /api/packs · POST /api/packs · GET /api/packs/:id · POST /api/packs/:id/like · GET /api/plugins/stats · POST /api/plugins/:id/download · POST /api/plugins/:id/like" }); return; }
    send(res, 404, { ok: false, error: "未知接口" });
  } catch (error) {
    send(res, 400, { ok: false, error: `请求失败：${error instanceof Error ? error.message : String(error)}` });
  }
});
server.listen(PORT, "0.0.0.0", () => {
  console.log(`EAC 整合包大厅已启动: http://127.0.0.1:${PORT}`);
  console.log(`数据文件: ${storeFile} · 现有 ${store.packs.length} 个整合包 · ${Object.keys(store.plugins).length} 个插件统计`);
});
