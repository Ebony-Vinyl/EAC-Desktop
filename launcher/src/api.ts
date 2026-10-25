import { invoke, isTauri } from "@tauri-apps/api/core";
import type { JsonPayload } from "./types";

export interface Connection {
  url: string;
  token: string;
}
const DEFAULT_URL = "http://127.0.0.1:9471";
export const native = isTauri();

// 发布计划：GitHub 登录当前版本关闭，界面显示「开发中」。
// 恢复开放时改回 true（后端 social::LOGIN_ENABLED 需同步置回）。
export const GITHUB_LOGIN_ENABLED = false;

export function stored(storage: Storage, key: string): string | null {
  try { return storage.getItem(key); } catch { return null; }
}
export function persist(storage: Storage, key: string, value: string) {
  try { storage.setItem(key, value); } catch { /* Storage may be disabled in a webview. */ }
}
export function bridgeBase(raw: string): string {
  const url = new URL(raw.trim() || DEFAULT_URL);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Enter an HTTP or HTTPS bridge URL without embedded credentials.");
  }
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/api\/?$/, "").replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}
function initialConnection(): Connection {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#\??/, ""));
  const read = (name: string) => hash.get(name) ?? hash.get(`eac${name[0].toUpperCase()}${name.slice(1)}`)
    ?? url.searchParams.get(name) ?? url.searchParams.get(`eac${name[0].toUpperCase()}${name.slice(1)}`);
  const incomingUrl = read("bridgeUrl");
  const incomingToken = read("bridgeToken");
  if (incomingUrl !== null) persist(sessionStorage, "eacBridgeUrl", incomingUrl);
  if (incomingToken !== null) persist(sessionStorage, "eacBridgeToken", incomingToken);
  // Remove credentials from the address bar before external links can send a referrer.
  let changed = false;
  for (const name of ["bridgeToken", "eacBridgeToken"]) {
    if (url.searchParams.has(name)) { url.searchParams.delete(name); changed = true; }
    if (hash.has(name)) { hash.delete(name); changed = true; }
  }
  if (changed) {
    url.hash = hash.toString() ? `#${hash.toString()}` : "";
    window.history.replaceState(null, "", url);
  }
  return {
    url: incomingUrl ?? stored(sessionStorage, "eacBridgeUrl") ?? import.meta.env.VITE_EAC_BRIDGE_URL ?? DEFAULT_URL,
    token: incomingToken ?? stored(sessionStorage, "eacBridgeToken") ?? import.meta.env.VITE_EAC_BRIDGE_TOKEN ?? "",
  };
}
let connection = initialConnection();
export function getConnection() { return { ...connection }; }
export function setConnection(next: Connection) {
  connection = { url: bridgeBase(next.url), token: next.token.trim() };
  persist(sessionStorage, "eacBridgeUrl", connection.url);
  persist(sessionStorage, "eacBridgeToken", connection.token);
}
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "The operation did not complete. Check the backend logs and try again.";
}
export async function call<T>(action: string, payload: JsonPayload = {}, signal?: AbortSignal): Promise<T> {
  if (native) return invoke<T>("launcher_call", { action, payload });
  let response: Response;
  try {
    response = await fetch(`${bridgeBase(connection.url)}/api`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(connection.token ? { Authorization: `Bearer ${connection.token}` } : {}),
      },
      body: JSON.stringify({ action, payload }),
      signal: signal ?? (["snapshot", "catalog", "instance_logs", "list_backups", "achievements", "github_status", "github_starred", "market_stats"].includes(action)
        ? AbortSignal.timeout(12_000)
        : action === "usage_profile" ? AbortSignal.timeout(45_000) : undefined),
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("The Rust bridge did not respond within 12 seconds.");
    }
    if (signal?.aborted) throw error;
    throw new Error(`Cannot reach the Rust bridge at ${bridgeBase(connection.url)}. Check the connection and bearer token.`);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== "object") throw new Error(`Bridge returned an invalid response (HTTP ${response.status}).`);
  const envelope = body as { ok?: boolean; data?: T; error?: string | { message?: string }; message?: string };
  if (!response.ok || envelope.ok !== true) {
    const message = typeof envelope.error === "string" ? envelope.error : envelope.error?.message;
    throw new Error(message || envelope.message || `Bridge request failed (HTTP ${response.status}).`);
  }
  return envelope.data as T;
}
export function safeUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}
export function checkSnapshot(value: SnapshotLike): asserts value is SnapshotLike & { instances: unknown[]; kernels: unknown[]; tasks: unknown[] } {
  if (!value || !Array.isArray(value.instances) || !Array.isArray(value.kernels) || !Array.isArray(value.tasks) || !value.settings) {
    throw new Error("The backend returned an invalid launcher snapshot.");
  }
}
interface SnapshotLike { instances?: unknown; kernels?: unknown; tasks?: unknown; settings?: unknown }
