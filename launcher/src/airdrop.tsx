import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, PackageOpen, Rocket } from "lucide-react";
import { Badge, Button, Field, FormError, Modal, Select } from "./components";
import { PixelWhale } from "./pixel-world";
import { parsePackManifest } from "./pack-share";
import type { PackManifest } from "./pack-share";
import { useLauncher } from "./store";
import type { Snapshot } from "./types";

// ---- 模块级“空投”总线：任何入口（拖拽/文件选择/大厅下载）都能唤起安装对话框 ----
export interface AirDropRequest { manifest: PackManifest; origin: string }
type AirDropListener = (request: AirDropRequest) => void;
const listeners = new Set<AirDropListener>();
export function openAirDrop(manifest: PackManifest, origin: string) {
  listeners.forEach((listener) => listener({ manifest, origin }));
}
export function useAirDropRequests(handler: AirDropListener) {
  const ref = useRef(handler);
  ref.current = handler;
  const stable = useRef((request: AirDropRequest) => ref.current(request)).current;
  useEffect(() => {
    listeners.add(stable);
    return () => { listeners.delete(stable); };
  }, [stable]);
}
export async function readPackFile(file: File): Promise<PackManifest> {
  const text = await file.text();
  const parsed = parsePackManifest(text);
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed.manifest;
}
export function openPackFilePicker(onError: (message: string) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,.eacpack,application/json";
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    void readPackFile(file)
      .then((manifest) => openAirDrop(manifest, file.name))
      .catch((reason: unknown) => onError(reason instanceof Error ? reason.message : "整合包文件读取失败。"));
  };
  input.click();
}

// ---- 像素空投箱（手绘 rect 网格，随皮肤变量着色）----
const CRATE_ROWS = [
  "oooooooooooo",
  "obbbbbbbbbbo",
  "obhlbbbbbbbo",
  "obllbbbbbbwo",
  "obbbbbbbbbbo",
  "owwwwwwwwwwo",
  "obbbbbbbbbwo",
  "obbbddbbbbbo",
  "obbbddbbbbbo",
  "obbbbbbbbbbo",
  "oooooooooooo",
];
const CRATE_COLORS: Record<string, string> = {
  o: "#04121f", b: "var(--cyan)", l: "#bfe3ff", d: "#0b4a94", w: "#f2f9ff", h: "#ffffff",
};
function PixelCrate({ scale = 6 }: { scale?: number }) {
  return <svg width={12 * scale} height={CRATE_ROWS.length * scale} viewBox={`0 0 12 ${CRATE_ROWS.length}`} shapeRendering="crispEdges" aria-hidden="true" className="airdrop-crate-art">
    {CRATE_ROWS.flatMap((row, y) => [...row].map((cell, x) => cell === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={CRATE_COLORS[cell]} />))}
  </svg>;
}

type VeilState = "idle" | "armed" | "flash";
export function AirDropLayer({ openInstance }: { openInstance: (id: string) => void }) {
  const { notify } = useLauncher();
  const [veil, setVeil] = useState<VeilState>("idle");
  const [request, setRequest] = useState<AirDropRequest | null>(null);
  const depth = useRef(0);
  const flashTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);
  const accept = (manifest: PackManifest, origin: string) => {
    setVeil("flash");
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setVeil("idle"), 700);
    setRequest({ manifest, origin });
  };
  useEffect(() => {
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      setVeil("armed");
    };
    const onDragOver = (event: DragEvent) => {
      event.preventDefault(); // 阻止 WebView2 把文件当页面打开
      if (event.dataTransfer && hasFiles(event)) event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setVeil((state) => (state === "armed" ? "idle" : state));
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      depth.current = 0;
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (!files.length) return;
      const file = files.find((item) => /\.(eacpack(\.json)?|json)$/i.test(item.name));
      if (!file) { setVeil("idle"); notify("只识别 .json / .eacpack.json 整合包清单文件。", "error"); return; }
      void readPackFile(file)
        .then((manifest) => accept(manifest, file.name))
        .catch((reason: unknown) => { setVeil("idle"); notify(reason instanceof Error ? reason.message : "整合包文件读取失败。", "error"); });
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [notify]);
  useAirDropRequests((incoming) => accept(incoming.manifest, incoming.origin));
  return <>
    {veil !== "idle" && <div className={`airdrop-veil airdrop-veil-${veil}`} aria-hidden="true">
      <div className="airdrop-grid" />
      <div className="airdrop-scanline" />
      <div className="airdrop-whale"><PixelWhale active /></div>
      <div className="airdrop-chute">
        <span className="airdrop-canopy" />
        <span className="airdrop-rope" /><span className="airdrop-rope" />
        <PixelCrate />
      </div>
      <div className="airdrop-copy">
        <strong className="pixel-font">{veil === "flash" ? "PACKAGE RECEIVED" : "AIRLOCK OPEN"}</strong>
        <span>{veil === "flash" ? "清单已接收，正在解码…" : "松手投放整合包清单 · 只读取引用，不含插件本体"}</span>
      </div>
      <span className="airdrop-corner airdrop-corner-tl" /><span className="airdrop-corner airdrop-corner-tr" />
      <span className="airdrop-corner airdrop-corner-bl" /><span className="airdrop-corner airdrop-corner-br" />
    </div>}
    {request && <AirDropDialog request={request} onClose={() => setRequest(null)} openInstance={openInstance} />}
  </>;
}

type RowState = "pending" | "running" | "done" | "failed" | "skipped";
export function AirDropDialog({ request, onClose, openInstance }: { request: AirDropRequest; onClose: () => void; openInstance: (id: string) => void }) {
  const { snapshot, online, run, notify } = useLauncher();
  const plugins = request.manifest.plugins;
  const stopped = snapshot?.instances.filter((item) => item.kind === "harness" && item.status === "stopped") ?? [];
  const kernels = snapshot?.kernels ?? [];
  const [mode, setMode] = useState<"existing" | "new">(stopped.length ? "existing" : "new");
  const [name, setName] = useState(request.manifest.name.slice(0, 40));
  const [kernelId, setKernelId] = useState(kernels.find((item) => item.version === request.manifest.kernelVersion)?.id ?? kernels[0]?.id ?? "");
  const [instanceId, setInstanceId] = useState(stopped[0]?.id ?? "");
  const [picked, setPicked] = useState<boolean[]>(() => plugins.map(() => true));
  const [rows, setRows] = useState<RowState[]>(() => plugins.map(() => "pending"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdId, setCreatedId] = useState("");
  const [summary, setSummary] = useState<{ ok: number; fail: number } | null>(null);
  const doneCount = rows.filter((state) => state === "done" || state === "failed" || state === "skipped").length;
  const okCount = rows.filter((state) => state === "done").length;
  const failCount = rows.filter((state) => state === "failed").length;
  const installable = plugins.length ? plugins.filter((_, index) => picked[index]).length : 0;
  const install = async () => {
    setBusy(true); setError(""); setSummary(null);
    setRows(plugins.map((_, index) => (picked[index] ? "pending" : "skipped")));
    let targetId = instanceId;
    try {
      if (mode === "new") {
        const next = await run<Snapshot>("create_instance", { name: name.trim(), kind: "harness", kernelId }, "创建整合包实例");
        const created = next.instances.find((item) => item.id === next.createdInstanceId);
        if (!created) throw new Error("引擎未返回新实例，请到实例管理查看。");
        targetId = created.id;
        setCreatedId(created.id);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "实例创建失败。");
      setBusy(false);
      return;
    }
    let ok = 0;
    let fail = 0;
    for (let index = 0; index < plugins.length; index += 1) {
      if (!picked[index]) continue;
      setRows((states) => states.map((state, i) => (i === index ? "running" : state)));
      const plugin = plugins[index];
      try {
        await run("install_plugin", { instanceId: targetId, ref: plugin.ref, ...(plugin.sha256 ? { expectedSha256: plugin.sha256 } : {}) }, `安装 ${plugin.name}`);
        ok += 1;
        setRows((states) => states.map((state, i) => (i === index ? "done" : state)));
      } catch {
        fail += 1; // run() 已把引擎错误弹成通知
        setRows((states) => states.map((state, i) => (i === index ? "failed" : state)));
      }
    }
    setSummary({ ok, fail });
    setBusy(false);
    notify(fail ? `空投完成：成功 ${ok} 个，失败 ${fail} 个。` : `整合包已安装 ${ok} 个插件。`, fail ? "error" : "success");
  };
  const progress = plugins.length ? Math.round((doneCount / plugins.length) * 100) : 100;
  return <Modal title={`空投「${request.manifest.name}」`} subtitle={`来源 ${request.origin} · by ${request.manifest.author} · ${plugins.length} 个插件引用`} onClose={onClose} busy={busy} wide>
    <div className="modal-body airdrop-body">
      {request.manifest.description && <p className="airdrop-lede">{request.manifest.description}</p>}
      <div className="airdrop-modes" role="radiogroup" aria-label="安装方式">
        {[{ id: "existing" as const, label: "装进已有实例", hint: `${stopped.length} 个已停止的 Harness 实例` }, { id: "new" as const, label: "新建独立实例", hint: "像目录整合包一样从零创建" }].map((item) =>
          <button key={item.id} type="button" role="radio" aria-checked={mode === item.id} className={`airdrop-mode ${mode === item.id ? "active" : ""}`} disabled={busy || (item.id === "existing" && !stopped.length)} onClick={() => setMode(item.id)}>
            <strong>{item.label}</strong><small>{item.id === "existing" && !stopped.length ? "没有已停止的实例" : item.hint}</small>
          </button>)}
      </div>
      {mode === "existing"
        ? <Field label="目标实例" hint="插件会按顺序安装到选中实例；安装期间实例保持停止。" required>
            <Select aria-label="目标实例" value={instanceId} onChange={(event) => setInstanceId(event.target.value)} disabled={busy}>
              <option value="" disabled>选择已停止的实例</option>
              {stopped.map((item) => <option key={item.id} value={item.id}>{item.name} / {snapshot?.kernels.find((kernel) => kernel.id === item.kernelId)?.version ?? "内核未知"}</option>)}
            </Select>
          </Field>
        : <div className="field-grid">
            <Field label="新实例名称" required><input aria-label="新实例名称" value={name} onChange={(event) => setName(event.target.value)} maxLength={40} disabled={busy} /></Field>
            <Field label="已安装内核" required hint={request.manifest.kernelVersion ? `清单声明内核 ${request.manifest.kernelVersion}，其他版本兼容性未知。` : "清单未声明内核版本。"}>
              <Select aria-label="已安装内核" value={kernelId} onChange={(event) => setKernelId(event.target.value)} disabled={busy}>
                <option value="" disabled>请选择内核</option>
                {kernels.map((item) => <option key={item.id} value={item.id}>{item.version}</option>)}
              </Select>
            </Field>
          </div>}
      <div className="airdrop-manifest">
        <div className="airdrop-manifest-heading">
          <strong>插件清单</strong>
          <span className="mono">{busy || summary ? `${doneCount} / ${plugins.length} · ${okCount} 成功${failCount ? ` · ${failCount} 失败` : ""}` : `已选 ${installable} / ${plugins.length}`}</span>
          {!busy && !summary && plugins.length > 1 && <button type="button" className="text-button" onClick={() => setPicked((items) => items.map(() => !items.every(Boolean)))}>{picked.every(Boolean) ? "全不选" : "全选"}</button>}
        </div>
        {plugins.length ? <ol className="airdrop-rows">{plugins.map((plugin, index) => {
          const state = rows[index];
          return <li key={`${index}-${plugin.ref}`} className={`airdrop-row is-${state}`}>
            <label className="airdrop-row-pick">
              <input type="checkbox" checked={picked[index]} disabled={busy || !!summary} onChange={(event) => setPicked((items) => items.map((item, i) => (i === index ? event.target.checked : item)))} aria-label={`选择 ${plugin.name}`} />
              <span className="airdrop-row-state">
                {state === "done" ? <Check size={13} /> : state === "failed" ? <AlertCircle size={13} /> : state === "running" ? <i className="airdrop-spin" /> : <span className="mono">{String(index + 1).padStart(2, "0")}</span>}
              </span>
              <span className="airdrop-row-copy"><strong>{plugin.name}</strong><code>{plugin.ref}</code></span>
            </label>
            {state === "running" && <Badge tone="cyan">安装中</Badge>}
            {state === "failed" && <Badge tone="coral">失败</Badge>}
            {state === "skipped" && <Badge>跳过</Badge>}
          </li>;
        })}</ol> : <p className="airdrop-empty-plugins">这是一个纯净整合包，不预装任何插件。</p>}
        {!!request.manifest.unresolved?.length && <details className="airdrop-unresolved"><summary>清单标注了 {request.manifest.unresolved.length} 个无法自动匹配的插件</summary><ul>{request.manifest.unresolved.map((item) => <li key={item.name}><strong>{item.name}</strong><span>{item.version} · {item.reason}</span></li>)}</ul></details>}
        {(busy || !!summary) && <div className="airdrop-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="安装进度">
          <span className="airdrop-progress-blocks">{Array.from({ length: Math.min(20, Math.max(plugins.length, 1)) }, (_, index) => {
            const filled = plugins.length ? (index + 1) / Math.min(20, plugins.length) <= doneCount / plugins.length : true;
            const failedHere = filled && rows[Math.min(index, plugins.length - 1)] === "failed";
            return <i key={index} className={`${filled ? (failedHere ? "is-fail" : "is-fill") : ""}`} />;
          })}</span>
          <span className="mono">{progress}%</span>
        </div>}
      </div>
      <FormError error={error} />
      {summary && (summary.fail
        ? <div className="form-error"><AlertCircle size={16} /><span>有 {summary.fail} 个插件安装失败，实例与已成功的部分会保留。可到任务记录查看引擎原因。</span></div>
        : <div className="success-line"><Check size={17} />全部 {summary.ok} 个插件安装完成。</div>)}
    </div>
    <div className="modal-footer">
      <Button onClick={onClose} disabled={busy}>{summary || createdId ? "关闭" : "取消"}</Button>
      {!busy && createdId && <Button variant="primary" icon={Rocket} onClick={() => { openInstance(createdId); onClose(); }}>打开实例</Button>}
      {(busy || !summary) && <Button variant="primary" icon={PackageOpen} busy={busy} disabled={!online || !installable || (mode === "existing" ? !instanceId : !kernelId || !name.trim())} onClick={() => void install()}>{mode === "existing" ? "空投到实例" : "创建并空投"}</Button>}
    </div>
  </Modal>;
}
