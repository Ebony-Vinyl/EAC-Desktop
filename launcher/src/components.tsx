import { useEffect, useId, useRef, useState } from "react";
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import {
  AlertCircle, ArrowRight, Check, ChevronDown, Copy, ExternalLink,
  LoaderCircle, PackageOpen, PlugZap, RefreshCw, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { call, errorText, native, safeUrl } from "./api";
import { useLauncher } from "./store";
import type { InstanceStatus, Task } from "./types";

export function Button({ children, icon: Icon, variant = "secondary", busy, className = "", ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { icon?: LucideIcon; variant?: "primary" | "secondary" | "ghost" | "danger"; busy?: boolean }) {
  return <button type="button" className={`button button-${variant} ${className}`} {...props} disabled={props.disabled || busy}>
    {busy ? <LoaderCircle size={15} className="spin" /> : Icon ? <Icon size={15} /> : null}{children}
  </button>;
}
export function IconButton({ icon: Icon, label, className = "", ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} {...props}><Icon size={16} /></button>;
}
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "cyan" | "coral" | "yellow" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function Status({ status }: { status: InstanceStatus | "offline" | "online" }) {
  const labels = { stopped: "已停止", starting: "启动中", running: "运行中", error: "异常", offline: "离线", online: "已连接" };
  return <span className={`status status-${status}`}><i />{labels[status]}</span>;
}
export function Empty({ icon: Icon = PackageOpen, title, children, action, compact = false }:
  { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return <div className={`empty ${compact ? "empty-compact" : ""}`}>
    <span className="empty-icon"><Icon size={25} strokeWidth={1.5} /></span>
    <h3>{title}</h3>{children && <p>{children}</p>}{action && <div className="empty-actions">{action}</div>}
  </div>;
}
export function SectionTitle({ title, eyebrow, children }: { title: string; eyebrow?: string; children?: ReactNode }) {
  return <div className="section-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div><div className="section-actions">{children}</div></div>;
}
export function Field({ label, children, hint, required }: { label: string; children: ReactNode; hint?: string; required?: boolean }) {
  const id = useId();
  return <div className="field"><label id={id}>{label}{required && <span className="required"> *</span>}</label><div className="field-control" aria-labelledby={id}>{children}</div>{hint && <small>{hint}</small>}</div>;
}
export function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <span className="select-wrap"><select {...props}>{children}</select><ChevronDown size={13} /></span>;
}
export function External({ href, children, className = "" }: { href?: string; children: ReactNode; className?: string }) {
  const url = safeUrl(href);
  const { notify } = useLauncher();
  if (!url) return <span className={`muted ${className}`}>{children}</span>;
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!native) return;
    event.preventDefault();
    void call("open_url", { url }).catch((reason: unknown) => notify(errorText(reason), "error"));
  };
  return <a className={`external-link ${className}`} href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" onClick={open}>{children}<ExternalLink size={12} /></a>;
}
export function Modal({ title, subtitle, children, onClose, busy = false, wide = false }:
  { title: string; subtitle?: string; children: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      const target = ref.current?.querySelector<HTMLElement>("[autofocus], input:not([disabled]), select:not([disabled]), button:not([disabled])");
      target?.focus();
    });
    return () => { cancelAnimationFrame(frame); previous?.focus(); };
  }, []);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) { event.preventDefault(); closeRef.current(); }
      if (event.key === "Tab") {
        const focusable = ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]');
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !ref.current?.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !ref.current?.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [busy]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className={`modal ${wide ? "modal-wide" : ""}`} ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="modal-heading"><div><span className="eyebrow">EAC / LAUNCHER</span><h2 id={titleId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton icon={X} label="关闭弹窗" onClick={onClose} disabled={busy} /></div>
      {children}
    </div>
  </div>;
}
export function FormError({ error }: { error: string }) {
  return error ? <div className="form-error" role="alert"><AlertCircle size={16} /><span>{error}</span></div> : null;
}
export function OfflineNotice({ connect }: { connect: () => void }) {
  const { online, connecting } = useLauncher();
  if (online) return null;
  return <div className="offline-notice">
    {connecting ? <LoaderCircle size={15} className="spin" /> : <PlugZap size={16} />}
    <span>{connecting ? "正在连接本地引擎…" : "本地引擎未连接，目录仍可浏览。连接后管理你的工作空间。"}</span>
    <button className="text-button" onClick={connect}>{connecting ? "连接设置" : "连接引擎"}<ArrowRight size={13} /></button>
  </div>;
}
export function CopyButton({ text, label = "复制" }: { text: string; label?: string }) {
  const { notify } = useLauncher();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return <IconButton icon={copied ? Check : Copy} label={copied ? "已复制" : label} disabled={!text} onClick={() => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1800);
    }).catch(() => notify("浏览器未允许访问剪贴板。", "error"));
  }} />;
}
export function TaskRow({ task }: { task: Task }) {
  const statusLabels = { running: "进行中", completed: "已完成", failed: "失败", cancelled: "已取消" };
  const progress = typeof task.progress === "number" && Number.isFinite(task.progress)
    ? Math.min(100, Math.max(0, task.progress <= 1 ? task.progress * 100 : task.progress)) : null;
  return <div className="task-row">
    <span className={`task-symbol task-${task.status}`}>{task.status === "running" ? <LoaderCircle size={17} className="spin" /> : task.status === "completed" ? <Check size={17} /> : <AlertCircle size={17} />}</span>
    <div className="task-body"><div className="task-name"><strong>{task.label}</strong><span className="muted mono">{task.status === "running" && progress !== null ? `${Math.round(progress)}%` : statusLabels[task.status]}</span></div>
      {task.message && <p>{task.message}</p>}
      {task.status === "running" && <div className={`progress-track ${progress === null ? "progress-indeterminate" : ""}`} role="progressbar" aria-label={task.label} aria-valuenow={progress ?? undefined} aria-valuemin={0} aria-valuemax={100}><span style={progress !== null ? { width: `${progress}%` } : undefined} /></div>}
    </div><time className="task-time">{dateTime(task.timestamp)}</time>
  </div>;
}
export function RefreshButton({ onClick, busy, disabled, label = "刷新" }: { onClick: () => void; busy?: boolean; disabled?: boolean; label?: string }) {
  return <IconButton icon={RefreshCw} label={label} onClick={onClick} className={busy ? "spinning-icon" : ""} disabled={busy || disabled} />;
}
export function dateTime(value?: string): string {
  if (!value) return "未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
export function bytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "大小未知";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}
export function PixelArtwork({ small = false }: { small?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  return <div className={`pixel-artwork ${small ? "pixel-artwork-small" : ""}`} aria-hidden="true">
    <div className={`pixel-fallback ${loaded ? "hidden" : ""}`}><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
    <img src="/eac-pixel.png" alt="" onLoad={() => setLoaded(true)} onError={() => setLoaded(false)} className={loaded ? "" : "hidden"} />
  </div>;
}
