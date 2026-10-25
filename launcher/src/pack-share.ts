import type { Catalog, Instance, InstalledPlugin } from "./types";

// 共享整合包格式 v1：只携带"引用"，不携带任何插件本体。
// 引用必须能被引擎的 valid_plugin_ref 接受：https 压缩包 / github:owner/repo / npm name@exact-version。
export interface ManifestPlugin {
  name: string;
  version: string;
  ref: string;
  sha256?: string;
  origin?: "installed" | "catalog";
}
export interface PackManifest {
  format: "eac-pack";
  version: 1;
  name: string;
  author: string;
  description: string;
  createdAt: string;
  kernelVersion?: string;
  plugins: ManifestPlugin[];
  unresolved?: { name: string; version: string; reason: string }[];
}
export const PACK_FORMAT = "eac-pack";
export const PACK_EXTENSION = ".eacpack.json";
const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

export function validRefShape(ref: string): boolean {
  if (typeof ref !== "string" || !ref || ref.length > 300 || ref.startsWith("-") || /[\s\u0000-\u001f]/.test(ref)) return false;
  if (ref.startsWith("https://")) return true;
  if (ref.startsWith("github:")) {
    const pieces = ref.slice("github:".length).split("#")[0].split("/");
    return pieces.length === 2 && pieces.every((piece) => piece && piece !== "." && piece !== ".." && /^[a-zA-Z0-9._-]+$/.test(piece));
  }
  const at = ref.lastIndexOf("@");
  return at > 0 && NPM_NAME.test(ref.slice(0, at)) && !!ref.slice(at + 1).trim();
}
export function refKind(ref: string): "https" | "github" | "npm" {
  if (ref.startsWith("https://")) return "https";
  if (ref.startsWith("github:")) return "github";
  return "npm";
}
function str(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;
}
export function parsePackManifest(raw: string): { manifest: PackManifest } | { error: string } {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { error: "文件不是有效的 JSON。" }; }
  if (!value || typeof value !== "object") return { error: "整合包内容不是 JSON 对象。" };
  const data = value as Record<string, unknown>;
  if (data.format !== PACK_FORMAT || data.version !== 1) return { error: "这不是 EAC 整合包清单（缺少 eac-pack 标记）。" };
  const name = str(data.name, 60);
  if (!name) return { error: "整合包缺少有效的名称。" };
  const author = str(data.author, 40) ?? "匿名";
  const description = str(data.description, 280) ?? "";
  if (!Array.isArray(data.plugins) || data.plugins.length > 300) return { error: "整合包插件列表缺失或超出上限（300）。" };
  const plugins: ManifestPlugin[] = [];
  for (const item of data.plugins) {
    if (!item || typeof item !== "object") return { error: "插件条目格式不正确。" };
    const plugin = item as Record<string, unknown>;
    const pluginName = str(plugin.name, 120);
    const ref = str(plugin.ref, 300);
    if (!pluginName || !ref || !validRefShape(ref)) return { error: `插件「${pluginName || "?"}」的引用不可安装。` };
    const sha256 = typeof plugin.sha256 === "string" && /^[0-9a-f]{64}$/i.test(plugin.sha256) ? plugin.sha256.toLowerCase() : undefined;
    plugins.push({ name: pluginName, version: str(plugin.version, 60) ?? "unknown", ref, ...(sha256 && ref.startsWith("https://") ? { sha256 } : {}) });
  }
  const manifest: PackManifest = {
    format: PACK_FORMAT, version: 1, name, author, description,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : new Date().toISOString(),
    plugins,
  };
  const kernelVersion = str(data.kernelVersion, 40);
  if (kernelVersion) manifest.kernelVersion = kernelVersion;
  if (Array.isArray(data.unresolved) && data.unresolved.length <= 300) {
    manifest.unresolved = data.unresolved
      .filter((item): item is { name: string; version: string; reason: string } =>
        !!item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string")
      .map((item) => ({ name: String(item.name).slice(0, 120), version: String(item.version ?? "unknown").slice(0, 60), reason: String(item.reason ?? "").slice(0, 120) }));
  }
  return { manifest };
}
const CORE_SCOPE = "@deepseek-ai/";
function catalogMatch(plugin: InstalledPlugin, catalog: Catalog | null) {
  const entries = (catalog?.plugins ?? []).filter((item) => item.name === plugin.name && item.installable && !!item.ref);
  if (!entries.length) return null;
  return entries.find((item) => item.version === plugin.version && plugin.version !== "unknown") ?? entries[0];
}
// 把一个实例里已安装的插件解析成可再安装的精确引用；识别不了的进入 unresolved，绝不编造。
export function resolveInstancePack(instance: Instance, catalog: Catalog | null): { resolved: ManifestPlugin[]; unresolved: { name: string; version: string; reason: string }[] } {
  const resolved: ManifestPlugin[] = [];
  const unresolved: { name: string; version: string; reason: string }[] = [];
  for (const plugin of instance.plugins) {
    if (plugin.name.startsWith(CORE_SCOPE)) continue; // 运行时自身，不属于整合包内容
    const source = (plugin.source ?? "").trim();
    const match = catalogMatch(plugin, catalog);
    let ref = "";
    let sha256: string | undefined;
    let origin: ManifestPlugin["origin"];
    if (source.startsWith("https://") && validRefShape(source)) { ref = source; origin = "installed"; }
    else if (source.startsWith("github:") && validRefShape(source)) { ref = source; origin = "installed"; }
    else if (match) { ref = match.ref!; sha256 = match.sha256; origin = "catalog"; }
    else if (plugin.version !== "unknown" && NPM_NAME.test(plugin.name)) { ref = `${plugin.name}@${plugin.version}`; origin = "installed"; }
    if (!ref) { unresolved.push({ name: plugin.name, version: plugin.version, reason: "目录与实例都没有提供可安装的精确引用" }); continue; }
    if (resolved.some((item) => item.ref === ref)) continue;
    resolved.push({ name: plugin.name, version: plugin.version, ref, ...(sha256 && ref.startsWith("https://") ? { sha256 } : {}), origin });
  }
  return { resolved, unresolved };
}
export function slugifyName(name: string): string {
  const slug = name.trim().replace(/[\\/:*?"<>|\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (slug || "eac-pack").slice(0, 48);
}
export function buildPackManifest(fields: {
  name: string; author: string; description: string;
  kernelVersion?: string;
  plugins: ManifestPlugin[];
  unresolved?: { name: string; version: string; reason: string }[];
}): PackManifest {
  const manifest: PackManifest = {
    format: PACK_FORMAT, version: 1,
    name: fields.name.trim().slice(0, 60),
    author: (fields.author.trim() || "匿名").slice(0, 40),
    description: fields.description.trim().slice(0, 280),
    createdAt: new Date().toISOString(),
    plugins: fields.plugins,
  };
  if (fields.kernelVersion) manifest.kernelVersion = fields.kernelVersion;
  if (fields.unresolved?.length) manifest.unresolved = fields.unresolved;
  return manifest;
}
export function downloadManifestFile(manifest: PackManifest) {
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${slugifyName(manifest.name)}${PACK_EXTENSION}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export function isPackFileName(name: string): boolean {
  return /\.(eacpack\.json|eacpack|json)$/i.test(name);
}
