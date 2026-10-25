import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine, ArrowRight, Check, ChevronRight, Download, ExternalLink,
  FolderInput, FolderOpen, Layers, LoaderCircle, Package, PackageOpen, Plus, Search, ShieldQuestion, Trash2, Upload, X,
} from "lucide-react";
import { call, errorText, GITHUB_LOGIN_ENABLED, safeUrl } from "./api";
import {
  Badge, Button, bytes, CopyButton, dateTime, Empty, External, FormError, IconButton,
  RefreshButton, SectionTitle, Select,
} from "./components";
import { openPackFilePicker } from "./airdrop";
import { ExportPackDialog, HallPanel } from "./hall";
import {
  MarketPulse, PluginSocialActions, loadCardStats, loadRankings, repoFromPlugin,
  sendHallLike, type CardStat, type PluginStat, type RankPeriod,
} from "./market-social";
import { useLauncher } from "./store";
import type { CatalogPlugin, Release, ReleaseAsset, Source } from "./types";
import type { ViewProps } from "./workspace";

interface ProbeResult { ref: string; installOk: boolean; compatible?: boolean | null; error?: string; note?: string; issues?: { name: string; known: boolean; issue: string | null }[]; unknown?: { name: string }[] }

// 内核兼容性探针：把插件真实装进目标内核的临时隔离环境，用官方内核自带的
// evaluatePluginCompatibility 评估；结果只含真实安装输出与官方评估结论。
function CompatibilityProbe() {
  const { snapshot, online, notify } = useLauncher();
  const kernels = snapshot?.kernels ?? [];
  const [kernelId, setKernelId] = useState("");
  const [refs, setRefs] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ProbeResult[] | null>(null);
  const [probedKernel, setProbedKernel] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { if (!kernelId && kernels.length) setKernelId(kernels[kernels.length - 1].id); }, [kernels, kernelId]);
  const parseRefs = () => [...new Set(refs.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean))];
  const fillFromInstances = () => {
    const installed = new Set<string>();
    (snapshot?.instances ?? []).forEach((instance) => instance.plugins.forEach((plugin) => {
      if (!plugin.name.startsWith("@deepseek-ai/") && plugin.source) installed.add(plugin.source);
    }));
    if (!installed.size) { notify("现有实例里还没有可复制的插件引用。", "info"); return; }
    setRefs((current) => [...new Set([...current.split(/[\s,;]+/).filter(Boolean), ...installed])].join("\n"));
  };
  const run = () => {
    const list = parseRefs();
    if (!kernelId) { setError("请选择用于探测的内核。"); return; }
    if (!list.length) { setError("请填写至少一个插件引用（每行一个）。"); return; }
    setBusy(true); setError(""); setResults(null);
    void call<{ kernel: { version: string }; results: ProbeResult[] }>("probe_plugins", { kernelId, refs: list.slice(0, 12) })
      .then((outcome) => {
        setResults(outcome.results);
        setProbedKernel(outcome.kernel.version);
      })
      .catch((reason: unknown) => setError(errorText(reason)))
      .finally(() => setBusy(false));
  };
  const compatible = results?.filter((item) => item.compatible === true) ?? [];
  const incompatible = results?.filter((item) => item.compatible === false) ?? [];
  return <div className="probe-panel">
    <div className="probe-controls">
      <Select aria-label="探测内核" value={kernelId} onChange={(event) => setKernelId(event.target.value)}>
        {kernels.map((item) => <option key={item.id} value={item.id}>内核 {item.version}</option>)}
      </Select>
      <Button icon={ArrowRight} onClick={fillFromInstances} disabled={!online}>带入现有实例插件</Button>
      <Button variant="primary" icon={Search} busy={busy} disabled={!online || !kernels.length} onClick={run}>开始探测</Button>
    </div>
    <textarea aria-label="插件引用列表" className="probe-refs mono" rows={3} spellCheck={false} value={refs} placeholder={"每行一个插件引用，如：\nsome-plugin@1.2.0\nhttps://github.com/owner/repo"} onChange={(event) => setRefs(event.target.value)} />
    <small className="muted">每个引用会真实安装到所选内核的临时隔离目录（不触碰你的实例），随后由官方内核兼容性评估器给出结论。单次最多 12 条。</small>
    <FormError error={error} />
    {results && <div className="probe-results">
      <div className="probe-summary">
        <span>目标内核 <strong className="mono">{probedKernel}</strong></span>
        <Badge tone="cyan">{compatible.length} 个可上新内核</Badge>
        {incompatible.length ? <Badge tone="coral">{incompatible.length} 个留在老内核</Badge> : null}
      </div>
      <ol>{results.map((item) => <li key={item.ref} className={`probe-row ${item.compatible === true ? "is-ok" : item.compatible === false ? "is-bad" : ""}`}>
        <code>{item.ref}</code>
        {item.installOk ? <>
          {item.compatible === true && <Badge tone="cyan">官方评估兼容</Badge>}
          {item.compatible === false && <Badge tone="coral">官方评估不兼容</Badge>}
          {item.compatible === null && <Badge>无法评估</Badge>}
          {!!item.unknown?.length && <small>未声明兼容范围：{item.unknown.map((entry) => entry.name).join("、")}</small>}
          {!!item.issues?.length && <small className="danger-text">{item.issues.map((entry) => `${entry.name}: ${entry.issue}`).join("；")}</small>}
          {item.note && <small>{item.note}</small>}
        </> : <>
          <Badge tone="coral">安装失败</Badge>
          <small className="danger-text">{item.error}</small>
        </>}
      </li>)}</ol>
      {!!incompatible.length && <p className="probe-plan">分流建议：把 <strong>{compatible.length} 个兼容插件</strong>装进使用 {probedKernel} 的实例；{incompatible.length} 个不兼容的插件留在老内核实例（多内核并存，互不影响）。</p>}
      {!incompatible.length && !!compatible.length && <p className="probe-plan">全部兼容——这些插件可以放心装进 {probedKernel} 的新实例。</p>}
    </div>}
  </div>;
}

export function sourceFor(value: string, sources: Source[]) {
  return sources.find((source) => source.id === value || source.url === value)
    ?? sources.filter((source) => value.startsWith(`${source.url}/`)).sort((a, b) => b.url.length - a.url.length)[0];
}
function sourceHref(value: string, sources: Source[]) { return safeUrl(value) ?? sourceFor(value, sources)?.url; }
function sourceLabel(value: string, sources: Source[]) {
  const source = sourceFor(value, sources);
  if (source) return source.name;
  try { return new URL(value).hostname; } catch { return value || "来源未知"; }
}
function CatalogStatus() {
  const { catalog, catalogOrigin, catalogError, refreshCatalog } = useLauncher();
  return <div className="catalog-status"><span><i className="tiny-square" />{catalogOrigin === "backend" ? "引擎目录" : catalogOrigin === "bundled" ? "本地目录 · 仅浏览" : "目录尚未加载"}{catalog?.updatedAt && <span className="muted">同步于 {dateTime(catalog.updatedAt)}</span>}</span>{catalogError ? <span className="danger-text">{catalogError}</span> : null}<RefreshButton onClick={() => void refreshCatalog()} label="刷新目录" /></div>;
}
export function Market({ open, navigate, initialSearch = "" }: ViewProps & { initialSearch?: string }) {
  const {
    catalog, catalogError, online, snapshot, hallUrl, social, starredRepos,
    likePlugin, starRepo, notify, recordEvent, refreshSocial,
  } = useLauncher();
  const [query, setQuery] = useState(initialSearch);
  const [category, setCategory] = useState("");
  const [source, setSource] = useState("");
  const [availability, setAvailability] = useState("all");
  const [visibleCount, setVisibleCount] = useState(60);
  const [period, setPeriod] = useState<RankPeriod>("week");
  const [rankings, setRankings] = useState<PluginStat[]>([]);
  const [rankSource, setRankSource] = useState<"hall" | "local" | "">("");
  const [rankLoading, setRankLoading] = useState(false);
  const [rankError, setRankError] = useState("");
  const [cardStats, setCardStats] = useState<Map<string, CardStat>>(new Map());
  const [likeBusy, setLikeBusy] = useState<string[]>([]);
  const [starBusy, setStarBusy] = useState<string[]>([]);
  const rankingSeen = useRef(false);
  useEffect(() => { setQuery(initialSearch); }, [initialSearch]);
  const plugins = catalog?.plugins ?? [];
  const categories = [...new Set(plugins.map((item) => item.category || "未分类"))].sort();
  const sources = catalog?.sources ?? [];
  const filtered = useMemo(() => plugins.filter((item) => {
    const haystack = `${item.name} ${item.description} ${item.category ?? ""} ${item.id}`.toLowerCase();
    return query.toLowerCase().split(/\s+/).every((word) => haystack.includes(word))
      && (!category || (item.category || "未分类") === category)
      && (!source || sourceFor(item.source, sources)?.id === source || item.source === source)
      && (availability === "all" || (availability === "installable" ? item.installable && !!item.ref : !item.installable || !item.ref));
  }), [plugins, query, category, source, availability, sources]);
  useEffect(() => { setVisibleCount(60); }, [query, category, source, availability]);
  const visible = filtered.slice(0, visibleCount);
  const visibleKey = visible.map((item) => item.id).join("|");
  useEffect(() => {
    if (!online) return;
    let active = true;
    setRankLoading(true);
    setRankError("");
    void loadRankings(period, hallUrl, 10).then((result) => {
      if (!active) return;
      setRankings(result.stats);
      setRankSource(result.source);
      if (!rankingSeen.current && result.stats.length) {
        rankingSeen.current = true;
        void recordEvent("ranking_viewed");
      }
    }).catch((reason: unknown) => {
      if (!active) return;
      setRankings([]);
      setRankSource("");
      setRankError(errorText(reason));
    }).finally(() => { if (active) setRankLoading(false); });
    return () => { active = false; };
  }, [period, hallUrl, online, recordEvent]);
  useEffect(() => {
    if (!online || !visible.length) return;
    let active = true;
    void loadCardStats(visible.map((item) => item.id), period, hallUrl)
      .then((stats) => { if (active) setCardStats(stats); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [visibleKey, period, hallUrl, online]);
  const installTarget = snapshot?.instances.some((item) => item.kind === "harness" && item.status === "stopped");
  const reset = () => { setQuery(""); setCategory(""); setSource(""); setAvailability("all"); };
  const jumpToPlugin = (id: string) => {
    const plugin = plugins.find((item) => item.id === id);
    if (!plugin) return;
    setQuery(plugin.name);
    setCategory("");
    setSource("");
    setAvailability("all");
    window.setTimeout(() => document.getElementById(`plugin-${plugin.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
  };
  const toggleLike = async (plugin: CatalogPlugin) => {
    if (!social?.authenticated) {
      notify(GITHUB_LOGIN_ENABLED ? "登录 GitHub 后即可给插件点赞。" : "GitHub 登录功能正在开发中，敬请期待。", "info");
      if (GITHUB_LOGIN_ENABLED) open({ type: "login" });
      return;
    }
    if (likeBusy.includes(plugin.id)) return;
    const liked = social.likedPlugins.includes(plugin.id);
    setLikeBusy((items) => [...items, plugin.id]);
    try {
      const result = await likePlugin(plugin.id, !liked);
      setCardStats((items) => {
        const next = new Map(items);
        const current = next.get(plugin.id) ?? { downloads: 0, likes: 0 };
        next.set(plugin.id, { ...current, likes: result.likes });
        return next;
      });
      const hall = await sendHallLike(hallUrl, plugin.id).catch(() => null);
      if (hall) {
        setCardStats((items) => {
          const next = new Map(items);
          const current = next.get(plugin.id) ?? { downloads: 0, likes: 0 };
          next.set(plugin.id, { ...current, likes: hall.likes });
          return next;
        });
      }
    } catch (reason) {
      notify(errorText(reason), "error");
      void refreshSocial();
    } finally {
      setLikeBusy((items) => items.filter((id) => id !== plugin.id));
    }
  };
  const toggleStar = async (plugin: CatalogPlugin) => {
    const repo = repoFromPlugin(plugin);
    if (!repo) return;
    if (!social?.authenticated) {
      notify(GITHUB_LOGIN_ENABLED ? "登录 GitHub 后可以直接在启动器里 Star 项目。" : "GitHub 登录功能正在开发中，敬请期待。", "info");
      if (GITHUB_LOGIN_ENABLED) open({ type: "login" });
      return;
    }
    if (starBusy.includes(plugin.id)) return;
    const starred = starredRepos.has(repo.toLowerCase());
    setStarBusy((items) => [...items, plugin.id]);
    try {
      await starRepo(repo, !starred);
      notify(starred ? `已取消 Star：${repo}` : `已在 GitHub 点亮 Star：${repo}`, "success");
    } catch (reason) {
      notify(errorText(reason), "error");
      void refreshSocial();
    } finally {
      setStarBusy((items) => items.filter((id) => id !== plugin.id));
    }
  };
  return <div className="view market-view">
    <div className="page-heading"><div><span className="eyebrow">DISCOVER / PLUGINS</span><h1>插件市场<span className="heading-dot">.</span></h1><p>让工作区更合心意。每一份插件，都有迹可循。</p></div><Button icon={Plus} disabled={!online || !installTarget} onClick={() => open({ type: "plugin" })}>按引用安装</Button></div>
    <div className="market-toolbar"><div className="search-field"><Search size={16} /><input aria-label="搜索插件" placeholder="搜索插件、功能、关键词…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void recordEvent("market_search"); }} />{query && <IconButton icon={X} label="清空搜索" onClick={() => setQuery("")} />}</div>
      <Select aria-label="按来源筛选" value={source} onChange={(event) => setSource(event.target.value)}><option value="">所有来源</option>{sources.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</Select>
      <Select aria-label="按可安装状态筛选" value={availability} onChange={(event) => setAvailability(event.target.value)}><option value="all">全部条目</option><option value="installable">可安装</option><option value="unavailable">仅收录</option></Select>
    </div>
    <div className="category-strip"><button className={!category ? "active" : ""} onClick={() => setCategory("")}>全部<span>{plugins.length}</span></button>{categories.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div>
    <CatalogStatus />
    <MarketPulse period={period} onPeriod={setPeriod} stats={rankings} source={rankSource} loading={rankLoading} error={rankError} lookup={(id) => plugins.find((item) => item.id === id)} onPick={jumpToPlugin} />
    <div className="results-heading"><span>{filtered.length} 个条目{category ? ` / ${category}` : ""}{filtered.length > visibleCount ? ` · 已显示 ${visibleCount}` : ""}</span>{(query || category || source || availability !== "all") && <button className="text-button" onClick={reset}>重置筛选<X size={12} /></button>}<span className="market-compatibility"><ShieldQuestion size={13} />兼容性以实际验证为准</span></div>
    {visible.length ? <div className="plugin-grid">{visible.map((plugin, index) => {
      const repo = repoFromPlugin(plugin);
      const stat = cardStats.get(plugin.id);
      return <PluginCard key={plugin.id} plugin={plugin} sources={sources} index={index} canInstall={online && !!installTarget} install={() => open({ type: "plugin", plugin })}
        social={{
          liked: social?.likedPlugins.includes(plugin.id) ?? false,
          starred: !!repo && starredRepos.has(repo.toLowerCase()),
          hasRepo: !!repo,
          likes: stat?.likes ?? 0,
          downloads: stat?.downloads ?? 0,
          period,
          likeBusy: likeBusy.includes(plugin.id),
          starBusy: starBusy.includes(plugin.id),
        }}
        onLike={() => void toggleLike(plugin)} onStar={() => void toggleStar(plugin)} />;
    })}</div>
      : <Empty icon={Search} title={catalogError ? "目录暂不可用" : plugins.length ? "没有找到匹配的插件" : "目录中暂无插件"} action={plugins.length ? <Button onClick={reset}>清空筛选</Button> : <Button icon={ArrowRight} onClick={() => navigate("settings")}>连接设置</Button>}>{catalogError || (plugins.length ? "试试其他关键词，或更换筛选条件。" : "目录准备好后，真实条目会显示在这里。")}</Empty>}
    {filtered.length > visibleCount && <div className="market-more"><Button variant="ghost" onClick={() => setVisibleCount((count) => count + 60)}>加载更多 · 剩余 {filtered.length - visibleCount} 条</Button></div>}
    <section className="sources-section"><SectionTitle title="目录来源"><Badge>{sources.length} 个来源</Badge></SectionTitle><div className="source-grid">{sources.map((item) => <div className="source-item" key={item.id}><span className="source-mark"><ExternalLink size={16} /></span><div><External href={item.url}>{item.name}</External><p>{item.description}</p></div></div>)}</div></section>
  </div>;
}
function PluginCard({ plugin, sources, index, canInstall, install, social, onLike, onStar }: {
  plugin: CatalogPlugin;
  sources: Source[];
  index: number;
  canInstall: boolean;
  install: () => void;
  social: {
    liked: boolean; starred: boolean; hasRepo: boolean; likes: number; downloads: number;
    period: RankPeriod; likeBusy: boolean; starBusy: boolean;
  };
  onLike: () => void;
  onStar: () => void;
}) {
  const installable = plugin.installable && !!plugin.ref;
  return <article className="plugin-card" id={`plugin-${plugin.id}`} style={{ "--item-index": Math.min(index, 8) } as React.CSSProperties}>
    <div className="plugin-card-heading"><span className={`plugin-tile tile-${index % 3}`}><Package size={22} strokeWidth={1.6} /></span><Badge>{plugin.category || "未分类"}</Badge></div>
    <h3 title={plugin.name}>{plugin.name}</h3><div className="plugin-version mono">{plugin.version || "版本未知"}{plugin.license && <span>{plugin.license}</span>}{plugin.downloads ? <span>⬇ {plugin.downloads.toLocaleString("zh-CN")}</span> : null}{plugin.stars ? <span>★ {plugin.stars}</span> : null}</div>
    <p className="plugin-description">{plugin.description || "来源未提供描述。"}</p>
    <div className="plugin-source"><External href={sourceHref(plugin.source, sources)}>{sourceLabel(plugin.source, sources)}</External></div>
    <div className="plugin-compatibility"><ShieldQuestion size={13} /><span>{plugin.coreRange ? `内核范围 ${plugin.coreRange} · 兼容性未知` : "兼容性未知"}</span></div>
    <PluginSocialActions {...social} onLike={onLike} onStar={onStar} />
    <div className="plugin-card-footer"><span className={`availability ${installable ? "" : "unavailable"}`}><i />{installable ? "提供安装引用" : "仅收录 · 暂不可安装"}</span>
      <Button icon={Plus} variant={installable ? "secondary" : "ghost"} disabled={!installable || !canInstall} title={!installable ? "上游未提供可安装包或禁止安装" : !canInstall ? "连接引擎并准备一个已停止的 Harness 实例" : "选择实例并安装此精确引用"} onClick={install}>安装</Button></div>
  </article>;
}
export function Packs({ open, navigate }: ViewProps) {
  const { catalog, catalogError, snapshot, online, notify } = useLauncher();
  const [tab, setTab] = useState<"catalog" | "hall">("catalog");
  const [exporting, setExporting] = useState(false);
  const [hallRevision, setHallRevision] = useState(0);
  const packs = catalog?.packs ?? [];
  const sources = catalog?.sources ?? [];
  return <div className="view">
    <div className="page-heading"><div><span className="eyebrow">DISCOVER / PACKS</span><h1>整合包<span className="heading-dot">.</span></h1><p>复刻别人的组合，或把你的一键分享给所有人。</p></div>
      <div className="heading-actions"><Button icon={FolderInput} onClick={() => openPackFilePicker((message) => notify(message, "error"))}>导入清单文件</Button><Button variant="primary" icon={Upload} disabled={!online} onClick={() => setExporting(true)}>从实例导出</Button></div></div>
    <div className="drop-hint"><PackageOpen size={15} /><span>把 <code>.eacpack.json</code> 整合包清单直接<b>拖进窗口任意位置</b>，松手即可一键空投安装；也可以点上面的「导入清单文件」。</span></div>
    <div className="segmented pack-tabs" aria-label="整合包来源"><button className={tab === "catalog" ? "active" : ""} aria-pressed={tab === "catalog"} onClick={() => setTab("catalog")}>目录整合包<span>{packs.length}</span></button><button className={tab === "hall" ? "active" : ""} aria-pressed={tab === "hall"} onClick={() => setTab("hall")}>玩家大厅</button></div>
    {tab === "hall" ? <HallPanel key={hallRevision} navigate={navigate} /> : <>
      <div className="pack-intro"><span className="pack-intro-icon"><Layers size={25} /></span><div><strong>一个整合包，一个独立工作区。</strong><p>先选择已安装内核，再按目录顺序安装精确引用。失败会保留实例和已经完成的部分。</p></div><Badge tone="yellow">兼容性未知时不作保证</Badge></div>
      <CatalogStatus />
      {packs.length ? <div className="packs-grid">{packs.map((pack, index) => <article className="pack-card" key={pack.id}><div className={`pack-graphic pack-graphic-${index % 3}`}><Layers size={42} strokeWidth={1.25} /><span className="mono">{String(index + 1).padStart(2, "0")}</span><div className="pack-graphic-pixels"><i /><i /><i /></div></div>
        <div className="pack-card-content"><div className="pack-card-source"><External href={sourceHref(pack.source, sources)}>{sourceLabel(pack.source, sources)}</External><Badge>{pack.plugins.length} 个引用</Badge></div><h2>{pack.name}</h2><p>{pack.description}</p>
          <div className="pack-kernel"><Layers size={13} />{pack.kernelVersion ? `声明内核 ${pack.kernelVersion}` : "未声明内核版本 · 兼容性未知"}</div>
          <details className="pack-refs"><summary>查看精确引用<ChevronRight size={12} /></summary>{pack.plugins.length ? <ol>{pack.plugins.map((item, i) => <li key={`${i}-${item.ref}`}><code>{item.ref}</code>{item.sha256 && <small>SHA-256: {item.sha256}</small>}</li>)}</ol> : <p>纯净工作区，不预装插件。</p>}</details>
          <Button variant="primary" icon={Plus} disabled={!online || !snapshot?.kernels.length} onClick={() => open({ type: "pack", pack })}>创建独立实例</Button>
        </div>
      </article>)}</div> : <Empty icon={Layers} title={catalogError ? "目录暂不可用" : "暂无整合包"}>{catalogError || "目录提供整合包后，会在这里展示真实组合。"}</Empty>}
    </>}
    {exporting && <ExportPackDialog close={() => setExporting(false)} onPublished={() => { setTab("hall"); setHallRevision((revision) => revision + 1); }} />}
  </div>;
}
export function Kernels({ open, navigate }: ViewProps) {
  const { snapshot, online, pending, run } = useLauncher();
  const [versions, setVersions] = useState<string[]>([]);
  const [tags, setTags] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(16);
  const load = useCallback(async () => {
    if (!online) return;
    setLoading(true); setError("");
    try { const result = await call<{ versions: string[]; tags: Record<string, string> }>("kernel_versions"); setVersions([...result.versions].reverse()); setTags(result.tags); }
    catch (reason) { setError(errorText(reason)); } finally { setLoading(false); }
  }, [online]);
  useEffect(() => { void load(); }, [load]);
  const filtered = versions.filter((version) => version.toLowerCase().includes(query.toLowerCase()));
  const kernels = snapshot?.kernels ?? [];
  return <div className="view">
    <div className="page-heading"><div><span className="eyebrow">WORKSPACE / RUNTIMES</span><h1>内核仓库<span className="heading-dot">.</span></h1><p>一个版本，一个目录。升级由你决定。</p></div><div className="heading-actions"><Button icon={FolderInput} disabled={!online} onClick={() => open({ type: "register" })}>注册已有内核</Button><Button variant="primary" icon={Plus} disabled={!online} onClick={() => open({ type: "install-kernel", versions })}>安装精确版本</Button></div></div>
    <section><SectionTitle title="已安装内核"><Badge>{kernels.length} 个版本</Badge></SectionTitle>
      {kernels.length ? <div className="kernel-list">{kernels.map((kernel) => {
        const references = snapshot?.instances.filter((item) => item.kernelId === kernel.id) ?? [];
        return <div className="kernel-row" key={kernel.id}><span className="kernel-icon"><Layers size={22} /></span><div className="kernel-row-content"><div><h3 className="mono">{kernel.version}</h3><Badge tone="cyan">已安装</Badge><small>{references.length} 个实例引用</small></div><code>{kernel.path}</code><small>{kernel.source} / {dateTime(kernel.installedAt)}</small></div>
          <div className="inline-actions"><IconButton icon={FolderOpen} label="打开内核目录" disabled={!online} onClick={() => void run("open_path", { path: kernel.path }, "打开内核目录", false).catch(() => undefined)} /><IconButton icon={Trash2} label={references.length ? "内核正在被实例引用，无法移除" : "移除内核"} disabled={!online || references.length > 0 || pending.some((item) => item.action === "remove_kernel")} onClick={() => open({ type: "confirm", title: "移除内核？", message: `移除 ${kernel.version} 的独立安装目录。只有未被实例引用的内核可以移除。`, label: "移除内核", action: "remove_kernel", payload: { id: kernel.id }, danger: true })} /></div></div>;
      })}</div> : <Empty icon={Layers} title={online ? "还没有安装内核" : "连接后查看本机内核"} compact action={<Button icon={FolderInput} disabled={!online} onClick={() => open({ type: "register" })}>注册已有内核</Button>}>安装一个官方 npm 精确版本，或注册已经存在的真实 DSH 目录。</Empty>}
    </section>
    <section className="version-section"><SectionTitle title="内核兼容性探针"><Badge tone="yellow">结论来自官方评估器</Badge></SectionTitle>
      <CompatibilityProbe />
    </section>
    <section className="version-section"><SectionTitle title="官方 npm 版本"><External href="https://www.npmjs.com/package/@deepseek-ai/harness">npm 来源</External><RefreshButton onClick={() => void load()} busy={loading} label="刷新官方版本" /></SectionTitle>
      <div className="version-toolbar"><div className="search-field"><Search size={15} /><input aria-label="筛选内核版本" value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(16); }} placeholder="查找精确版本…" /></div><span className="muted">{versions.length ? `${versions.length} 个已获取版本` : "从官方 npm 获取"}</span></div>
      <FormError error={error} />
      {loading && !versions.length ? <Empty icon={LoaderCircle} title="正在获取官方版本" compact /> : filtered.length ? <div className="version-list">{filtered.slice(0, visibleCount).map((version) => {
        const installed = kernels.some((item) => item.version === version);
        return <div className="version-row" key={version}><span className="version-line-icon"><Package size={17} /></span><strong className="mono">{version}</strong><div className="version-tags">{Object.entries(tags).filter(([, value]) => value === version).map(([tag]) => <Badge key={tag}>{tag}</Badge>)}</div>{installed ? <Badge tone="cyan"><Check size={11} />已安装</Badge> : <Button icon={Download} disabled={!online || pending.some((item) => item.action === "install_kernel")} onClick={() => open({ type: "install-kernel", version, versions })}>安装此版本</Button>}</div>;
      })}</div> : !error && <Empty icon={Search} title={query ? "未找到此版本" : online ? "官方未返回版本" : "连接引擎后获取版本"} compact>{query ? "也可以在安装对话框中输入完整的精确版本。" : "不会猜测或展示不存在的版本。"}</Empty>}
      {filtered.length > visibleCount && <Button variant="ghost" onClick={() => setVisibleCount((count) => count + 32)}>加载更多版本 · 剩余 {filtered.length - visibleCount}</Button>}
    </section>
    <div className="inline-note"><Layers size={16} /><span>桌面端安装包在发行版本中管理。</span><button className="text-button" onClick={() => navigate("releases")}>前往发行版本<ArrowRight size={13} /></button></div>
  </div>;
}
type Platform = "windows" | "macos" | "linux" | "unknown";
function assetPlatform(name: string): Platform {
  const value = name.toLowerCase();
  if (/darwin|macos|osx|\.dmg$|\.pkg$|(?:^|[-_.])mac(?:[-_.]|$)/.test(value)) return "macos";
  if (/^deepseek[.-]harness[.-]eac.*x64.*portable\.zip$/.test(value)) return "windows";
  if (/windows|win32|win64|win-x|win_arm|win-arm|\.exe$|\.msi$|(?:^|[-_.])win(?:[-_.]|$)/.test(value)) return "windows";
  if (/linux|\.appimage$|\.deb$|\.rpm$/.test(value)) return "linux";
  return "unknown";
}
function detectedPlatform(raw?: string): Platform {
  if (raw === "windows" || raw === "win32") return "windows";
  if (raw === "macos" || raw === "darwin") return "macos";
  if (raw === "linux") return "linux";
  return "unknown";
}
const platformNames: Record<Platform, string> = { windows: "Windows", macos: "macOS", linux: "Linux", unknown: "平台未标注" };
export function Releases({ open }: ViewProps) {
  const { snapshot, online, run, notify, pending } = useLauncher();
  const [source, setSource] = useState<"eac" | "official" | "kernel">("eac");
  const [platform, setPlatform] = useState<Platform | "all">("all");
  const [showPrerelease, setShowPrerelease] = useState(false);
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [downloaded, setDownloaded] = useState<Record<string, string>>({});
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const detected = detectedPlatform(snapshot?.platform);
    if (detected !== "unknown") setPlatform(detected);
  }, [snapshot?.platform]);
  useEffect(() => {
    if (!online) return;
    let active = true;
    setLoading(true); setError(""); setReleases([]);
    void call<{ releases: Release[] }>("releases", { source }).then((result) => { if (active) setReleases(result.releases); })
      .catch((reason: unknown) => { if (active) setError(errorText(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [source, online, revision]);
  const visible = releases.filter((release) => showPrerelease || !release.prerelease);
  const download = (asset: ReleaseAsset) => {
    void run<{ path: string; sha256: string; size: number }>("download_asset", { url: asset.url, filename: asset.name, ...(asset.sha256 ? { sha256: asset.sha256 } : {}) }, `下载 ${asset.name}`, false)
      .then((result) => { setDownloaded((items) => ({ ...items, [asset.url]: result.path })); notify(`下载完成：${result.path}`, "success"); }).catch(() => undefined);
  };
  return <div className="view">
    <div className="page-heading"><div><span className="eyebrow">DISCOVER / RELEASES</span><h1>发行版本<span className="heading-dot">.</span></h1><p>直接获取 EAC 与官方发行。每个文件都来自真实上游。</p></div><RefreshButton onClick={() => setRevision((value) => value + 1)} busy={loading} label="刷新发行版本" /></div>
    <div className="release-toolbar"><div className="segmented" aria-label="发行来源">{([{ id: "eac", name: "EAC 桌面端" }, { id: "official", name: "官方桌面端" }, { id: "kernel", name: "官方内核" }] as const).map((item) => <button key={item.id} className={source === item.id ? "active" : ""} aria-pressed={source === item.id} onClick={() => setSource(item.id)}>{item.name}</button>)}</div>
      <div className="release-filters"><Select aria-label="筛选发行平台" value={platform} onChange={(event) => setPlatform(event.target.value as Platform | "all")}><option value="all">所有平台</option><option value="windows">Windows</option><option value="macos">macOS</option><option value="linux">Linux</option><option value="unknown">平台未标注</option></Select><label className="checkbox-label"><input type="checkbox" checked={showPrerelease} onChange={(event) => setShowPrerelease(event.target.checked)} />预发行版</label></div></div>
    <FormError error={error} />
    {!online ? <Empty icon={Download} title="连接引擎，获取真实发行版本" action={<Button onClick={() => open({ type: "connection" })}>连接引擎</Button>}>发行信息由 Rust 从上游获取，不使用预设版本。</Empty>
      : loading ? <Empty icon={LoaderCircle} title="正在获取上游发行信息" />
        : visible.length ? <div className="release-list">{visible.map((release) => {
          const assets = release.assets.filter((asset) => platform === "all" || assetPlatform(asset.name) === platform);
          return <article className="release" key={release.tag}><div className="release-heading"><div><span className="release-symbol"><Download size={21} /></span><h2 className="mono">{release.tag}</h2>{release.prerelease && <Badge tone="yellow">预发行</Badge>}</div><time>{dateTime(release.publishedAt)}</time></div>
            {release.body && <details className="release-notes"><summary>发行说明<ChevronRight size={13} /></summary><pre>{release.body}</pre></details>}
            {assets.length ? <div className="asset-list">{assets.map((asset) => {
              const zip = /\.zip$/i.test(asset.name);
              const knownPlatform = assetPlatform(asset.name);
              const currentPlatform = detectedPlatform(snapshot?.platform);
              const canInstall = source !== "kernel" && zip && knownPlatform !== "unknown" && knownPlatform === currentPlatform;
              return <div className="asset-row" key={asset.url}><span className="asset-icon"><Package size={18} /></span><div className="asset-name"><strong>{asset.name}</strong><span>{platformNames[knownPlatform]}<i />{bytes(asset.size)}{asset.sha256 && <><i />SHA-256 已提供</>}</span>{downloaded[asset.url] && <code className="download-result">{downloaded[asset.url]}</code>}</div>
                <div className="asset-actions"><External href={asset.url}>来源</External><IconButton icon={ArrowDownToLine} label={`下载 ${asset.name}`} disabled={!online || pending.some((item) => item.label.includes(asset.name))} onClick={() => download(asset)} />{canInstall && <Button variant="primary" icon={Download} disabled={!online || pending.some((item) => item.action === "install_desktop")} onClick={() => open({ type: "desktop", asset, kind: source === "eac" ? "eac-desktop" : "official-desktop", tag: release.tag })}>安装 ZIP</Button>}{downloaded[asset.url] && <CopyButton text={downloaded[asset.url]} label="复制下载路径" />}</div></div>;
            })}</div> : <div className="release-no-assets">此版本没有匹配当前平台筛选的文件。<button className="text-button" onClick={() => setPlatform("all")}>查看所有平台<ArrowRight size={12} /></button></div>}
          </article>;
        })}</div> : !error && <Empty icon={Download} title={releases.length ? "没有匹配的稳定版" : "上游暂无发行版本"} action={releases.length ? <Button onClick={() => setShowPrerelease(true)}>显示预发行版</Button> : undefined}>可以刷新来源，或切换其他发行渠道。</Empty>}
    <div className="inline-note"><ShieldQuestion size={16} /><span>仅支持为当前平台安装便携 ZIP。其他格式可下载；未标注平台的文件不自动安装。</span></div>
  </div>;
}
