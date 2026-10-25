import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpCircle, Check, Download, Megaphone, Radio } from "lucide-react";
import { call, errorText, getConnection, native, persist, stored } from "./api";
import { bytes, Button, FormError, Modal } from "./components";
import { useLauncher } from "./store";
import type { Release, ReleaseAsset } from "./types";

// 与 package.json / tauri.conf.json 的 version 保持同步。
export const APP_VERSION = "0.1.0";
export function reloadUI() { window.location.reload(); }

// ---- 版本比较（宽松 semver：v 前缀、-rc 后缀）----
function parseVersion(raw: string): number[] {
  const core = raw.trim().replace(/^v/i, "").split("-")[0].split("+")[0];
  const parts = core.split(".").map((piece) => Number.parseInt(piece, 10));
  return Number.isNaN(parts[0]) ? [0, 0, 0] : [...parts, 0, 0, 0].slice(0, 3);
}
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index];
  }
  return false;
}
function windowsInstaller(asset: ReleaseAsset): boolean {
  const name = asset.name.toLowerCase();
  return name.endsWith(".exe") && (name.includes("setup") || name.includes("install") || name.includes("启动器"));
}
export interface UpdateCandidate { release: Release; asset: ReleaseAsset }
export async function checkUpdate(): Promise<UpdateCandidate | null> {
  const result = await call<{ releases: Release[] }>("releases", { source: "eac" });
  const stable = result.releases.filter((release) => !release.prerelease);
  for (const release of stable) {
    if (!isNewerVersion(release.tag, APP_VERSION)) continue;
    const exes = release.assets.filter((asset) => asset.name.toLowerCase().endsWith(".exe"));
    const asset = exes.find(windowsInstaller) ?? exes[0];
    if (asset) return { release, asset };
  }
  return null;
}

export function UpdatePanel() {
  const { online } = useLauncher();
  const [state, setState] = useState<"idle" | "checking" | "none" | "available">("idle");
  const [candidate, setCandidate] = useState<UpdateCandidate | null>(null);
  const [error, setError] = useState("");
  const check = useCallback(() => {
    setState("checking"); setError(""); setCandidate(null);
    void checkUpdate().then((found) => {
      setState(found ? "available" : "none");
      setCandidate(found);
    }).catch((reason: unknown) => { setState("idle"); setError(errorText(reason)); });
  }, []);
  return <div className="update-panel">
    <span className="mono update-version">v{APP_VERSION}</span>
    <Button icon={state === "checking" ? undefined : ArrowUpCircle} busy={state === "checking"} disabled={!online} onClick={check}>检查更新</Button>
    {state === "none" && <span className="update-status ok"><Check size={13} />已是最新</span>}
    {state === "available" && candidate && <span className="update-status new"><ArrowUpCircle size={13} />v{parseLabel(candidate.release.tag)} 可更新</span>}
    {state === "available" && candidate && <UpdateDialog trigger={candidate} />}
    <FormError error={error} />
  </div>;
}
function parseLabel(tag: string) { return tag.replace(/^v/i, ""); }

export function UpdateDialog({ trigger, onClose }: { trigger: UpdateCandidate; onClose?: () => void }) {
  const { run, notify } = useLauncher();
  const { release, asset } = trigger;
  const [open, setOpen] = useState(!onClose);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [started, setStarted] = useState("");
  const visible = onClose ? true : open;
  const close = () => (onClose ? onClose() : setOpen(false));
  const install = async () => {
    setBusy(true); setError("");
    try {
      const result = await run<{ path: string }>("install_update", { url: asset.url, filename: asset.name, ...(asset.sha256 ? { sha256: asset.sha256 } : {}) }, `下载更新 ${asset.name}`, false);
      setStarted(result.path);
      notify("更新安装程序已启动，应用即将退出。", "success");
      if (native) window.setTimeout(() => { void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().close()).catch(() => undefined); }, 1600);
    } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  };
  if (!visible) return null;
  return <Modal title={`发现新版本 v${parseLabel(release.tag)}`} subtitle={`发布于 ${release.publishedAt.slice(0, 10)} · 来自 GitHub Releases`} onClose={close} busy={busy}>
    <div className="modal-body">
      <div className="update-asset"><Download size={17} /><div><strong>{asset.name}</strong><span>{bytes(asset.size)}{asset.sha256 ? " · SHA-256 已由 GitHub 提供" : " · 来源未提供 SHA-256，以引擎记录的下载哈希为准"}</span></div></div>
      {release.body && <details className="release-notes" open><summary>更新内容</summary><pre>{release.body}</pre></details>}
      {started ? <div className="success-line"><Check size={17} />安装程序已启动（{started}）。桌面端会自动退出，按安装器提示完成更新。</div> : <div className="update-note">更新会把当前应用替换为发布版安装器的内容；实例与内核数据不受影响。</div>}
      <FormError error={error} />
    </div>
    <div className="modal-footer">
      <Button onClick={close} disabled={busy}>{started ? "关闭" : "稍后再说"}</Button>
      {!started && <Button variant="primary" icon={Download} busy={busy} onClick={() => void install()}>下载并安装更新</Button>}
    </div>
  </Modal>;
}

// ---- 公告系统：大厅服务器下发，HTML 白名单净化后渲染 ----
export interface Announcement { id: string; title: string; html: string; publishedAt: string }
const ALLOWED_TAGS = new Set(["P","BR","STRONG","B","EM","I","U","S","SUB","SUP","UL","OL","LI","H1","H2","H3","H4","H5","BLOCKQUOTE","CODE","PRE","HR","A","IMG","DIV","SPAN","TABLE","THEAD","TBODY","TFOOT","TR","TH","TD","SECTION","ARTICLE","HEADER","FOOTER","FIGURE","FIGCAPTION","CENTER","SMALL","FONT"]);
const ALLOWED_PROTOCOLS = ["http:", "https:", "mailto:"];
export function sanitizeAnnouncementHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, "text/html");
  const root = doc.getElementById("root");
  if (!root) return "";
  const walk = (node: Element) => {
    for (const child of [...node.children]) {
      const tag = child.tagName;
      if (!ALLOWED_TAGS.has(tag)) {
        // 不允许的元素：保留其文本内容，去掉元素本身（script/style 例外，全部丢弃）。
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "IFRAME" || tag === "OBJECT" || tag === "EMBED" || tag === "FORM" || tag === "LINK" || tag === "META") child.remove();
        else child.replaceWith(...[...child.childNodes]);
        continue;
      }
      for (const attribute of [...child.attributes]) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value;
        if (name === "style") continue; // 允许内联样式美化
        if (tag === "A" && name === "href") {
          try { const url = new URL(value, "https://example.invalid"); if (!ALLOWED_PROTOCOLS.includes(url.protocol)) { child.removeAttribute("href"); continue; } child.setAttribute("href", url.href); child.setAttribute("target", "_blank"); child.setAttribute("rel", "noopener noreferrer"); continue; } catch { child.removeAttribute("href"); continue; }
        }
        if (tag === "IMG" && name === "src") {
          const okay = value.startsWith("data:image/") || /^https:\/\//i.test(value) || /^http:\/\//i.test(value);
          if (okay) continue;
          child.remove();
          break;
        }
        child.removeAttribute(name);
      }
      walk(child);
    }
  };
  walk(root);
  return root.innerHTML;
}
async function fetchAnnouncement(base: string): Promise<Announcement | null> {
  const response = await fetch(`${base}/api/announcement`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
  if (response.status === 404) return null;
  const body = await response.json().catch(() => null) as { ok?: boolean; announcement?: Announcement | null } | null;
  if (!response.ok || !body?.ok) return null;
  const item = body.announcement;
  if (!item || typeof item.id !== "string" || typeof item.title !== "string" || typeof item.html !== "string") return null;
  return { id: item.id.slice(0, 64), title: item.title.slice(0, 120), html: item.html.slice(0, 60_000), publishedAt: String(item.publishedAt ?? "") };
}
let lastAnnouncement: Announcement | null = null;
let openAnnouncementHandler: ((item: Announcement) => void) | null = null;
export function hasCachedAnnouncement() { return !!lastAnnouncement; }
export function openCachedAnnouncement() { if (lastAnnouncement) openAnnouncementHandler?.(lastAnnouncement); }
export function AnnouncementWatcher() {
  const { hallUrl } = useLauncher();
  const [current, setCurrent] = useState<Announcement | null>(null);
  const [seen, setSeen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    openAnnouncementHandler = (item) => { setCurrent(item); setSeen(stored(localStorage, "eacAnnSeen") === item.id); };
    return () => { openAnnouncementHandler = null; };
  }, []);
  useEffect(() => {
    const base = hallUrl.trim().replace(/\/+$/, "");
    if (!base) return;
    let active = true;
    const poll = () => {
      void fetchAnnouncement(base).then((item) => {
        if (!active || !item) return;
        lastAnnouncement = item;
        if (stored(localStorage, "eacAnnSeen") !== item.id) { setCurrent(item); setSeen(false); }
      }).catch(() => undefined);
    };
    poll();
    timer.current = window.setInterval(poll, 30 * 60 * 1000);
    return () => { active = false; window.clearInterval(timer.current); };
  }, [hallUrl]);
  if (!current) return null;
  const close = () => { persist(localStorage, "eacAnnSeen", current.id); setSeen(true); setCurrent(null); };
  return <Modal title={current.title} subtitle={`EAC 公告 · ${current.publishedAt ? current.publishedAt.slice(0, 10) : ""}`} onClose={close}>
    <div className="modal-body">
      <div className="announcement-body" dangerouslySetInnerHTML={{ __html: sanitizeAnnouncementHtml(current.html) }} />
      <div className="announcement-footer"><Radio size={14} /><span>公告来自你的大厅服务器，仅展示一次；可在「偏好设置 → 应用与更新」重新查看。</span></div>
    </div>
    <div className="modal-footer"><Button variant="primary" icon={Check} onClick={close}>{seen ? "关闭" : "知道了"}</Button></div>
  </Modal>;
}

// ---- 捉虫模式诊断面板 ----
export function DebugPanel() {
  const { snapshot, online, connectionError, catalogOrigin, pending } = useLauncher();
  const connection = getConnection();
  const rows: [string, string][] = [
    ["运行形态", native ? "Tauri WebView（原生）" : "浏览器 / HTTP 桥接"],
    ["桥接地址", connection.url],
    ["令牌", connection.token ? `${connection.token.slice(0, 6)}…（${connection.token.length} 字符）` : "未设置"],
    ["引擎", online ? "在线" : connectionError || "离线"],
    ["平台", snapshot?.platform ?? "未知"],
    ["实例 / 内核", `${snapshot?.instances.length ?? 0} / ${snapshot?.kernels.length ?? 0}`],
    ["目录来源", catalogOrigin ?? "未加载"],
    ["进行中操作", pending.length ? pending.map((item) => item.label).join("、") : "无"],
    ["数据目录", snapshot?.root ?? "未知"],
  ];
  return <div className="debug-panel" role="group" aria-label="诊断面板">
    <div className="debug-heading"><Megaphone size={14} /><span>捉虫模式 · 诊断面板</span></div>
    <dl>{rows.map(([key, value]) => <div key={key}><dt>{key}</dt><dd className="mono">{value}</dd></div>)}</dl>
    <p>详细错误与安装日志在「任务记录」；引擎原始报错不会被此模式改写。</p>
  </div>;
}
