import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ArrowRight, Check, CheckCheck, Download, FolderInput, Layers, PlugZap, Plus, Radar, RefreshCw, ShieldCheck } from "lucide-react";
import { bridgeBase, call, errorText, getConnection, native, setConnection } from "./api";
import { Badge, Button, Field, FormError, IconButton, Modal, Select } from "./components";
import { GitHubLoginDialog } from "./github-login";
import { sendHallDownload } from "./market-social";
import { useLauncher } from "./store";
import type { CatalogPlugin, Instance, JsonPayload, Kind, Pack, ReleaseAsset, Snapshot } from "./types";
import { kindLabel } from "./types";

interface LocalKernels {
  kernels: { directory: string; version: string; cliExists: boolean; valid: boolean; foundIn: string; alreadyRegistered?: boolean }[];
  workspaces?: { path: string; name: string; pluginCount: number; bound: boolean; foundIn: string }[];
  desktops: { name: string; path: string }[];
}
// 本机发现：引擎扫描常见安装位置，只做清单/bin 存在性检查；完整校验仍在注册时执行。
function useDiscovered(enabled: boolean) {
  const { online } = useLauncher();
  const [data, setData] = useState<LocalKernels | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled || !online) return;
    let active = true;
    setBusy(true); setError("");
    void call<LocalKernels>("discover_local").then((result) => {
      if (active) setData(result);
    }).catch((reason: unknown) => { if (active) { setData(null); setError(errorText(reason)); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [enabled, online, revision]);
  return { data, busy, error, reload: () => setRevision((value) => value + 1) };
}
function KernelScanList({ onPick }: { onPick: (path: string) => void }) {
  const { data, busy, error, reload } = useDiscovered(true);
  if (busy && !data) return <div className="discover-scan"><RefreshCw size={14} className="spin" /><span>正在扫描本机常见安装位置…</span></div>;
  if (error) return <div className="discover-scan discover-warn"><span>{error}</span><IconButton icon={RefreshCw} label="重新扫描" onClick={reload} /></div>;
  if (!data) return null;
  const candidates = data.kernels.filter((item) => item.valid && !item.alreadyRegistered);
  const registered = data.kernels.filter((item) => item.alreadyRegistered);
  if (!candidates.length && !registered.length) return <div className="discover-scan"><Radar size={15} /><span>常见位置没有发现内核。装过 DSH 的话，直接粘贴目录路径即可。</span><IconButton icon={RefreshCw} label="重新扫描" onClick={reload} /></div>;
  return <div className="discover-list">
    <div className="discover-heading"><span><Radar size={14} />发现 {candidates.length} 个可注册候选</span><IconButton icon={RefreshCw} label="重新扫描" onClick={reload} disabled={busy} /></div>
    {candidates.map((item) => <button type="button" key={item.directory} className="discover-row" onClick={() => onPick(item.directory)} title={`注册 ${item.directory}`}>
      <span className="discover-mark"><Layers size={15} /></span>
      <span className="discover-copy"><strong>v{item.version}<Badge tone="cyan">有效</Badge></strong><code>{item.directory}</code></span>
      <span className="discover-from">{item.foundIn}</span>
    </button>)}
    {registered.map((item) => <div key={item.directory} className="discover-row is-registered" title="这个目录已经注册过">
      <span className="discover-mark"><Check size={15} /></span>
      <span className="discover-copy"><strong>v{item.version}<Badge>已注册</Badge></strong><code>{item.directory}</code></span>
      <span className="discover-from">{item.foundIn}</span>
    </div>)}
    {!candidates.length && !!registered.length && <p className="discover-note">本机发现过的内核都已注册；如需重新指向，粘贴目录路径。</p>}
  </div>;
}
function DesktopScanList({ onPick }: { onPick: (path: string) => void }) {
  const { online } = useLauncher();
  const [data, setData] = useState<LocalKernels | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!online) return;
    let active = true;
    setBusy(true);
    void call<LocalKernels>("discover_local").then((result) => { if (active) setData(result); }).catch(() => undefined).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [online]);
  if (!online || busy) return null;
  const desktops = data?.desktops ?? [];
  if (!desktops.length) return null;
  return <div className="discover-list">
    <div className="discover-heading"><span><Radar size={14} />本机发现 {desktops.length} 个候选程序</span></div>
    {desktops.map((item) => <button type="button" key={item.path} className="discover-row" onClick={() => onPick(item.path)} title={`使用 ${item.path}`}>
      <span className="discover-mark"><Layers size={15} /></span>
      <span className="discover-copy"><strong>{item.name}</strong><code>{item.path}</code></span>
    </button>)}
  </div>;
}
// 本机已有 DSH 工作区（~/.dsh 等含 profiles/web 的目录）：可绑定为新实例的工作目录。
function WorkspaceScanList({ onPick }: { onPick: (path: string) => void }) {
  const { online } = useLauncher();
  const [data, setData] = useState<LocalKernels | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!online) return;
    let active = true;
    setBusy(true);
    void call<LocalKernels>("discover_local").then((result) => { if (active) setData(result); }).catch(() => undefined).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [online]);
  if (!online || busy) return null;
  const workspaces = data?.workspaces ?? [];
  if (!workspaces.length) return null;
  return <div className="discover-list">
    <div className="discover-heading"><span><Radar size={14} />发现 {workspaces.length} 个本机工作区</span></div>
    {workspaces.map((item) => <button type="button" key={item.path} className={`discover-row ${item.bound ? "is-registered" : ""}`} onClick={() => onPick(item.path)} title={item.bound ? "该工作区已被一个实例绑定" : `绑定 ${item.path}`}>
      <span className="discover-mark"><Layers size={15} /></span>
      <span className="discover-copy"><strong>{item.name}{item.bound ? <Badge>已绑定</Badge> : item.pluginCount ? <Badge tone="cyan">{item.pluginCount} 个依赖</Badge> : null}</strong><code>{item.path}</code></span>
      <span className="discover-from">{item.foundIn}</span>
    </button>)}
    <p className="discover-note">绑定只让新实例使用该目录作为工作区，不会改动其中内容。</p>
  </div>;
}

export type DialogState =
  | { type: "connection" }
  | { type: "create"; kind?: Kind }
  | { type: "configure"; instance: Instance }
  | { type: "clone"; instance: Instance }
  | { type: "import" }
  | { type: "export"; instance: Instance }
  | { type: "register" }
  | { type: "install-kernel"; versions?: string[]; version?: string }
  | { type: "plugin"; plugin?: CatalogPlugin; instanceId?: string }
  | { type: "pack"; pack: Pack }
  | { type: "desktop"; asset: ReleaseAsset; kind: "eac-desktop" | "official-desktop"; tag: string }
  | { type: "login" }
  | { type: "confirm"; title: string; message: string; label: string; action: string; payload: JsonPayload; danger?: boolean };
interface DialogProps { dialog: DialogState; close: () => void; selectInstance: (id: string) => void }

function Footer({ busy, close, children }: { busy?: boolean; close: () => void; children: ReactNode }) {
  return <div className="modal-footer"><Button onClick={close} disabled={busy}>取消</Button>{children}</div>;
}
export function DialogHost({ dialog, close, selectInstance }: DialogProps) {
  switch (dialog.type) {
    case "connection": return <ConnectionDialog close={close} />;
    case "create":
    case "configure": return <InstanceDialog dialog={dialog} close={close} selectInstance={selectInstance} />;
    case "clone": return <CloneDialog instance={dialog.instance} close={close} selectInstance={selectInstance} />;
    case "import":
    case "export":
    case "register": return <PathDialog dialog={dialog} close={close} selectInstance={selectInstance} />;
    case "install-kernel": return <KernelDialog dialog={dialog} close={close} />;
    case "plugin": return <PluginDialog dialog={dialog} close={close} />;
    case "pack": return <PackDialog pack={dialog.pack} close={close} selectInstance={selectInstance} />;
    case "desktop": return <DesktopDialog dialog={dialog} close={close} selectInstance={selectInstance} />;
    case "login": return <GitHubLoginDialog close={close} />;
    case "confirm": return <ConfirmDialog dialog={dialog} close={close} />;
  }
}
function ConnectionDialog({ close }: { close: () => void }) {
  const { reconnect, connecting, connectionError, online } = useLauncher();
  const initial = getConnection();
  const [url, setUrl] = useState(initial.url);
  const [token, setToken] = useState(initial.token);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      if (!native) setConnection({ url: bridgeBase(url), token });
      await reconnect();
    } catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  };
  return <Modal title={native ? "本地原生引擎" : "连接本地引擎"} subtitle={native ? "通过 Tauri 连接本机引擎，读取真实工作空间。" : "将当前浏览器连接到本机运行的启动器引擎。"} onClose={close} busy={busy}>
    <form onSubmit={(event) => void submit(event)}>
      <div className="modal-body">
        {native ? <div className="callout"><ShieldCheck size={19} /><div><strong>Tauri IPC</strong><p>launcher_call / {online ? "已连接" : "不可用"}</p></div></div> : <>
          <Field label="桥接地址" required><input aria-label="桥接地址" autoFocus value={url} onChange={(event) => setUrl(event.target.value)} placeholder="http://127.0.0.1:9471" required spellCheck={false} /></Field>
          <Field label="访问令牌" hint="仅保存在当前浏览器标签页的会话中。"><input aria-label="访问令牌" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="填入本地引擎输出的 Bearer token" autoComplete="off" spellCheck={false} /></Field>
          <div className="connection-endpoint"><span>POST</span><code>{url.replace(/\/+$/, "").replace(/\/api$/, "")}/api</code></div>
        </>}
        <FormError error={error || (!connecting && !online ? connectionError : "")} />
        {online && <div className="success-line" role="status"><CheckCheck size={17} />已连接本地引擎。</div>}
      </div>
      <div className="modal-footer"><Button onClick={close} disabled={busy}>{online ? "完成" : "关闭"}</Button><Button type="submit" variant="primary" icon={PlugZap} busy={busy}>连接引擎</Button></div>
    </form>
  </Modal>;
}
function InstanceDialog({ dialog, close, selectInstance }: Omit<DialogProps, "dialog"> & { dialog: Extract<DialogState, { type: "create" | "configure" }> }) {
  const { snapshot, run, online, notify } = useLauncher();
  const original = dialog.type === "configure" ? dialog.instance : undefined;
  const [name, setName] = useState(original?.name ?? "");
  const [kind, setKind] = useState<Kind>(original?.kind ?? (dialog.type === "create" ? dialog.kind : undefined) ?? "harness");
  const [kernelId, setKernelId] = useState(original?.kernelId ?? snapshot?.kernels[0]?.id ?? "");
  const [workspace, setWorkspace] = useState(original?.workspace ?? "");
  const [port, setPort] = useState(original?.port?.toString() ?? "");
  const [executable, setExecutable] = useState(original?.executable ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    if (!name.trim()) { setError("请为实例填写名称。"); return; }
    if (kind === "harness" && !kernelId) { setError("请先安装或注册内核，再创建 Harness 实例。"); return; }
    if (port && (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535)) { setError("请输入 1024 至 65535 之间的整数端口，或留空自动分配。"); return; }
    setBusy(true);
    try {
      const payload: JsonPayload = { name: name.trim() };
      if (original) payload.id = original.id; else payload.kind = kind;
      if (kind === "harness") payload.kernelId = kernelId;
      if (workspace.trim()) payload.workspace = workspace.trim();
      if (port) payload.port = Number(port);
      if (kind !== "harness" && executable.trim()) payload.executable = executable.trim();
      const next = await run<Snapshot>(original ? "update_instance" : "create_instance", payload, original ? "更新实例配置" : "创建独立实例");
      const created = original ?? next.instances.find((item) => item.id === next.createdInstanceId);
      if (created) selectInstance(created.id);
      notify(original ? "实例配置已保存。" : "独立实例已创建。", "success"); close();
    } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); }
  };
  return <Modal title={original ? "配置实例" : "新建实例"} subtitle={original ? original.name : "独立的实例目录、配置和进程，让不同工作区互不打扰。"} onClose={close} busy={busy}>
    <form onSubmit={(event) => void submit(event)}><div className="modal-body">
      <Field label="实例名称" required><input autoFocus aria-label="实例名称" value={name} onChange={(event) => setName(event.target.value)} placeholder="我的工作区" maxLength={100} required /></Field>
      {!original && <Field label="实例类型"><Select aria-label="实例类型" value={kind} onChange={(event) => setKind(event.target.value as Kind)}>{Object.entries(kindLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</Select></Field>}
      {kind === "harness" ? <Field label="已安装内核" required hint={snapshot?.kernels.length ? "此实例固定使用你选择的版本。" : "暂无已安装内核。请先在「内核仓库」安装精确版本，或注册已有内核。"}><Select aria-label="已安装内核" value={kernelId} onChange={(event) => setKernelId(event.target.value)} required><option value="" disabled>请选择已安装内核</option>{snapshot?.kernels.map((kernel) => <option key={kernel.id} value={kernel.id}>{kernel.version} / {kernel.id}</option>)}</Select></Field>
        : <Field label="已有可执行文件" required hint="填写真实桌面程序路径，也可以在「发行版本」中安装便携 ZIP。"><input aria-label="已有可执行文件" value={executable} onChange={(event) => setExecutable(event.target.value)} placeholder="C:\Apps\EAC\EAC.exe" required /></Field>}
      {!original && kind !== "harness" && <DesktopScanList onPick={setExecutable} />}
      <div className="field-grid"><Field label="端口" hint={original ? "更改端口前请先停止实例。" : "留空，由引擎自动分配。"}><input aria-label="端口" type="number" min={1024} max={65535} value={port} onChange={(event) => setPort(event.target.value)} placeholder="自动分配" /></Field>
        <Field label="工作目录" hint="选填，使用绝对路径。"><input aria-label="工作目录" value={workspace} onChange={(event) => setWorkspace(event.target.value)} placeholder="默认托管目录" /></Field></div>
      {!original && kind === "harness" && <WorkspaceScanList onPick={setWorkspace} />}
      <FormError error={error} />
    </div><Footer close={close} busy={busy}><Button type="submit" variant="primary" icon={original ? Check : Plus} busy={busy} disabled={!online || (kind === "harness" && !kernelId)}>{original ? "保存配置" : "创建实例"}</Button></Footer></form>
  </Modal>;
}
function CloneDialog({ instance, close, selectInstance }: { instance: Instance; close: () => void; selectInstance: (id: string) => void }) {
  const { run, notify } = useLauncher();
  const [name, setName] = useState(`${instance.name} 副本`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <Modal title="克隆实例" subtitle="副本拥有独立的实例目录和配置，不与原实例共享可变数据。" onClose={close} busy={busy}>
    <form onSubmit={(event) => {
      event.preventDefault(); setBusy(true); setError("");
      void run<Snapshot>("clone_instance", { id: instance.id, name: name.trim() }, "克隆实例").then((next) => {
        const created = next.instances.find((item) => item.id === next.createdInstanceId);
        if (created) selectInstance(created.id);
        notify("独立副本已创建。", "success"); close();
      }).catch((reason: unknown) => setError(errorText(reason))).finally(() => setBusy(false));
    }}><div className="modal-body"><Field label="副本名称" required><input autoFocus aria-label="副本名称" value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} /></Field><FormError error={error} /></div>
      <Footer busy={busy} close={close}><Button type="submit" variant="primary" icon={Layers} disabled={!name.trim()} busy={busy}>克隆实例</Button></Footer>
    </form>
  </Modal>;
}
function PathDialog({ dialog, close, selectInstance }: Omit<DialogProps, "dialog"> & { dialog: Extract<DialogState, { type: "import" | "export" | "register" }> }) {
  const { run, notify } = useLauncher();
  const [path, setPath] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const title = dialog.type === "register" ? "注册已有内核" : dialog.type === "import" ? "导入实例" : "导出实例";
  const label = dialog.type === "register" ? "内核包目录" : dialog.type === "import" ? "实例描述文件路径" : "导出文件路径";
  const hint = dialog.type === "register" ? "引擎会验证真实的 DSH 包与 CLI。" : dialog.type === "import" ? "填写引擎所在机器上的实例描述文件绝对路径。" : "填写引擎所在机器上的目标文件绝对路径。导出内容不包含凭据。";
  return <Modal title={title} onClose={close} busy={busy}>
    <form onSubmit={(event) => {
      event.preventDefault(); setBusy(true); setError("");
      const action = dialog.type === "register" ? "register_kernel" : dialog.type === "import" ? "import_instance" : "export_instance";
      const payload = dialog.type === "register" ? { directory: path.trim() } : dialog.type === "import" ? { path: path.trim() } : { id: dialog.instance.id, destination: path.trim() };
      void run<Snapshot | { path: string }>(action, payload, title, dialog.type !== "export").then((next) => {
        if ("path" in next) { setResult(next.path); notify("实例描述文件已导出。", "success"); }
        else {
          if (dialog.type === "import") {
            const created = next.instances.find((item) => item.id === next.createdInstanceId);
            if (created) selectInstance(created.id);
          }
          notify(dialog.type === "register" ? "内核已验证并注册。" : "实例已导入独立目录。", "success"); close();
        }
      }).catch((reason: unknown) => setError(errorText(reason))).finally(() => setBusy(false));
    }}><div className="modal-body"><Field label={label} hint={hint} required><input autoFocus aria-label={label} value={path} onChange={(event) => setPath(event.target.value)} placeholder={dialog.type === "export" ? "C:\\Exports\\workspace.json" : "填写绝对路径"} required /></Field>
      {dialog.type === "register" && <KernelScanList onPick={setPath} />}
      {result && <div className="callout"><Check size={17} /><div><strong>导出完成</strong><code>{result}</code></div></div>}<FormError error={error} />
    </div><Footer close={close} busy={busy}><Button type="submit" variant="primary" icon={FolderInput} busy={busy} disabled={!path.trim()}>{title}</Button></Footer></form>
  </Modal>;
}
function KernelDialog({ dialog, close }: { dialog: Extract<DialogState, { type: "install-kernel" }>; close: () => void }) {
  const { run, notify } = useLauncher();
  const [version, setVersion] = useState(dialog.version ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <Modal title="安装精确内核版本" subtitle="从 npm 安装到独立目录，不覆盖已有内核。" onClose={close} busy={busy}>
    <form onSubmit={(event) => {
      event.preventDefault(); setError("");
      if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version.trim())) { setError("请输入完整的 npm 精确版本（major.minor.patch），不接受标签或版本范围。"); return; }
      setBusy(true);
      void run("install_kernel", { version: version.trim() }, `安装内核 ${version.trim()}`).then(() => {
        notify(`内核 ${version.trim()} 已安装。`, "success"); close();
      }).catch((reason: unknown) => setError(errorText(reason))).finally(() => setBusy(false));
    }}><div className="modal-body"><Field label="npm 精确版本" required><input autoFocus aria-label="npm 精确版本" value={version} onChange={(event) => setVersion(event.target.value)} placeholder="major.minor.patch" required list="kernel-version-options" spellCheck={false} /><datalist id="kernel-version-options">{dialog.versions?.map((item) => <option key={item} value={item} />)}</datalist></Field><FormError error={error} /></div>
      <Footer close={close} busy={busy}><Button type="submit" variant="primary" icon={Download} busy={busy} disabled={!version.trim()}>安装内核</Button></Footer>
    </form>
  </Modal>;
}
function PluginDialog({ dialog, close }: { dialog: Extract<DialogState, { type: "plugin" }>; close: () => void }) {
  const { snapshot, run, notify, downloadPlugin, hallUrl } = useLauncher();
  const instances = snapshot?.instances.filter((item) => item.kind === "harness" && item.status === "stopped") ?? [];
  const [instanceId, setInstanceId] = useState(dialog.instanceId ?? instances[0]?.id ?? "");
  const [ref, setRef] = useState(dialog.plugin?.ref ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <Modal title={dialog.plugin ? `安装 ${dialog.plugin.name}` : "按引用安装插件"} subtitle="通过官方插件 CLI，仅安装到选中的独立实例。" onClose={close} busy={busy}>
    <form onSubmit={(event) => {
      event.preventDefault(); setBusy(true); setError("");
      void run("install_plugin", { instanceId, ref: ref.trim(), ...(dialog.plugin?.sha256 ? { expectedSha256: dialog.plugin.sha256 } : {}) }, "安装插件").then(() => {
        if (dialog.plugin?.id) {
          void downloadPlugin(dialog.plugin.id);
          void sendHallDownload(hallUrl, dialog.plugin.id).catch(() => undefined);
        }
        notify("插件安装已完成。", "success"); close();
      }).catch((reason: unknown) => setError(errorText(reason))).finally(() => setBusy(false));
    }}><div className="modal-body">
      <Field label="目标实例" hint="修改插件前，请先停止 Harness 实例。" required><Select aria-label="目标实例" value={instanceId} onChange={(event) => setInstanceId(event.target.value)} required><option value="" disabled>选择已停止的实例</option>{instances.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
      <Field label="插件精确引用" required hint={dialog.plugin ? "使用目录提供的精确引用。" : "填写官方 CLI 支持的精确版本或不可变 Git 提交引用。"}><input aria-label="插件精确引用" value={ref} onChange={(event) => setRef(event.target.value)} readOnly={!!dialog.plugin} placeholder="package@exact-version 或 repository#commit" required spellCheck={false} /></Field>
      <div className="compatibility-note"><Badge tone="yellow">兼容性未知</Badge><p>{dialog.plugin?.coreRange ? `声明内核范围：${dialog.plugin.coreRange}。尚未验证与当前内核的兼容性。` : "来源未提供经过验证的内核兼容性信息。"}</p></div>
      <FormError error={error} />
    </div><Footer close={close} busy={busy}><Button type="submit" variant="primary" icon={Plus} busy={busy} disabled={!instanceId || !ref.trim()}>安装到实例</Button></Footer></form>
  </Modal>;
}
function PackDialog({ pack, close, selectInstance }: { pack: Pack; close: () => void; selectInstance: (id: string) => void }) {
  const { snapshot, run, notify } = useLauncher();
  const [name, setName] = useState(pack.name);
  const [kernelId, setKernelId] = useState(snapshot?.kernels.find((item) => item.version === pack.kernelVersion)?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdId, setCreatedId] = useState("");
  const [completed, setCompleted] = useState<string[]>([]);
  const [activeRef, setActiveRef] = useState("");
  const [finished, setFinished] = useState(false);
  const install = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    let installed = 0;
    let instanceId = "";
    try {
      const next = await run<Snapshot>("create_instance", { name: name.trim(), kind: "harness", kernelId }, "创建整合包实例");
      const created = next.instances.find((item) => item.id === next.createdInstanceId);
      if (!created) throw new Error("引擎未返回新实例。请先检查实例列表，再决定是否重试。");
      instanceId = created.id; setCreatedId(instanceId);
      for (const plugin of pack.plugins) {
        setActiveRef(plugin.ref);
        await run("install_plugin", { instanceId, ref: plugin.ref, ...(plugin.sha256 ? { expectedSha256: plugin.sha256 } : {}) }, `安装 ${plugin.ref}`);
        installed += 1;
        setCompleted((items) => [...items, plugin.ref]);
      }
      setFinished(true);
      notify(`整合包已安装到「${created.name}」。`, "success");
    } catch (reason) {
      setError(`${errorText(reason)}${instanceId ? ` 已保留新实例，完成 ${installed} / ${pack.plugins.length} 个插件安装。` : ""}`);
    } finally { setBusy(false); setActiveRef(""); }
  };
  return <Modal title={`配置 ${pack.name}`} subtitle="创建独立实例，再按目录顺序逐个安装插件。" onClose={close} busy={busy}>
    <form onSubmit={(event) => void install(event)}><div className="modal-body">
      <Field label="实例名称" required><input aria-label="实例名称" autoFocus value={name} onChange={(event) => setName(event.target.value)} required disabled={busy || !!createdId} /></Field>
      <Field label="已安装内核" required hint={pack.kernelVersion ? `整合包声明内核 ${pack.kernelVersion}，其他版本兼容性未知。` : "此整合包未声明内核版本，兼容性未知。"}><Select aria-label="已安装内核" value={kernelId} onChange={(event) => setKernelId(event.target.value)} required disabled={busy || !!createdId}><option value="" disabled>请选择已安装内核</option>{snapshot?.kernels.map((item) => <option key={item.id} value={item.id}>{item.version}</option>)}</Select></Field>
      <div className="pack-progress"><div><strong>{pack.plugins.length} 个插件引用</strong><span className="mono muted">已安装 {completed.length} / {pack.plugins.length}</span></div>
        <ol>{pack.plugins.map((plugin, index) => <li key={`${index}-${plugin.ref}`} className={index < completed.length ? "is-complete" : ""}><span>{index < completed.length ? <Check size={13} /> : String(index + 1).padStart(2, "0")}</span><code>{plugin.ref}</code>{busy && activeRef === plugin.ref && index === completed.length && <Badge tone="cyan">安装中</Badge>}</li>)}</ol>
      </div><FormError error={error} />
      {finished && <div className="success-line"><CheckCheck size={17} />所有插件均已完成安装。</div>}
    </div><div className="modal-footer"><Button onClick={close} disabled={busy}>{createdId ? "关闭" : "取消"}</Button>{createdId && !busy ? <Button variant="primary" icon={ArrowRight} onClick={() => { selectInstance(createdId); close(); }}>打开实例</Button> : <Button type="submit" variant="primary" icon={Layers} busy={busy} disabled={!kernelId || !name.trim()}>创建并安装整合包</Button>}</div></form>
  </Modal>;
}
function DesktopDialog({ dialog, close, selectInstance }: Omit<DialogProps, "dialog"> & { dialog: Extract<DialogState, { type: "desktop" }> }) {
  const { run, notify } = useLauncher();
  const [name, setName] = useState(`${kindLabel[dialog.kind]} ${dialog.tag}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <Modal title="安装便携桌面端" subtitle="下载、校验并解压便携 ZIP，为桌面端创建独立实例。" onClose={close} busy={busy}>
    <form onSubmit={(event) => {
      event.preventDefault(); setBusy(true); setError("");
      void run<Snapshot>("install_desktop", { kind: dialog.kind, name: name.trim(), url: dialog.asset.url, filename: dialog.asset.name, ...(dialog.asset.sha256 ? { sha256: dialog.asset.sha256 } : {}) }, `安装 ${dialog.asset.name}`).then((next) => {
        const created = next.instances.find((item) => item.id === next.createdInstanceId);
        if (created) selectInstance(created.id);
        notify("便携桌面端已安装。", "success"); close();
      }).catch((reason: unknown) => setError(errorText(reason))).finally(() => setBusy(false));
    }}><div className="modal-body"><Field label="实例名称" required><input aria-label="实例名称" autoFocus value={name} onChange={(event) => setName(event.target.value)} required /></Field>
      <dl className="detail-list"><div><dt>安装文件</dt><dd className="mono">{dialog.asset.name}</dd></div><div><dt>SHA-256</dt><dd className="mono">{dialog.asset.sha256 ?? "来源未提供；引擎会记录下载文件的实际哈希"}</dd></div></dl>
      <FormError error={error} /></div><Footer close={close} busy={busy}><Button type="submit" variant="primary" icon={Download} busy={busy} disabled={!name.trim()}>下载并安装</Button></Footer></form>
  </Modal>;
}
function ConfirmDialog({ dialog, close }: { dialog: Extract<DialogState, { type: "confirm" }>; close: () => void }) {
  const { run, notify } = useLauncher();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setError(""); }, [dialog]);
  return <Modal title={dialog.title} onClose={close} busy={busy}><div className="modal-body"><p className="confirm-copy">{dialog.message}</p><FormError error={error} /></div>
    <div className="modal-footer"><Button onClick={close} disabled={busy}>取消</Button><Button variant={dialog.danger ? "danger" : "primary"} busy={busy} onClick={() => {
      setBusy(true);
      void run(dialog.action, dialog.payload, dialog.title).then(() => { notify(`${dialog.label}已完成。`, "success"); close(); }).catch((reason: unknown) => setError(errorText(reason))).finally(() => setBusy(false));
    }}>{dialog.label}</Button></div>
  </Modal>;
}
