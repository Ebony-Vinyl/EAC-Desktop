import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive, ArrowDownToLine, ArrowRight, Box, ChevronRight, CircleHelp, Copy, Download,
  Ellipsis, ExternalLink, Files, FolderOpen, HardDrive, Import, Layers, Play, Plus,
  Radio, RefreshCw, RotateCcw, Settings2, Square, Terminal, Trash2, Unplug,
} from "lucide-react";
import { call, errorText, safeUrl } from "./api";
import {
  Badge, Button, CopyButton, dateTime, Empty, External, FormError, IconButton,
  RefreshButton, SectionTitle, Status, TaskRow,
} from "./components";
import type { DialogState } from "./dialogs";
import { useLauncher } from "./store";
import type { Backup, Instance, View } from "./types";
import { kindLabel } from "./types";
import { CockpitTelemetry, PixelWhale } from "./pixel-world";

export interface ViewProps {
  navigate: (view: View) => void;
  open: (dialog: DialogState) => void;
  selectedId: string;
  selectInstance: (id: string) => void;
}
export function InstanceActions({ instance, open, compact = false }: { instance: Instance; open: ViewProps["open"]; compact?: boolean }) {
  const { online, pending, run } = useLauncher();
  const busy = pending.some((item) => item.instanceId === instance.id);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const handle = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(false); };
    document.addEventListener("pointerdown", handle); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", handle); document.removeEventListener("keydown", escape); };
  }, [menu]);
  const running = instance.status === "running" || instance.status === "starting";
  return <div className="instance-actions">
    <Button icon={running ? Square : Play} variant={running ? "secondary" : "primary"} busy={busy} disabled={!online}
      onClick={() => { void run(running ? "stop_instance" : "launch_instance", { id: instance.id }, running ? "停止实例" : "启动实例").catch(() => undefined); }}>
      {running ? "停止" : compact ? "启动" : "启动实例"}
    </Button>
    {!compact && <IconButton icon={Settings2} label="配置实例" disabled={!online || running || busy} onClick={() => open({ type: "configure", instance })} />}
    <div className="action-menu-wrap" ref={menuRef}><IconButton icon={Ellipsis} label="更多实例操作" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu(!menu)} />
      {menu && <div className="action-menu" role="menu">
        <button role="menuitem" disabled={!online || running || busy} onClick={() => { setMenu(false); open({ type: "clone", instance }); }}><Copy size={14} />克隆实例</button>
        <button role="menuitem" disabled={!online || busy} onClick={() => { setMenu(false); open({ type: "export", instance }); }}><Download size={14} />导出实例描述</button>
        <button role="menuitem" disabled={!online || !instance.home} onClick={() => { setMenu(false); void run("open_path", { path: instance.home }, "打开实例目录", false).catch(() => undefined); }}><FolderOpen size={14} />打开实例目录</button>
        <div className="menu-divider" />
        <button role="menuitem" className="danger-text" disabled={!online || running || busy} onClick={() => {
          setMenu(false); open({ type: "confirm", title: "删除此实例？", message: `从启动器中移除「${instance.name}」。引擎会保留可恢复的数据。删除前必须停止实例。`, label: "删除实例", action: "delete_instance", payload: { id: instance.id }, danger: true });
        }}><Trash2 size={14} />删除实例</button>
      </div>}
    </div>
  </div>;
}
function InstancePicker({ selected, onSelect }: { selected?: Instance; onSelect: (id: string) => void }) {
  const { snapshot, online } = useLauncher();
  return <div className="instance-picker-list">{snapshot?.instances.map((instance) =>
    <button key={instance.id} className={`instance-picker ${selected?.id === instance.id ? "selected" : ""}`} onClick={() => onSelect(instance.id)}>
      <span className={`instance-glyph ${instance.kind === "harness" ? "glyph-cyan" : "glyph-coral"}`}><Box size={19} /></span>
      <span className="picker-label"><strong>{instance.name}</strong><small>{kindLabel[instance.kind]}</small></span>
      {online ? <span className={`status-dot dot-${instance.status}`} title={instance.status} /> : <Unplug size={12} className="muted" />}
      <ChevronRight size={14} className="picker-chevron" />
    </button>)}</div>;
}
export function Overview(props: ViewProps) {
  const { snapshot, online, connecting, pending } = useLauncher();
  const selected = snapshot?.instances.find((item) => item.id === props.selectedId) ?? snapshot?.instances[0];
  const running = snapshot?.instances.filter((item) => item.status === "running").length ?? 0;
  const runningTasks = snapshot?.tasks.filter((task) => task.status === "running") ?? [];
  return <div className="view overview-view">
    <div className="page-heading"><div><div className="eyebrow"><span className="tiny-square" />YOUR LOCAL WORKSPACE <span className="heading-edition pixel-font">/ DEEP BLUE</span></div><h1>EAC 启动器<span className="heading-dot">.</span></h1><p>你的实例、内核与插件，在这里各就各位。</p></div>
      <Button icon={Plus} variant="primary" disabled={!online} onClick={() => props.open({ type: "create" })}>新建实例</Button>
    </div>
    <div className="workspace-stage">
      <span className="cockpit-corner corner-tl" aria-hidden="true" /><span className="cockpit-corner corner-tr" aria-hidden="true" /><span className="cockpit-corner corner-bl" aria-hidden="true" /><span className="cockpit-corner corner-br" aria-hidden="true" />
      <CockpitTelemetry online={online} running={running} />
      <div className="stage-copy">
        <div className="stage-eyebrow"><span className="mono">01 / INSTANCE CONTROL</span>{selected && <Status status={online ? selected.status : "offline"} />}</div>
        <h2>{selected ? selected.name : connecting ? "正在读取工作空间" : online ? "从第一个实例开始" : "连接你的本地工作空间"}</h2>
        <p>{selected ? `${kindLabel[selected.kind]} / ${selected.kind === "harness" ? snapshot?.kernels.find((kernel) => kernel.id === selected.kernelId)?.version ?? "未指定内核" : "使用桌面端随附内核"}`
          : online ? snapshot?.kernels.length ? "创建独立实例，让内核、插件和配置拥有自己的空间。" : "先安装或注册一个内核，再创建拥有独立配置的 Harness 实例。" : "连接本地引擎，读取真实实例，启动属于你的工作环境。"}</p>
        {selected ? <InstanceActions instance={selected} open={props.open} /> : <div className="stage-empty-actions">
          <Button variant="primary" icon={online ? snapshot?.kernels.length ? Plus : Layers : Unplug} disabled={connecting} onClick={() => online && !snapshot?.kernels.length ? props.navigate("kernels") : props.open({ type: online ? "create" : "connection" })}>{online ? snapshot?.kernels.length ? "创建第一个实例" : "准备内核" : "连接引擎"}</Button>
          <button className="text-button" onClick={() => props.navigate("market")}>浏览插件<ArrowRight size={14} /></button>
        </div>}
        <div className="stage-readout"><span><i />LOCAL ENGINE</span><span>ENCRYPTED / ISOLATED</span><span>PORT {selected?.port || "----"}</span></div>
      </div>
      <div className="stage-art"><div className="stage-coordinate mono">SECTOR 07 / LOCAL FIRST</div><PixelWhale active={selected?.status === "running"} /><div className="stage-pixels"><i /><i /><i /><i /></div></div>
    </div>
    <div className="metrics-strip">
      {[{ label: "全部实例", value: snapshot?.instances.length, icon: Box, suffix: "独立工作空间" },
        { label: "正在运行", value: running, icon: Radio, suffix: "活跃进程" },
        { label: "已装内核", value: snapshot?.kernels.length, icon: Layers, suffix: "固定版本" },
        { label: "进行中", value: runningTasks.length || pending.length, icon: HardDrive, suffix: "当前操作" },
      ].map(({ label, value, icon: Icon, suffix }) => <div className="metric" key={label}><span className="metric-label"><Icon size={14} />{label}</span><div><strong className="mono">{online ? value ?? 0 : "\u2014"}</strong><small>{online ? suffix : "引擎未连接"}</small></div></div>)}
    </div>
    <div className="overview-columns">
      <section className="instance-section"><SectionTitle title="我的实例"><button className="text-button" onClick={() => props.navigate("instances")}>管理实例<ArrowRight size={13} /></button></SectionTitle>
        {snapshot?.instances.length ? <InstancePicker selected={selected} onSelect={props.selectInstance} />
          : <Empty icon={Box} title={online ? "还没有实例" : "尚未读取实例"} compact action={<Button icon={online ? Plus : Unplug} variant="ghost" onClick={() => props.open({ type: online ? "create" : "connection" })}>{online ? "新建实例" : "设置连接"}</Button>}>{online ? "新建或导入的实例会显示在这里。" : "连接引擎后，查看本机的真实工作空间。"}</Empty>}
        <div className="quick-link-row"><button onClick={() => props.open({ type: online ? "import" : "connection" })}><Import size={16} /><span>导入实例</span><ChevronRight size={14} /></button><button onClick={() => props.navigate("packs")}><Files size={16} /><span>从整合包开始</span><ChevronRight size={14} /></button></div>
      </section>
      <section className="console-section"><Logs instance={selected} overview /></section>
    </div>
    <div className="bottom-band">
      <div className="band-title"><span className="eyebrow">BUILD YOUR WORKSPACE</span><h3>一点一滴，搭出你的工作区。</h3></div>
      <button onClick={() => props.navigate("kernels")}><span className="shortcut-icon cyan"><Layers size={20} /></span><span><strong>内核仓库</strong><small>选择一个精确版本</small></span><ArrowRight size={17} /></button>
      <button onClick={() => props.navigate("market")}><span className="shortcut-icon coral"><Box size={20} /></span><span><strong>插件市场</strong><small>发现来源清晰的插件</small></span><ArrowRight size={17} /></button>
    </div>
    {runningTasks.length > 0 && <section className="overview-activity"><SectionTitle title="进行中的操作"><button className="text-button" onClick={() => props.navigate("tasks")}>全部任务<ArrowRight size={13} /></button></SectionTitle>{runningTasks.slice(0, 2).map((task) => <TaskRow key={task.id} task={task} />)}</section>}
  </div>;
}
export function Instances(props: ViewProps) {
  const { snapshot, online } = useLauncher();
  const [query, setQuery] = useState("");
  const selected = snapshot?.instances.find((item) => item.id === props.selectedId) ?? snapshot?.instances[0];
  const filtered = snapshot?.instances.filter((item) => `${item.name} ${kindLabel[item.kind]}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  return <div className="view">
    <div className="page-heading"><div><span className="eyebrow">WORKSPACE / INSTANCES</span><h1>实例管理<span className="heading-dot">.</span></h1><p>独立配置，固定内核。每一次尝试，都有自己的空间。</p></div><div className="heading-actions"><Button icon={Import} disabled={!online} onClick={() => props.open({ type: "import" })}>导入实例</Button><Button icon={Plus} variant="primary" disabled={!online} onClick={() => props.open({ type: "create" })}>新建实例</Button></div></div>
    {!snapshot?.instances.length ? <div className="large-empty"><div className="empty-world"><PixelWhale /></div><Empty icon={Box} title={online ? "从第一个实例开始" : "连接你的本地工作空间"}
      action={<><Button icon={online ? Plus : Unplug} variant="primary" onClick={() => props.open({ type: online ? "create" : "connection" })}>{online ? "新建实例" : "连接引擎"}</Button><Button icon={Layers} onClick={() => props.navigate("kernels")}>内核仓库</Button></>}>{online ? "先安装内核，再为 Harness 创建独立目录；桌面端也可以从发行版本安装。" : "实例信息由本机引擎提供，连接后显示。"}</Empty></div>
      : <div className="instance-master-detail"><aside className="instance-master"><div className="master-heading"><span className="eyebrow">INSTANCES / {snapshot.instances.length}</span><IconButton icon={Plus} label="新建实例" onClick={() => props.open({ type: "create" })} disabled={!online} /></div><input className="instance-search" aria-label="筛选实例" placeholder="查找实例…" value={query} onChange={(event) => setQuery(event.target.value)} />
        {filtered.length ? <div className="instance-picker-list">{filtered.map((instance) => <button key={instance.id} className={`instance-picker ${selected?.id === instance.id ? "selected" : ""}`} onClick={() => props.selectInstance(instance.id)}><span className="instance-glyph glyph-cyan"><Box size={18} /></span><span className="picker-label"><strong>{instance.name}</strong><small>{kindLabel[instance.kind]}</small></span><span className={`status-dot dot-${online ? instance.status : "offline"}`} /></button>)}</div> : <Empty title="没有匹配的实例" compact action={<Button variant="ghost" onClick={() => setQuery("")}>清空搜索</Button>} />}
      </aside>{selected && <InstanceDetail key={selected.id} instance={selected} open={props.open} navigate={props.navigate} />}</div>}
  </div>;
}
function InstanceDetail({ instance, open, navigate }: { instance: Instance; open: ViewProps["open"]; navigate: ViewProps["navigate"] }) {
  const { snapshot, online, pending, run } = useLauncher();
  const [tab, setTab] = useState("details");
  const kernel = snapshot?.kernels.find((item) => item.id === instance.kernelId);
  const busy = pending.some((item) => item.instanceId === instance.id);
  const stopped = instance.status === "stopped" || instance.status === "error";
  return <section className="instance-detail"><div className="detail-heading"><div className="detail-heading-name"><span className="eyebrow">{kindLabel[instance.kind]} / INSTANCE</span><h2>{instance.name}</h2><Status status={online ? instance.status : "offline"} /></div><InstanceActions instance={instance} open={open} /></div>
    <div className="tabs" role="tablist" aria-label="实例视图">{[{ id: "details", label: "详细信息" }, { id: "plugins", label: instance.inventoryError ? "插件（读取异常）" : `插件 (${instance.plugins.length})` }, { id: "backups", label: "备份" }, { id: "logs", label: "控制台" }].map(({ id, label }) => <button role="tab" key={id} aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</div>
    <div className="detail-content" role="tabpanel">
      <FormError error={instance.inventoryError ? `插件清单读取失败：${instance.inventoryError}` : ""} />
      {tab === "details" && <><div className="detail-subheading"><h3>实例配置</h3><Button icon={Settings2} variant="ghost" disabled={!online || !stopped || busy} onClick={() => open({ type: "configure", instance })}>编辑</Button></div>
        <dl className="detail-list">
          <div><dt>实例 ID</dt><dd><code>{instance.id}</code><CopyButton text={instance.id} label="复制实例 ID" /></dd></div>
          <div><dt>内核版本</dt><dd>{instance.kind === "harness" ? kernel?.version ?? "未指定" : "桌面端随附内核"} {instance.kind === "harness" && kernel && <Badge>已固定</Badge>}</dd></div>
          <div><dt>端口</dt><dd className="mono">{instance.port || "未分配"}</dd></div>
          <div><dt>进程</dt><dd className="mono">{online && instance.pid ? `PID ${instance.pid}` : online ? "未运行" : "离线时未知"}</dd></div>
          <div><dt>创建时间</dt><dd>{dateTime(instance.createdAt)}</dd></div>
          <div><dt>实例目录</dt><dd><code>{instance.home}</code><IconButton icon={FolderOpen} label="打开实例目录" disabled={!online || !instance.home} onClick={() => void run("open_path", { path: instance.home }, "打开实例目录", false).catch(() => undefined)} /></dd></div>
          <div><dt>工作目录</dt><dd><code>{instance.workspace || "未设置"}</code>{instance.workspace && <CopyButton text={instance.workspace} label="复制工作目录" />}</dd></div>
          {instance.executable && <div><dt>可执行文件</dt><dd><code>{instance.executable}</code></dd></div>}
          {instance.url && <div><dt>本地服务</dt><dd><External href={online && instance.status === "running" ? instance.url : undefined}>{instance.url}</External></dd></div>}
        </dl>
        <div className="isolation-note"><ShieldGlyph /><div><strong>{instance.kind === "harness" ? "Harness 独立配置与内核。" : "桌面端运行边界。"}</strong><p>{instance.kind === "harness" ? "Harness 实例使用独立配置目录、端口和指定内核，支持完整隔离的多内核并行运行。" : "外部桌面端使用各自随附的内核，可能实施全局单实例限制。只有 Harness 实例支持完整隔离的多内核并行运行。"}</p></div></div>
      </>}
      {tab === "plugins" && <><div className="detail-subheading"><h3>已安装插件</h3><Button icon={Plus} disabled={!online || !stopped || busy || instance.kind !== "harness"} onClick={() => open({ type: "plugin", instanceId: instance.id })}>按引用安装</Button></div>
        {instance.plugins.length ? <div className="installed-plugins">{instance.plugins.map((plugin) => <div className="installed-plugin" key={plugin.id}><span className="plugin-letter">{plugin.name.slice(0, 1).toUpperCase()}</span><div><strong>{plugin.name}</strong><p className="mono">{plugin.version} / {plugin.source}</p><small>{plugin.coreRange ? `声明内核范围：${plugin.coreRange} · 兼容性未知` : "兼容性未知"}</small></div><label className="checkbox-label"><input type="checkbox" checked={plugin.enabled} aria-label={`${plugin.enabled ? "停用" : "启用"} ${plugin.name}`} disabled={!online || !stopped || busy || instance.kind !== "harness"} onChange={(event) => void run("toggle_plugin", { instanceId: instance.id, name: plugin.name, enabled: event.target.checked }, "切换插件状态").catch(() => undefined)} /><span>{plugin.enabled ? "已启用" : "未启用"}</span></label><IconButton icon={Trash2} label={`移除 ${plugin.name}`} disabled={!online || !stopped || busy} onClick={() => open({ type: "confirm", title: "移除此插件？", message: `使用官方插件 CLI 从「${instance.name}」中移除「${plugin.name}」。`, label: "移除插件", action: "remove_plugin", payload: { instanceId: instance.id, name: plugin.name }, danger: true })} /></div>)}</div>
          : !instance.inventoryError && <Empty icon={Box} title={instance.kind === "harness" ? "尚未安装插件" : "请在桌面应用内管理插件"} compact action={instance.kind === "harness" && <Button icon={ArrowRight} onClick={() => navigate("market")}>浏览插件</Button>}>{instance.kind === "harness" ? "从目录中选择插件，或使用精确引用安装。" : "启动桌面实例后，在应用内管理它的扩展。"}</Empty>}
      </>}
      {tab === "backups" && <Backups instance={instance} open={open} />}
      {tab === "logs" && <Logs instance={instance} />}
    </div>
  </section>;
}
function ShieldGlyph() { return <span className="isolation-glyph"><Layers size={21} /></span>; }
function Backups({ instance, open }: { instance: Instance; open: ViewProps["open"] }) {
  const { online, run, pending, notify } = useLauncher();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const stopped = instance.status === "stopped";
  const busy = pending.some((item) => item.instanceId === instance.id);
  const load = useCallback(async () => {
    if (!online) return;
    setLoading(true); setError("");
    try {
      const result = await call<{ backups: Backup[] }>("list_backups", { id: instance.id });
      if (alive.current) { setBackups(result.backups); setLoaded(true); }
    } catch (reason) { if (alive.current) setError(errorText(reason)); }
    finally { if (alive.current) setLoading(false); }
  }, [instance.id, online]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);
  return <div><div className="detail-subheading"><h3>实例与配置备份</h3><div className="inline-actions"><RefreshButton onClick={() => void load()} busy={loading} disabled={!online} /><Button icon={Archive} disabled={!online || !stopped || busy} onClick={() => {
    void run("snapshot_instance", { id: instance.id }, "备份实例").then(() => { notify("实例备份已创建。", "success"); return load(); }).catch(() => undefined);
  }}>立即备份</Button></div></div><p className="muted section-description">备份或恢复配置前，请先停止实例。</p><FormError error={error} />
    {backups.length ? <div className="backup-list">{[...backups].reverse().map((backup) => <div className="backup-row" key={backup.id}><Archive size={19} /><div><strong>{dateTime(backup.createdAt)}</strong><code>{backup.path}</code></div><Button icon={RotateCcw} disabled={!online || !stopped || busy} onClick={() => open({ type: "confirm", title: "恢复此备份？", message: `将「${instance.name}」恢复至 ${dateTime(backup.createdAt)} 的备份。当前目录和配置将被经过验证的备份内容替换。`, label: "恢复备份", action: "restore_instance", payload: { id: instance.id, backupId: backup.id } })}>恢复</Button></div>)}</div>
      : !error && <Empty icon={Archive} title={loading ? "正在读取备份" : loaded ? "还没有备份" : "离线时无法读取备份"} compact>{loaded ? "调整配置前，先为当前状态留一份备份。" : "连接引擎后查看真实备份。"}</Empty>}
  </div>;
}
export function Logs({ instance, overview = false }: { instance?: Instance; overview?: boolean }) {
  const { online } = useLauncher();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [follow, setFollow] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const body = useRef<HTMLPreElement>(null);
  const first = useRef(true);
  useEffect(() => {
    setText(""); setError(""); first.current = true;
  }, [instance?.id]);
  useEffect(() => {
    if (!instance || !online) return;
    let alive = true;
    let fetching = false;
    const controller = new AbortController();
    const load = async () => {
      if (fetching || !alive) return;
      fetching = true;
      if (first.current) setLoading(true);
      try {
        const result = await call<{ text: string }>("instance_logs", { id: instance.id }, controller.signal);
        if (alive) { setText(result.text); setError(""); first.current = false; }
      } catch (reason) { if (alive && !controller.signal.aborted) setError(errorText(reason)); }
      finally { fetching = false; if (alive) setLoading(false); }
    };
    void load();
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 2000);
    return () => { alive = false; controller.abort(); window.clearInterval(interval); };
  }, [instance?.id, online, refreshKey, instance]);
  useEffect(() => { if (follow && body.current) body.current.scrollTop = body.current.scrollHeight; }, [text, follow]);
  const saveLog = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `eac-${instance?.id ?? "instance"}.log`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className={`console ${overview ? "console-overview" : ""}`}>
    <div className="console-heading"><div><Terminal size={15} /><h3>控制台</h3><span className="console-instance">{instance?.name ?? "未选择实例"}</span></div><div className="inline-actions"><CopyButton text={text} label="复制控制台输出" /><IconButton icon={ArrowDownToLine} label="下载日志" disabled={!text} onClick={saveLog} /><RefreshButton onClick={() => setRefreshKey((value) => value + 1)} busy={loading} disabled={!online || !instance} label="刷新控制台" /></div></div>
    <div className="console-body">
      {error ? <div className="console-message"><CircleHelp size={21} /><strong>暂时无法读取日志</strong><p>{error}</p><button className="text-button" onClick={() => setRefreshKey((value) => value + 1)}>重试<RefreshCw size={12} /></button></div>
        : text ? <pre ref={body} className={wrap ? "logs-wrap" : ""} tabIndex={0} aria-label="实例日志输出">{text}</pre>
          : <div className="console-message"><span className="terminal-prompt"><ChevronRight size={21} /><span className="prompt-cursor" /></span><strong>{loading ? "正在读取实例日志…" : !instance ? "准备就绪，等你出发。" : !online ? "引擎连接已断开" : "还没有输出"}</strong><p>{!instance ? "选择或创建一个实例，在这里查看它的输出。" : !online ? "重新连接后读取实例的实际进程输出。" : "实例写入日志后，实际输出会显示在这里。"}</p></div>}
    </div>
    <div className="console-footer"><span><i className={online && instance ? "console-dot active" : "console-dot"} />{online && instance ? "实际进程输出" : "等待实例"}</span><div><label><input type="checkbox" checked={wrap} onChange={(event) => setWrap(event.target.checked)} />换行</label><label><input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />跟随</label></div></div>
    {instance && safeUrl(instance.url) && online && instance.status === "running" && <div className="console-service"><External href={instance.url}>打开本地服务</External><ExternalLink size={12} /></div>}
  </div>;
}
