import { Component, useEffect, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import {
  Activity, ArrowDownToLine, Box, ChevronRight, Command, FileBox, LayoutDashboard,
  Layers, Menu, Minus, Moon, PlugZap, Plus, Search, Settings2, Sparkles, Square, Sun,
  Trophy, UserRound, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { native } from "./api";
import { AccountDock } from "./account";
import { Achievements } from "./achievements";
import { AirDropLayer } from "./airdrop";
import { Button, IconButton, OfflineNotice } from "./components";
import { NavigatorCompanion } from "./companion";
import { DialogHost } from "./dialogs";
import type { DialogState } from "./dialogs";
import { Kernels, Market, Packs, Releases } from "./library";
import { Profile } from "./profile";
import { useLauncher } from "./store";
import { Settings, Tasks } from "./system";
import type { View } from "./types";
import { Instances, Overview } from "./workspace";
import { AmbientWorld } from "./pixel-world";
import { PixelIcon } from "./pixel-icons";
import type { PixelIconName } from "./pixel-icons";
import { AnnouncementWatcher } from "./update";

// 无边框窗口自绘三键：最小化 / 最大化还原 / 关闭。浏览器预览不渲染。
function WindowControls() {
  if (!native) return null;
  const action = (run: (window: import("@tauri-apps/api/window").Window) => void) => () => {
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => run(getCurrentWindow())).catch(() => undefined);
  };
  return <div className="window-controls" role="group" aria-label="窗口控制">
    <button type="button" className="window-control" aria-label="最小化窗口" onClick={action((win) => void win.minimize())}><Minus size={13} /></button>
    <button type="button" className="window-control" aria-label="最大化或还原窗口" onClick={action((win) => void win.toggleMaximize())}><Square size={11} /></button>
    <button type="button" className="window-control window-close" aria-label="关闭窗口" onClick={action((win) => void win.close())}><X size={14} /></button>
  </div>;
}

const navigation: { group: string; items: { id: View; label: string; en: string; icon: LucideIcon; pixel: PixelIconName }[] }[] = [
  { group: "工作空间", items: [
    { id: "overview", label: "总览", en: "Overview", icon: LayoutDashboard, pixel: "overview" },
    { id: "instances", label: "实例管理", en: "Instances", icon: Box, pixel: "instances" },
    { id: "kernels", label: "内核仓库", en: "Runtimes", icon: Layers, pixel: "kernels" },
  ] },
  { group: "发现更多", items: [
    { id: "market", label: "插件市场", en: "Plugins", icon: FileBox, pixel: "market" },
    { id: "packs", label: "整合包", en: "Packs", icon: Box, pixel: "packs" },
    { id: "releases", label: "发行版本", en: "Releases", icon: ArrowDownToLine, pixel: "releases" },
  ] },
  { group: "系统", items: [
    { id: "profile", label: "个人中心", en: "Profile", icon: UserRound, pixel: "profile" },
    { id: "achievements", label: "成就", en: "Achievements", icon: Trophy, pixel: "achievements" },
    { id: "tasks", label: "任务记录", en: "Activity", icon: Activity, pixel: "tasks" },
    { id: "settings", label: "偏好设置", en: "Settings", icon: Settings2, pixel: "settings" },
  ] },
];
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Launcher rendering failed", error, info.componentStack); }
  render() {
    return this.state.failed ? <div className="fatal-error"><span className="pixel-font">EAC</span><h1>界面遇到了问题</h1><p>重新加载即可重新读取引擎状态。</p><Button variant="primary" onClick={() => window.location.reload()}>重新加载</Button></div> : this.props.children;
  }
}
export default function App() { return <ErrorBoundary><Launcher /></ErrorBoundary>; }
function Launcher() {
  const { snapshot, online, connecting, pending, notices, dismiss, settings, saveAppearance, skin, setSkin } = useLauncher();
  const [view, setView] = useState<View>("overview");
  const [selectedId, setSelectedId] = useState("");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [marketSearch, setMarketSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const navigate = (next: View) => { setView(next); setSidebarOpen(false); mainRef.current?.scrollTo({ top: 0 }); };
  const selectInstance = (id: string) => setSelectedId(id);
  const afterSelect = (id: string) => { setSelectedId(id); navigate("instances"); };  const activeItem = navigation.flatMap((group) => group.items).find((item) => item.id === view)!;
  const activeTasks = snapshot?.tasks.filter((task) => task.status === "running").length ?? 0;
  const selectedInstance = snapshot?.instances.find((item) => item.id === selectedId) ?? snapshot?.instances[0];
  useEffect(() => {
    if (snapshot?.instances.length && !snapshot.instances.some((item) => item.id === selectedId)) setSelectedId(snapshot.instances[0].id);
    else if (snapshot && !snapshot.instances.length) setSelectedId("");
  }, [snapshot, selectedId]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key === "Escape") setSidebarOpen(false);
      // 界面热重载：F5 / Ctrl+R（输入框内不触发，避免打断输入法）。
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((event.key === "F5" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r")) && !typing) {
        event.preventDefault();
        window.location.reload();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  useEffect(() => { document.title = `${activeItem.label} / EAC 启动器`; }, [activeItem.label]);
  const props = { navigate, open: setDialog, selectedId, selectInstance };
  return <div className="launcher-shell">
    <AmbientWorld />
    <div className="pixel-boot" aria-hidden="true"><span className="pixel-font">EAC // DEEP SYSTEM</span><i /></div>
    <a className="skip-link" href="#main">跳转到主内容</a>
    {sidebarOpen && <button className="sidebar-scrim" aria-label="关闭导航" onClick={() => setSidebarOpen(false)} />}
    <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      <button className="brand" onClick={() => navigate("overview")} aria-label="EAC 启动器总览"><span className="brand-glyph pixel-font">EAC<span /></span><span className="brand-label">启动器<span className="mono">LAUNCHER</span></span></button>
      <div className="sidebar-serial pixel-font" aria-hidden="true"><span>DS-01</span><span>DEEP EXPLORATION</span></div>
      <div className="sidebar-workspace"><span className="workspace-avatar"><PixelIcon name="kernels" size={16} className="skin-pixel-icon" /><Layers size={16} strokeWidth={1.9} className="skin-standard-icon" /></span><div><strong>我的工作空间</strong><span>LOCAL WORKSPACE</span></div><span className="workspace-pixel" /></div>
      <nav aria-label="主导航">{navigation.map((group) => <div className="nav-group" key={group.group}><span className="nav-group-label">{group.group}</span>{group.items.map(({ id, label, en, icon: Icon, pixel }) =>
        <button key={id} className={`nav-item ${view === id ? "active" : ""}`} aria-current={view === id ? "page" : undefined} onClick={() => navigate(id)}><span className="nav-item-icon"><PixelIcon name={pixel} size={16} className="skin-pixel-icon" /><Icon size={16} strokeWidth={1.9} className="skin-standard-icon" /></span><span className="nav-copy"><span>{label}</span><small>{en}</small></span>{id === "tasks" && activeTasks > 0 ? <span className="nav-count">{activeTasks}</span> : id === "instances" && online && snapshot?.instances.length ? <span className="nav-count">{snapshot.instances.length}</span> : null}</button>)}</div>)}</nav>
      <div className="sidebar-bottom"><button className="sidebar-new" disabled={!online} onClick={() => setDialog({ type: "create" })}><Plus size={16} />新建实例<ChevronRight size={13} /></button>
        <AccountDock onLogin={() => setDialog({ type: "login" })} onNavigate={navigate} />
        <button className="connection-summary" onClick={() => setDialog({ type: "connection" })}><span className={`connection-indicator ${online ? "connected" : ""}`} /><span><strong>{connecting ? "连接引擎中" : online ? "本地引擎已连接" : "本地引擎未连接"}</strong><small>{native ? "TAURI / RUST" : "HTTP BRIDGE / RUST"}</small></span><PlugZap size={15} /></button>
        <div className="sidebar-signature"><span className="mono">BUILD YOUR OWN.</span><span className="signature-pixels"><i /><i /><i /></span></div>
      </div>
    </aside>
    <div className="main-shell"><header className="topbar" data-tauri-drag-region="">{<div className="topbar-location" data-tauri-drag-region=""><IconButton icon={Menu} label="打开导航" className="mobile-menu" onClick={() => setSidebarOpen(!sidebarOpen)} /><span className="topbar-brand" data-tauri-drag-region="">EAC 启动器</span><ChevronRight size={13} /><span>{activeItem.label}</span></div>}
      <form className="global-search" onSubmit={(event) => { event.preventDefault(); setMarketSearch(search.trim()); navigate("market"); searchRef.current?.blur(); }}><Search size={14} /><input aria-label="搜索插件市场" ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索插件…" /><kbd><Command size={10} />K</kbd></form>
      <div className="topbar-actions"><span className="topbar-local mono"><span className="tiny-square" />LOCAL FIRST</span><button className="skin-switch" onClick={() => setSkin(skin === "pixel" ? "standard" : "pixel")} aria-label={skin === "pixel" ? "切换到简洁皮肤" : "切换到像素深海皮肤"} title={skin === "pixel" ? "切换到简洁皮肤" : "切换到像素深海皮肤"}><Sparkles size={14} /><span>{skin === "pixel" ? "PIXEL" : "CALM"}</span><i /></button><IconButton icon={settings.theme === "dark" ? Sun : Moon} label={settings.theme === "dark" ? "切换浅色主题" : "切换深色主题"} disabled={pending.some((item) => item.action === "save_settings")} onClick={() => void saveAppearance({ theme: settings.theme === "dark" ? "light" : "dark" })} /><button className="topbar-engine" onClick={() => setDialog({ type: "connection" })} aria-label="打开引擎连接设置"><span className={online ? "engine-dot connected" : "engine-dot"} /><span>{online ? "引擎在线" : "离线"}</span></button><WindowControls /></div>
    </header>
      <main id="main" className="main-content" ref={mainRef} tabIndex={-1}>
        <OfflineNotice connect={() => setDialog({ type: "connection" })} />
        <div className="view-transition" key={view}>
          {view === "overview" && <Overview {...props} />}
          {view === "instances" && <Instances {...props} />}
          {view === "market" && <Market {...props} initialSearch={marketSearch} />}
          {view === "kernels" && <Kernels {...props} />}
          {view === "packs" && <Packs {...props} />}
          {view === "releases" && <Releases {...props} />}
          {view === "tasks" && <Tasks {...props} />}
          {view === "profile" && <Profile {...props} />}
          {view === "achievements" && <Achievements {...props} />}
          {view === "settings" && <Settings {...props} />}
        </div>
        <footer className="page-footer"><span className="mono">EAC <span className="footer-slash">/</span> YOUR SPACE, YOUR PACE.</span><span>{snapshot ? `${snapshot.platform} / ${online ? "引擎已连接" : "连接已断开"}` : "等待本地引擎"}<span className="footer-pixel" /></span></footer>
      </main>
    </div>
    <div className="toast-region" aria-live="polite">{notices.map((notice) => <div className={`toast toast-${notice.tone}`} key={notice.id}>{notice.tone === "achievement" ? <span className="toast-trophy"><Trophy size={15} /></span> : <span className="toast-dot" />}<p>{notice.message}</p><IconButton icon={X} label="关闭通知" onClick={() => dismiss(notice.id)} /></div>)}</div>
    {(view === "overview" || view === "instances") && <NavigatorCompanion instance={selectedInstance} online={online} runningTasks={snapshot?.tasks.filter((task) => task.status === "running") ?? []} />}
    <AnnouncementWatcher />
    <AirDropLayer openInstance={afterSelect} />
    {dialog && <DialogHost dialog={dialog} close={() => setDialog(null)} selectInstance={afterSelect} />}
  </div>;
}
