import { useState } from "react";
import { Activity, Bug, Check, FolderOpen, Github, Laptop, LayoutTemplate, LoaderCircle, Megaphone, Moon, PlugZap, Radio, RefreshCw, Search, Sparkles, Sun, Terminal, UserRound, Waves } from "lucide-react";
import { getConnection, native } from "./api";
import { Badge, Button, CopyButton, Empty, SectionTitle, Select, TaskRow } from "./components";
import { useLauncher } from "./store";
import type { Skin, Theme } from "./types";
import { ArchivistCompanion } from "./companion";
import { DebugPanel, UpdatePanel, hasCachedAnnouncement, openCachedAnnouncement, reloadUI } from "./update";
import type { ViewProps } from "./workspace";

export function Tasks({ open }: ViewProps) {
  const { snapshot, pending, online, refresh } = useLauncher();
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const tasks = [...(snapshot?.tasks ?? [])].reverse().filter((task) =>
    (filter === "all" || task.status === filter) && `${task.label} ${task.message}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="view">
    <div className="page-heading"><div><span className="eyebrow">SYSTEM / ACTIVITY</span><h1>任务记录<span className="heading-dot">.</span></h1><p>每次操作的真实结果，都留在这里。</p></div><Button icon={Activity} disabled={!online} onClick={() => void refresh()}>刷新任务</Button></div>
    {pending.length > 0 && <div className="pending-operations">{pending.map((item) => <div key={item.id}><LoaderCircle size={16} className="spin" /><strong>{item.label}</strong><span>正在等待引擎响应</span></div>)}</div>}
    <div className="task-toolbar"><div className="search-field"><Search size={15} /><input aria-label="搜索任务" placeholder="搜索操作或错误信息…" value={query} onChange={(event) => setQuery(event.target.value)} /></div><Select aria-label="筛选任务状态" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">全部状态</option><option value="running">进行中</option><option value="completed">已完成</option><option value="failed">失败</option><option value="cancelled">已取消</option></Select><span className="muted">{tasks.length} 条记录{!online && snapshot ? " · 上次收到的状态" : ""}</span></div>
    {tasks.length ? <div className="task-list">{tasks.map((task) => <TaskRow key={task.id} task={task} />)}</div>
      : <Empty icon={Activity} title={query || filter !== "all" ? "没有匹配的任务" : online ? "一切就绪，还没有操作" : "连接引擎后查看任务"} action={!online ? <Button onClick={() => open({ type: "connection" })}>连接引擎</Button> : query || filter !== "all" ? <Button onClick={() => { setQuery(""); setFilter("all"); }}>清空筛选</Button> : undefined}>{online ? "安装、启动、备份与恢复等操作由 Rust 记录，不生成演示进度。" : "任务记录存储在本机 Rust 引擎中。"}</Empty>}
  </div>;
}
export function Settings({ open }: ViewProps) {
  const { snapshot, online, settings, skin, setSkin, petScale, setPetScale, hallUrl, setHallUrl, debug, setDebug, saveAppearance, run, pending } = useLauncher();
  const saving = pending.some((item) => item.action === "save_settings");
  const themes: { value: Theme; label: string; icon: typeof Sun }[] = [{ value: "light", label: "浅色", icon: Sun }, { value: "dark", label: "深色", icon: Moon }, { value: "system", label: "跟随系统", icon: Laptop }];
  const skins: { value: Skin; label: string; description: string; icon: typeof Sun }[] = [
    { value: "pixel", label: "像素深海", description: "纯像素蓝鲸、角色舱、方块按钮与 DeepSeek 蓝白黑。", icon: Sparkles },
    { value: "standard", label: "简洁工作台", description: "低干扰的现代界面，专注日常操作。", icon: LayoutTemplate },
  ];
  return <div className="view settings-view">
    <div className="page-heading"><div><span className="eyebrow">SYSTEM / PREFERENCES</span><h1>偏好设置<span className="heading-dot">.</span></h1><p>舒服的界面，清楚的边界。</p></div>{saving ? <Badge><LoaderCircle size={12} className="spin" />保存中</Badge> : <Badge tone={online ? "cyan" : "yellow"}>{online ? "由引擎保存" : "外观暂存于本机"}</Badge>}</div>
    <section className="settings-section"><SectionTitle title="外观" /><div className="setting-row"><div className="setting-description"><Sparkles size={19} /><div><h3>界面皮肤</h3><p>像素深海是本机的默认外观，也可以随时回到简洁工作台。选择只影响界面，不改变引擎行为。</p></div></div><div className="skin-options">{skins.map(({ value, label, description, icon: Icon }) => <button key={value} className={`skin-option skin-option-${value} ${skin === value ? "selected" : ""}`} aria-pressed={skin === value} onClick={() => setSkin(value)}><span className="skin-option-preview"><i /><i /><i /><i /></span><span className="skin-option-copy"><strong><Icon size={14} />{label}{skin === value && <Check size={13} />}</strong><small>{description}</small></span></button>)}</div></div>
      <div className="setting-row"><div className="setting-description"><Sun size={19} /><div><h3>主题</h3><p>选择适合当前环境的明暗模式。</p></div></div><div className="theme-options">{themes.map(({ value, label, icon: Icon }) => <button key={value} className={`theme-option theme-preview-${value} ${settings.theme === value ? "selected" : ""}`} aria-pressed={settings.theme === value} disabled={saving} onClick={() => void saveAppearance({ theme: value })}><span className="theme-preview"><i /><i /><i /></span><span className="theme-option-label"><Icon size={14} />{label}{settings.theme === value && <Check size={13} />}</span></button>)}</div></div>
      <div className="setting-row"><div className="setting-description"><Sparkles size={19} /><div><h3>桌宠大小</h3><p>调整右下角像素桌宠的显示尺寸。</p></div></div><div className="pet-scale-control"><input type="range" min="0.5" max="2" step="0.1" value={petScale} aria-label="桌宠大小" onChange={(event) => setPetScale(Number(event.target.value))} /><span className="mono">{petScale.toFixed(1)}×</span></div></div>
      <div className="setting-row"><div className="setting-description"><Waves size={19} /><div><h3>减少动态效果</h3><p>降低界面位移和过渡，系统的减少动态偏好也会被尊重。</p></div></div><label className="switch"><input role="switch" aria-label="减少动态效果" type="checkbox" checked={settings.reducedMotion} disabled={saving} onChange={(event) => void saveAppearance({ reducedMotion: event.target.checked })} /><span /></label></div>
    </section>
    <section className="settings-section"><SectionTitle title="引擎连接" /><div className="setting-row"><div className="setting-description"><PlugZap size={19} /><div><h3>{native ? "Tauri 原生 IPC" : "本地 HTTP 桥接"}</h3><p>{native ? "launcher_call / Rust" : `${getConnection().url.replace(/\/+$/, "")}/api`}</p></div></div><div className="inline-actions"><Badge tone={online ? "cyan" : "coral"}>{online ? "已连接" : "未连接"}</Badge><Button icon={PlugZap} onClick={() => open({ type: "connection" })}>连接设置</Button></div></div>
      <div className="setting-row"><div className="setting-description"><FolderOpen size={19} /><div><h3>应用数据目录</h3><p className="mono">{snapshot?.root ?? "连接引擎后显示真实路径"}</p></div></div><div className="inline-actions">{snapshot?.root && <CopyButton text={snapshot.root} label="复制数据目录" />}<Button icon={FolderOpen} disabled={!online || !snapshot?.root} onClick={() => void run("open_path", { path: snapshot?.root }, "打开数据目录", false).catch(() => undefined)}>打开目录</Button></div></div>
      <div className="setting-row"><div className="setting-description"><Laptop size={19} /><div><h3>运行平台</h3><p>{snapshot?.platform ?? "尚未连接"}</p></div></div></div>
    </section>
    <section className="settings-section"><SectionTitle title="GitHub 账号" />
      <div className="setting-row"><div className="setting-description"><Github size={19} /><div><h3>GitHub 登录</h3><p>设备流、令牌登录与 Star 已完成开发并在真机验证，当前版本按发布计划暂不开放；开放后可在插件市场点赞、直接 Star 项目并解锁社交成就。</p></div></div>
        <div className="inline-actions"><Badge tone="yellow">开发中</Badge></div></div>
      <div className="setting-row"><div className="setting-description"><UserRound size={19} /><div><h3>个人中心与用量</h3><p>头像、GitHub 公开资料、DSH Token 热力图、模型平均速度与估算费用都在个人中心查看，不依赖登录。</p></div></div><div className="inline-actions"><Badge tone={settings.githubClientId ? "cyan" : "yellow"}>{settings.githubClientId ? "OAuth Client ID 已配置" : "OAuth Client ID 未配置"}</Badge></div></div>
    </section>
    <section className="settings-section"><SectionTitle title="整合包大厅" /><div className="setting-row"><div className="setting-description"><Radio size={19} /><div><h3>大厅服务器地址</h3><p>启动器只把整合包清单（插件引用列表，不含插件本体）发给你指定的服务器。留空即关闭大厅。自建参考：项目内 pack-hall/server.mjs。</p></div></div>
      <div className="hall-url-control"><input aria-label="大厅服务器地址" value={hallUrl} spellCheck={false} placeholder="http://127.0.0.1:4317" onChange={(event) => setHallUrl(event.target.value.trim())} /><span className={`badge ${hallUrl ? "badge-cyan" : ""}`}>{hallUrl ? "已启用" : "已关闭"}</span></div></div>
    </section>
    <section className="settings-section"><SectionTitle title="应用与更新" />
      <div className="setting-row"><div className="setting-description"><RefreshCw size={19} /><div><h3>软件更新</h3><p>从 GitHub Releases 检查新版本；更新只替换应用本身，实例与内核数据不受影响。</p></div></div><UpdatePanel /></div>
      <div className="setting-row"><div className="setting-description"><Sparkles size={19} /><div><h3>界面热重载</h3><p>重新载入前端界面而不重启引擎。随时按 F5 或 Ctrl+R 也可触发。</p></div></div><div className="inline-actions"><Button icon={RefreshCw} onClick={reloadUI}>重新加载界面</Button></div></div>
      <div className="setting-row"><div className="setting-description"><Bug size={19} /><div><h3>捉虫模式</h3><p>显示诊断面板（连接、桥接地址、任务状态等），便于排查问题。仅本机生效。</p></div></div><label className="switch"><input role="switch" aria-label="捉虫模式" type="checkbox" checked={debug} onChange={(event) => setDebug(event.target.checked)} /><span /></label></div>
      {debug && <DebugPanel />}
      <div className="setting-row"><div className="setting-description"><Megaphone size={19} /><div><h3>公告</h3><p>大厅服务器下发的公告会在启动时弹出；这里可以重新查看最近一条。</p></div></div><div className="inline-actions">{hasCachedAnnouncement() ? <Button icon={Megaphone} onClick={openCachedAnnouncement}>查看最近公告</Button> : <Badge>暂无公告</Badge>}</div></div>
    </section>
    <section className="settings-section"><SectionTitle title="关于 EAC" /><div className="about-band"><span className="about-mark pixel-font">EAC</span><div><h3>EAC 启动器</h3><p>DeepSeek Harness · 独立工作区与插件管理</p></div><span className="mono muted">LOCAL / YOURS</span></div>
      <ArchivistCompanion />
      <div className="settings-principles"><div><Terminal size={16} /><span>实例使用独立 home 与进程</span></div><div><Check size={16} /><span>内核版本由你显式选择</span></div><div><Activity size={16} /><span>安装结果以真实引擎响应为准</span></div></div>
    </section>
  </div>;
}
