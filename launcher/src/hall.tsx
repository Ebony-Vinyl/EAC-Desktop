import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Download, Heart, PackagePlus, Radio, Rocket, Server, Upload } from "lucide-react";
import { Badge, Button, CopyButton, dateTime, Empty, Field, FormError, Modal, RefreshButton, Select } from "./components";
import { openAirDrop } from "./airdrop";
import { buildPackManifest, downloadManifestFile, resolveInstancePack } from "./pack-share";
import type { PackManifest } from "./pack-share";
import { persist, stored, errorText } from "./api";
import { useLauncher } from "./store";
import type { View } from "./types";

// ---- 大厅 API 客户端 ----
export interface HallPackMeta {
  id: string; name: string; author: string; description: string;
  kernelVersion: string | null; pluginCount: number; unresolvedCount: number;
  likes: number; downloads: number; publishedAt: string; updatedAt: string;
}
export function hallBase(url: string) { return url.trim().replace(/\/+$/, ""); }
export async function hallFetch<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(12_000), cache: "no-store" });
  } catch {
    throw new Error(`无法连接大厅服务器 ${base}。请确认服务已启动、地址填写正确。`);
  }
  const body = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
  if (!response.ok || !body?.ok) throw new Error(body?.error ?? `大厅服务器返回 HTTP ${response.status}。`);
  return body as T;
}
export function hallClientId(): string {
  let client = stored(localStorage, "eacHallClient");
  if (!client) { client = crypto.randomUUID(); persist(localStorage, "eacHallClient", client); }
  return client;
}
function readLiked(): Set<string> {
  try { return new Set(JSON.parse(stored(localStorage, "eacHallLikes") || "[]") as string[]); } catch { return new Set(); }
}
function writeLiked(liked: Set<string>) { persist(localStorage, "eacHallLikes", JSON.stringify([...liked])); }

// 像素红心（pixel 皮肤用，standard 皮肤用 lucide Heart）
const HEART_ROWS = [".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."];
function PixelHeart({ filled }: { filled: boolean }) {
  return <svg width={14} height={12} viewBox="0 0 7 6" shapeRendering="crispEdges" aria-hidden="true" className="skin-pixel-icon">
    {HEART_ROWS.flatMap((row, y) => [...row].map((cell, x) => cell === "#" ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={filled ? "var(--coral)" : "transparent"} stroke="var(--coral)" strokeWidth={filled ? 0 : 0.12} /> : null))}
  </svg>;
}

export function HallPanel({ navigate }: { navigate: (view: View) => void }) {
  const { hallUrl, online } = useLauncher();
  const [sort, setSort] = useState<"likes" | "downloads" | "new">("likes");
  const [packs, setPacks] = useState<HallPackMeta[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [liked, setLiked] = useState<Set<string>>(readLiked);
  const [liking, setLiking] = useState<string[]>([]);
  const base = hallBase(hallUrl);
  const load = useCallback(async () => {
    if (!base) return;
    setLoading(true); setError("");
    try {
      const result = await hallFetch<{ packs: HallPackMeta[] }>(base, `/api/packs?sort=${sort}&limit=60`);
      setPacks(result.packs);
    } catch (reason) { setError(errorText(reason)); setPacks(null); }
    finally { setLoading(false); }
  }, [base, sort]);
  useEffect(() => { void load(); }, [load]);
  const toggleLike = (pack: HallPackMeta) => {
    if (liking.includes(pack.id)) return;
    setLiking((items) => [...items, pack.id]);
    const next = new Set(liked);
    if (next.has(pack.id)) next.delete(pack.id); else next.add(pack.id);
    setLiked(next);
    writeLiked(next);
    void hallFetch<{ likes: number; liked: boolean }>(base, `/api/packs/${pack.id}/like`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client: hallClientId() }),
    }).then((result) => {
      setPacks((items) => (items ?? []).map((item) => item.id === pack.id ? { ...item, likes: result.likes } : item));
    }).catch(() => {
      const rollback = new Set(liked);
      if (rollback.has(pack.id)) rollback.delete(pack.id); else rollback.add(pack.id);
      setLiked(rollback);
      writeLiked(rollback);
    }).finally(() => setLiking((items) => items.filter((id) => id !== pack.id)));
  };
  const airdrop = (pack: HallPackMeta) => {
    void hallFetch<{ manifest: PackManifest }>(base, `/api/packs/${pack.id}`)
      .then((result) => openAirDrop(result.manifest, `大厅 · ${pack.name}`))
      .catch((reason: unknown) => setError(errorText(reason)));
  };
  if (!base) return <Empty icon={Radio} title="还没有配置大厅服务器" action={<Button icon={ArrowRight} variant="primary" onClick={() => navigate("settings")}>去设置大厅地址</Button>}>
    在「偏好设置 → 整合包大厅」填入你的服务器地址（部署脚本见项目 pack-hall/README.md），就能浏览、点赞并一键空投其他人分享的整合包。大厅只交换清单引用，不保存插件本体。
  </Empty>;
  const sorts = [{ id: "likes" as const, label: "最热" }, { id: "downloads" as const, label: "下载榜" }, { id: "new" as const, label: "最新" }];
  return <div className="hall-panel">
    <div className="hall-toolbar">
      <div className="segmented" aria-label="大厅排序">{sorts.map((item) => <button key={item.id} className={sort === item.id ? "active" : ""} aria-pressed={sort === item.id} onClick={() => setSort(item.id)}>{item.label}</button>)}</div>
      <span className="hall-server mono"><Server size={13} />{base}<i className="tiny-square" />{online ? "引擎在线" : "引擎离线"}</span>
      <RefreshButton onClick={() => void load()} busy={loading} label="刷新大厅" />
    </div>
    <FormError error={error} />
    {loading && !packs ? <Empty icon={Rocket} title="正在连接大厅服务器" compact />
      : packs?.length ? <ol className="hall-grid">{packs.map((pack, index) => {
        const isLiked = liked.has(pack.id);
        return <li key={pack.id} className={`hall-card ${index < 3 && sort !== "new" ? `hall-rank hall-rank-${index + 1}` : ""}`}>
          {index < 3 && sort !== "new" && <span className="hall-rank-badge pixel-font">#{index + 1}</span>}
          <div className="hall-card-heading">
            <h3 title={pack.name}>{pack.name}</h3>
            <span className="hall-author">by {pack.author}</span>
          </div>
          <p className="hall-description">{pack.description || "分享者没有留下描述。"}</p>
          <div className="hall-meta mono">
            <span><PackagePlus size={12} />{pack.pluginCount} 引用</span>
            {pack.kernelVersion && <span>内核 {pack.kernelVersion}</span>}
            <span><Download size={12} />{pack.downloads.toLocaleString("zh-CN")}</span>
            <time>{dateTime(pack.publishedAt)}</time>
          </div>
          <div className="hall-actions">
            <button type="button" className={`hall-like ${isLiked ? "liked" : ""} ${liking.includes(pack.id) ? "busy" : ""}`} aria-pressed={isLiked} aria-label={isLiked ? `取消点赞 ${pack.name}` : `点赞 ${pack.name}`} onClick={() => toggleLike(pack)}>
              <PixelHeart filled={isLiked} /><Heart size={13} className="skin-standard-icon" fill={isLiked ? "currentColor" : "none"} />
              <span className="mono">{pack.likes}</span>
            </button>
            <Button variant="primary" icon={Rocket} disabled={!online} title={online ? "下载清单并选择实例安装" : "连接引擎后才能安装"} onClick={() => airdrop(pack)}>一键空投</Button>
          </div>
        </li>;
      })}</ol>
      : !error && <Empty icon={Radio} title="大厅还是空的" action={<Button icon={Upload} onClick={() => navigate("packs")}>从实例导出并发布</Button>}>第一个发布整合包的人就是你。去「整合包 → 从实例导出」，把你的插件组合分享上来。</Empty>}
  </div>;
}

export function ExportPackDialog({ close, onPublished }: { close: () => void; onPublished?: () => void }) {
  const { snapshot, catalog, hallUrl, notify } = useLauncher();
  const harness = useMemo(() => (snapshot?.instances ?? []).filter((item) => item.kind === "harness"), [snapshot]);
  const withPlugins = harness.filter((item) => item.plugins.length);
  const [instanceId, setInstanceId] = useState(withPlugins[0]?.id ?? harness[0]?.id ?? "");
  const instance = harness.find((item) => item.id === instanceId);
  const [name, setName] = useState(instance ? `${instance.name} 的组合` : "");
  const [author, setAuthor] = useState(stored(localStorage, "eacHallAuthor") ?? "");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<boolean[]>([]);
  const [phase, setPhase] = useState<"idle" | "publishing" | "published">("idle");
  const [publishedId, setPublishedId] = useState("");
  const [error, setError] = useState("");
  const resolution = useMemo(() => (instance ? resolveInstancePack(instance, catalog) : { resolved: [], unresolved: [] }), [instance, catalog]);
  useEffect(() => { setPicked(resolution.resolved.map(() => true)); }, [resolution]);
  const kernelVersion = snapshot?.kernels.find((kernel) => kernel.id === instance?.kernelId)?.version;
  const selected = resolution.resolved.filter((_, index) => picked[index]);
  const manifest = () => buildPackManifest({
    name, author, description,
    kernelVersion,
    plugins: selected,
    unresolved: resolution.unresolved,
  });
  const exportFile = () => {
    const payload = manifest();
    downloadManifestFile(payload);
    notify(`已导出 ${payload.plugins.length} 个插件引用到清单文件。`, "success");
  };
  const publish = async () => {
    const base = hallBase(hallUrl);
    if (!base) { setError("请先在「偏好设置 → 整合包大厅」填写服务器地址。"); return; }
    setPhase("publishing"); setError("");
    persist(localStorage, "eacHallAuthor", author.trim());
    try {
      const result = await hallFetch<{ id: string; updated?: boolean }>(base, "/api/packs", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ manifest: manifest() }),
      });
      setPublishedId(result.id);
      setPhase("published");
      notify(result.updated ? "大厅中的同名整合包已更新。" : "整合包已发布到大厅。", "success");
      onPublished?.();
    } catch (reason) { setError(errorText(reason)); setPhase("idle"); }
  };
  return <Modal title="从实例导出整合包" subtitle="识别实例已安装插件，生成只含引用的清单——别人拖进启动器即可复刻。" onClose={close} busy={phase === "publishing"} wide>
    <div className="modal-body airdrop-body">
      {!withPlugins.length && !harness.length ? <Empty icon={PackagePlus} title="还没有 Harness 实例" compact>先创建实例并安装插件，再回来导出。</Empty> : (
        <>
          <div className="field-grid">
            <Field label="来源实例" required hint="只读取插件清单，不会改动实例。">
              <Select aria-label="来源实例" value={instanceId} onChange={(event) => setInstanceId(event.target.value)}>
                {harness.map((item) => <option key={item.id} value={item.id}>{item.name}（{item.plugins.filter((plugin) => !plugin.name.startsWith("@deepseek-ai/")).length} 个插件）</option>)}
              </Select>
            </Field>
            {kernelVersion && <Field label="当前内核"><div className="hall-static mono">{kernelVersion}</div></Field>}
          </div>
          <div className="field-grid">
            <Field label="整合包名称" required><input aria-label="整合包名称" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="给我的插件组合起个名字" /></Field>
            <Field label="作者署名" hint="会显示在大厅卡片上。"><input aria-label="作者署名" value={author} onChange={(event) => setAuthor(event.target.value)} maxLength={40} placeholder="匿名" /></Field>
          </div>
          <Field label="一句话介绍"><input aria-label="一句话介绍" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={280} placeholder="这套组合适合什么场景…" /></Field>
          <div className="airdrop-manifest">
            <div className="airdrop-manifest-heading">
              <strong>识别结果</strong>
              <span className="mono">{selected.length} / {resolution.resolved.length} 可安装引用{resolution.unresolved.length ? ` · ${resolution.unresolved.length} 个无法匹配` : ""}</span>
            </div>
            {resolution.resolved.length ? <ol className="airdrop-rows">{resolution.resolved.map((plugin, index) =>
              <li key={`${index}-${plugin.ref}`} className="airdrop-row">
                <label className="airdrop-row-pick">
                  <input type="checkbox" checked={picked[index] ?? true} disabled={phase === "publishing"} onChange={(event) => setPicked((items) => items.map((item, i) => (i === index ? event.target.checked : item)))} aria-label={`包含 ${plugin.name}`} />
                  <span className="airdrop-row-state"><span className="mono">{String(index + 1).padStart(2, "0")}</span></span>
                  <span className="airdrop-row-copy"><strong>{plugin.name}<Badge>{plugin.origin === "catalog" ? "目录匹配" : "实例引用"}</Badge></strong><code>{plugin.ref}</code></span>
                </label>
              </li>)}</ol>
              : <Empty icon={PackagePlus} title="没有识别到可导出的插件" compact>{instance ? "这个实例还没有安装插件（核心运行时不算）。" : "请选择来源实例。"}</Empty>}
            {!!resolution.unresolved.length && <details className="airdrop-unresolved" open><summary>{resolution.unresolved.length} 个插件无法自动匹配引用</summary><ul>{resolution.unresolved.map((item) => <li key={item.name}><strong>{item.name}</strong><span>{item.version} · {item.reason}</span></li>)}</ul></details>}
          </div>
        </>
      )}
      <FormError error={error} />
      {phase === "published" && <div className="success-line"><Check size={17} />已发布到大厅（编号 {publishedId}）。别人在「整合包 → 大厅」就能看到并一键空投。</div>}
    </div>
    <div className="modal-footer">
      <Button onClick={close} disabled={phase === "publishing"}>{phase === "published" ? "完成" : "取消"}</Button>
      <div className="inline-actions">
        {phase !== "published" && <CopyButton text={selected.length ? JSON.stringify(manifest(), null, 2) : ""} label="复制清单 JSON" />}
        {phase !== "published" && <Button icon={Download} disabled={!selected.length || !name.trim()} onClick={exportFile}>导出清单文件</Button>}
        <Button variant="primary" icon={Upload} busy={phase === "publishing"} disabled={phase === "published" || !selected.length || !name.trim()} onClick={() => void publish()}>发布到大厅</Button>
      </div>
    </div>
  </Modal>;
}
