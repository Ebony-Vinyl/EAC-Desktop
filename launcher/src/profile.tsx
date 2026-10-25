import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowUpRight, Building2, CalendarDays, Check, ChevronRight, Coins,
  Database, ExternalLink, Flame, Gauge, Github, ImagePlus, Link2, Mail, MapPin, Pencil,
  RefreshCw, RotateCcw, Sparkles, Trophy, Users, Zap,
} from "lucide-react";
import { call, errorText, native, persist, safeUrl, stored } from "./api";
import { Badge, Button, dateTime, Empty, FormError, SectionTitle } from "./components";
import { useLauncher } from "./store";
import type { UsageDay, UsageModel, UsageProfile } from "./types";
import type { ViewProps } from "./workspace";

interface Price { input: number; cacheRead: number; output: number }
const PRICE_KEY = "eacUsagePricing";
const DEFAULT_PRICES: Record<string, Price> = {
  "deepseek-chat": { input: 2, cacheRead: 0.2, output: 3 },
  "deepseek-reasoner": { input: 2, cacheRead: 0.2, output: 3 },
  "*": { input: 0, cacheRead: 0, output: 0 },
};
function loadPrices(): Record<string, Price> {
  try {
    const saved = JSON.parse(stored(localStorage, PRICE_KEY) || "{}") as Record<string, Partial<Price>>;
    const merged: Record<string, Price> = { ...DEFAULT_PRICES };
    for (const [key, value] of Object.entries(saved)) {
      if (!value || typeof value !== "object") continue;
      merged[key] = {
        input: Math.max(0, Number(value.input) || 0),
        cacheRead: Math.max(0, Number(value.cacheRead) || 0),
        output: Math.max(0, Number(value.output) || 0),
      };
    }
    return merged;
  } catch { return { ...DEFAULT_PRICES }; }
}
function priceKey(model: UsageModel) { return `${model.provider}/${model.model}`; }
function priceFor(model: UsageModel, prices: Record<string, Price>): Price {
  return prices[priceKey(model)] ?? prices[model.model] ?? (model.model.toLowerCase().startsWith("deepseek") ? prices["deepseek-chat"] : prices["*"]) ?? { input: 0, cacheRead: 0, output: 0 };
}
function configured(price: Price) { return price.input > 0 || price.cacheRead > 0 || price.output > 0; }
function modelCost(model: UsageModel, price: Price) {
  if (!configured(price)) return null;
  return (model.input * price.input + model.cacheRead * price.cacheRead + model.output * price.output) / 1_000_000;
}
function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString("zh-CN");
}
function formatCost(value: number | null): string {
  if (value === null) return "未配置";
  if (value > 0 && value < 0.01) return "< ¥0.01";
  return `¥${value.toFixed(2)}`;
}
function formatSpeed(value: number | null | undefined): string {
  return typeof value === "number" && value > 0 ? `${value.toFixed(1)} tok/s` : "—";
}
function joined(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(date);
}
async function fileToAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("请选择图片文件（PNG、JPG、WebP 等）。");
  if (file.size > 8 * 1024 * 1024) throw new Error("图片不能超过 8MB。");
  const bitmap = await createImageBitmap(file);
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法处理这张图片。");
  const scale = Math.max(size / bitmap.width, size / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
  bitmap.close();
  return canvas.toDataURL("image/webp", 0.9);
}

export function Profile({ navigate }: ViewProps) {
  const { snapshot, social, achievementSummary, customAvatar, setCustomAvatar, refreshSocial, notify, online } = useLauncher();
  const [usage, setUsage] = useState<UsageProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [usageError, setUsageError] = useState("");
  const [prices, setPrices] = useState<Record<string, Price>>(loadPrices);
  const fileRef = useRef<HTMLInputElement>(null);
  const refreshedAccount = useRef(false);
  const profile = social?.profile;  const loadUsage = useCallback(async (refresh = false) => {
    if (!online) return;
    setLoading(true); setUsageError("");
    try {
      setUsage(await call<UsageProfile>("usage_profile", { refresh }));
    } catch (reason) {
      setUsageError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, [online]);
  useEffect(() => { void loadUsage(false); }, [loadUsage]);
  useEffect(() => {
    if (!social?.authenticated || refreshedAccount.current) return;
    refreshedAccount.current = true;
    void call("github_refresh").then(() => refreshSocial()).catch(() => undefined);
  }, [social?.authenticated, refreshSocial]);
  const openLink = (raw?: string | null) => {
    if (!raw) return;
    const url = safeUrl(raw) ?? safeUrl(`https://${raw}`);
    if (!url) { notify("链接格式无效。", "error"); return; }
    if (native) void call("open_url", { url }).catch((reason: unknown) => notify(errorText(reason), "error"));
    else window.open(url, "_blank", "noopener,noreferrer");
  };
  const pickAvatar = () => fileRef.current?.click();
  const onAvatar = async (file?: File) => {
    if (!file) return;
    try {
      setCustomAvatar(await fileToAvatar(file));
      notify("自定义头像已更新。", "success");
    } catch (reason) {
      notify(errorText(reason), "error");
    }
  };
  const savePrices = () => {
    persist(localStorage, PRICE_KEY, JSON.stringify(prices));
    notify("模型单价已保存，估价会立即更新。", "success");
  };
  const resetPrices = () => {
    setPrices({ ...DEFAULT_PRICES });
    persist(localStorage, PRICE_KEY, JSON.stringify(DEFAULT_PRICES));
    notify("已恢复默认估价。", "info");
  };
  const totals = usage?.totals;
  const models = usage?.models ?? [];
  const costRows = models.map((model) => ({ model, price: priceFor(model, prices), cost: modelCost(model, priceFor(model, prices)) }));
  const totalCost = costRows.reduce((sum, row) => sum + (row.cost ?? 0), 0);
  const configuredCount = costRows.filter((row) => configured(row.price)).length;
  const avatar = customAvatar || profile?.avatarUrl;
  const initial = (profile?.name || profile?.login || "EAC").trim().slice(0, 1).toUpperCase() || "E";
  const heatmap = useMemo(() => {
    const days = usage?.heatmap ?? [];
    if (!days.length) return { weeks: [] as (UsageDay | null)[][], months: [] as { index: number; label: string }[], max: 1 };
    const max = Math.max(1, ...days.map((day) => day.tokens));
    const cells: (UsageDay | null)[] = [];
    const first = new Date(`${days[0].date}T00:00:00`);
    for (let index = 0; index < first.getDay(); index += 1) cells.push(null);
    cells.push(...days);
    const weeks: (UsageDay | null)[][] = [];
    for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
    const months: { index: number; label: string }[] = [];
    let last = "";
    weeks.forEach((week, index) => {
      const day = week.find((item) => item && Number(item.date.slice(8)) <= 7);
      if (!day) return;
      const month = day.date.slice(0, 7);
      if (month !== last) {
        months.push({ index, label: `${Number(day.date.slice(5, 7))}月` });
        last = month;
      }
    });
    return { weeks, months, max };
  }, [usage?.heatmap]);
  const recentMax = Math.max(1, ...(usage?.recent ?? []).map((day) => day.tokens));
  const totalPlugins = snapshot?.instances.reduce((sum, instance) => sum + instance.plugins.length, 0) ?? 0;
  const running = snapshot?.instances.filter((instance) => instance.status === "running").length ?? 0;
  return <div className="view profile-view">
    <div className="page-heading">
      <div><span className="eyebrow">IDENTITY / PROFILE</span><h1>个人中心<span className="heading-dot">.</span></h1><p>账号、头像、成就，以及 DSH 真实用量与估价。</p></div>
      <div className="heading-actions">
        <Button icon={RefreshCw} busy={loading} disabled={!online} onClick={() => void loadUsage(true)}>刷新用量</Button>
        {profile ? <Button icon={ExternalLink} onClick={() => openLink(profile.htmlUrl)}>GitHub 主页</Button> : <Badge tone="yellow">GitHub 登录 · 开发中</Badge>}
      </div>
    </div>
    <section className="profile-hero">
      <div className="profile-avatar-zone">
        <span className="profile-avatar">
          {avatar ? <img src={avatar} alt="个人头像" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}
          <span className="profile-avatar-fallback">{initial}</span>
          {customAvatar && <i className="profile-avatar-badge"><Pencil size={10} />自定义</i>}
        </span>
        <div className="profile-avatar-actions">
          <button type="button" onClick={pickAvatar}><ImagePlus size={14} />更换头像</button>
          {customAvatar && <button type="button" onClick={() => { setCustomAvatar(null); notify("已恢复 GitHub 头像。", "info"); }}><RotateCcw size={14} />恢复</button>}
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(event) => { void onAvatar(event.target.files?.[0]); event.target.value = ""; }} />
      </div>
      <div className="profile-identity">
        <span className="eyebrow">{profile ? "GITHUB / CONNECTED" : "LOCAL / EXPLORER"}</span>
        <h2>{profile?.name || profile?.login || "本机探索者"}<span className="heading-dot">.</span></h2>
        {profile ? <div className="profile-handle">@{profile.login}{profile.bio && <span>{profile.bio}</span>}</div> : <p className="profile-handle">登录 GitHub 后，这里会显示公开资料、Star 与点赞记录。用量统计仍然只来自本机。</p>}
        <div className="profile-meta">
          {profile?.company && <span><Building2 size={13} />{profile.company}</span>}
          {profile?.location && <span><MapPin size={13} />{profile.location}</span>}
          {profile?.blog && <button type="button" onClick={() => openLink(profile.blog)}><Link2 size={13} />{profile.blog.replace(/^https?:\/\//, "")}<ArrowUpRight size={11} /></button>}
          {profile?.twitterUsername && <button type="button" onClick={() => openLink(`https://x.com/${profile.twitterUsername}`)}><Users size={13} />@{profile.twitterUsername}</button>}
          {profile?.email && <span><Mail size={13} />{profile.email}</span>}
          {joined(profile?.createdAt) && <span><CalendarDays size={13} />加入于 {joined(profile?.createdAt)}</span>}
          {!profile && <span><Github size={13} />未登录 GitHub</span>}
        </div>
        <div className="profile-stats">
          <span><strong>{profile?.publicRepos ?? "—"}</strong>公开仓库</span>
          <span><strong>{profile?.publicGists ?? "—"}</strong>公开 Gist</span>
          <span><strong>{profile?.followers ?? "—"}</strong>关注者</span>
          <span><strong>{profile?.following ?? "—"}</strong>正在关注</span>
          <span><strong>{snapshot?.instances.length ?? 0}</strong>本机实例</span>
          <span><strong>{running}</strong>正在运行</span>
        </div>
      </div>
      <div className="profile-hero-side">
        <div className="profile-achievement-card">
          <span className="profile-achievement-mark"><Trophy size={20} /></span>
          <div><span className="eyebrow">ACHIEVEMENTS</span><strong>{achievementSummary?.points ?? 0} PT</strong><small>{achievementSummary?.unlockedCount ?? 0} / {achievementSummary?.total ?? 0} 已点亮 · 连续 {achievementSummary?.streak ?? 0} 天</small></div>
          <button type="button" onClick={() => navigate("achievements")} aria-label="查看全部成就"><ChevronRight size={16} /></button>
        </div>
        <div className="profile-local-card">
          <span><Database size={14} />本机工作区</span>
          <div><strong>{snapshot?.kernels.length ?? 0}</strong><small>内核</small><strong>{totalPlugins}</strong><small>插件</small><strong>{snapshot?.tasks.length ?? 0}</strong><small>任务</small></div>
        </div>
      </div>
    </section>
    <div className="profile-metrics">
      <div className="profile-metric"><span><Zap size={14} />总 Token</span><strong>{formatTokens(totals?.tokens ?? 0)}</strong><small>输入 {formatTokens(totals?.input ?? 0)} · 输出 {formatTokens(totals?.output ?? 0)}</small></div>
      <div className="profile-metric"><span><Flame size={14} />热力值</span><strong>{formatTokens(totals?.heat ?? 0)}</strong><small>输出×1 + 输入×0.2 + 缓存×0.05</small></div>
      <div className="profile-metric"><span><Gauge size={14} />平均速度</span><strong>{formatSpeed(usage?.avgSpeed)}</strong><small>{usage?.steps ?? 0} 次模型回复的实测均值</small></div>
      <div className="profile-metric"><span><Activity size={14} />会话 / 轮次</span><strong>{usage?.sessions ?? 0}<small> / {usage?.turns ?? 0}</small></strong><small>{usage?.activeDays ?? 0} 个活跃日 · 最长连续 {usage?.longestStreak ?? 0} 天</small></div>
      <div className="profile-metric"><span><Coins size={14} />估算费用</span><strong>{formatCost(configuredCount ? totalCost : null)}</strong><small>{configuredCount ? `${configuredCount}/${models.length} 个模型已配置单价` : "在下方填写单价后估算"}</small></div>
      <div className="profile-metric"><span><Database size={14} />缓存读取</span><strong>{formatTokens(totals?.cacheRead ?? 0)}</strong><small>推理 Token {formatTokens(totals?.reasoning ?? 0)}</small></div>
    </div>
    <div className="profile-layout">
      <section className="profile-panel profile-heatmap-panel">
        <SectionTitle title="Token 热力图" eyebrow="LAST 365 DAYS"><span className="profile-panel-note">最近活动 {dateTime(usage?.lastAt ?? undefined)}</span></SectionTitle>
        {usage && usage.totals.tokens > 0 && usage.heatmap.length ? <>
          <div className="heatmap-shell">
            <div className="heatmap-day-labels" aria-hidden="true"><span /><span>一</span><span /><span>三</span><span /><span>五</span><span /></div>
            <div className="heatmap-main">
              <div className="heatmap-months" style={{ gridTemplateColumns: `repeat(${heatmap.weeks.length}, 12px)` }}>
                {heatmap.months.map((month) => <span key={`${month.index}-${month.label}`} style={{ gridColumnStart: month.index + 1 }}>{month.label}</span>)}
              </div>
              <div className="heatmap-weeks">
                {heatmap.weeks.map((week, weekIndex) => <div className="heatmap-week" key={weekIndex}>
                  {week.map((day, dayIndex) => {
                    if (!day) return <span key={dayIndex} className="heat-cell is-empty" />;
                    const level = day.tokens <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((Math.log10(day.tokens + 1) / Math.log10(heatmap.max + 1)) * 4)));
                    return <span key={dayIndex} className={`heat-cell level-${level}`} title={`${day.date} · ${day.tokens.toLocaleString("zh-CN")} tokens · ${day.messages ?? 0} 次回复`} />;
                  })}
                </div>)}
              </div>
            </div>
          </div>
          <div className="heatmap-footer"><span>少</span><div className="heatmap-legend">{[0, 1, 2, 3, 4].map((level) => <i key={level} className={`heat-cell level-${level}`} />)}</div><span>多</span><span className="heatmap-total">{formatTokens(totals?.tokens ?? 0)} tokens / 365 天</span></div>
          <div className="usage-recent">
            <div className="usage-recent-heading"><strong>最近 30 天</strong><span>{usage.today.tokens.toLocaleString("zh-CN")} tokens 今天</span></div>
            <div className="usage-bars">{usage.recent.map((day) => <span key={day.date} className={`usage-bar ${day.tokens ? "has-data" : ""}`} style={{ height: `${Math.max(4, Math.sqrt(day.tokens / recentMax) * 100)}%` }} title={`${day.date} · ${day.tokens.toLocaleString("zh-CN")} tokens`} />)}</div>
            <div className="usage-bars-labels"><span>{usage.recent[0]?.date.slice(5)}</span><span>{usage.recent[usage.recent.length - 1]?.date.slice(5)}</span></div>
          </div>
        </> : <Empty icon={Database} title={loading ? "正在读取本机用量…" : online ? "还没有发现 DSH 用量" : "连接引擎后读取本机用量"} compact>{loading ? "正在解析会话日志中的 usage 与模型字段，首次扫描可能需要几秒。" : online ? "启动器会读取实例与本机 ~/.dsh 的会话日志；只解析 usage 与模型字段，不读取消息内容。首次运行实例后这里就会出现真实数据。" : "用量统计由本地 Rust 引擎读取，不上传。"}</Empty>}
        <FormError error={usageError} />
      </section>
      <aside className="profile-side">
        <section className="profile-panel profile-achievement-mini">
          <SectionTitle title="旅程概览" eyebrow="JOURNEY"><Badge tone="cyan">{achievementSummary?.points ?? 0} PT</Badge></SectionTitle>
          <div className="profile-progress-ring" style={{ "--progress": achievementSummary && achievementSummary.total ? Math.round((achievementSummary.unlockedCount / achievementSummary.total) * 100) : 0 } as React.CSSProperties}><span>{achievementSummary?.unlockedCount ?? 0}<small>/{achievementSummary?.total ?? 0}</small></span></div>
          <div className="profile-achievement-lines">
            <span><Flame size={13} />当前连续 <strong>{achievementSummary?.streak ?? 0}</strong> 天</span>
            <span><Sparkles size={13} />最佳连续 <strong>{achievementSummary?.bestStreak ?? 0}</strong> 天</span>
            <span><CalendarDays size={13} />累计活跃 <strong>{achievementSummary?.days ?? 0}</strong> 天</span>
            <span><Trophy size={13} />打开启动器 <strong>{achievementSummary?.opens ?? 0}</strong> 次</span>
          </div>
          <Button icon={Trophy} onClick={() => navigate("achievements")}>查看全部成就</Button>
        </section>
        <section className="profile-panel">
          <SectionTitle title="数据源" eyebrow="LOCAL SOURCES"><Badge>{usage?.roots.length ?? 0} 个</Badge></SectionTitle>
          {usage?.roots.length ? <div className="profile-roots">{usage.roots.map((root) => <div key={root.path} className="profile-root">
            <span className={`root-dot ${root.errors ? "has-error" : ""}`} />
            <div><strong>{root.label}</strong><code>{root.path}</code><small>{root.files} 个会话文件 · {root.records} 条用量{root.errors ? ` · ${root.errors} 个读取错误` : ""}</small></div>
          </div>)}</div> : <p className="profile-muted">还没有找到会话目录。运行一次实例，或把 <code>EAC_USAGE_INCLUDE_HOME=1</code> 设置为扫描本机 <code>~/.dsh</code>。</p>}
          <div className="profile-privacy"><Check size={13} /><span>只解析 <code>assistant/message.usage</code> 与模型字段，不上传任何消息内容。</span></div>
          {usage && (usage.firstAt || usage.lastAt) && <div className="profile-usage-range"><span>首次记录 <strong>{dateTime(usage.firstAt ?? undefined)}</strong></span><span>最近活动 <strong>{dateTime(usage.lastAt ?? undefined)}</strong></span></div>}
        </section>
      </aside>
    </div>
    <section className="profile-panel profile-models-panel">
      <SectionTitle title="模型用量" eyebrow="MODELS & SPEED"><span className="profile-panel-note">速度来自 step/start → 模型回复的真实耗时</span></SectionTitle>
      {usage?.providers.length ? <div className="profile-providers">{usage.providers.slice(0, 5).map((provider) => <div key={provider.provider}>
        <span><strong>{provider.provider}</strong><small>{formatTokens(provider.tokens)} · {provider.messages} 次</small></span>
        <i><b style={{ width: `${totals?.tokens ? (provider.tokens / totals.tokens) * 100 : 0}%` }} /></i>
      </div>)}</div> : null}
      {models.length ? <div className="usage-model-table">
        <div className="usage-model-header"><span>#</span><span>模型</span><span>用量占比</span><span>Tokens</span><span>速度</span><span>估价</span></div>
        {costRows.map(({ model, price, cost }, index) => <div className="usage-model-row" key={priceKey(model)}>
          <span className="usage-model-rank">{String(index + 1).padStart(2, "0")}</span>
          <div className="usage-model-name"><strong>{model.model}</strong><small>{model.provider} · {model.messages} 次回复</small></div>
          <div className="usage-model-bar"><span style={{ width: `${totals?.tokens ? (model.tokens / totals.tokens) * 100 : 0}%` }} /></div>
          <span className="usage-model-tokens">{formatTokens(model.tokens)}<small>输入 {formatTokens(model.input)} · 输出 {formatTokens(model.output)}</small></span>
          <span className="usage-model-speed">{formatSpeed(model.avgSpeed)}<small>{model.durationMs ? `${Math.round(model.durationMs / 1000)}s 累计` : "无耗时样本"}</small></span>
          <span className={`usage-model-cost ${configured(price) ? "" : "is-unset"}`}>{formatCost(cost)}<small>{configured(price) ? `¥${price.input}/¥${price.cacheRead}/¥${price.output}` : "填写单价后估算"}</small></span>
        </div>)}
      </div> : <Empty icon={Gauge} title="还没有模型用量" compact>成功完成一次 DSH 对话后，模型、Token、速度与估价会出现在这里。</Empty>}
    </section>
    <section className="profile-panel profile-pricing-panel">
      <details>
        <summary><span><Coins size={16} />估价单价设置</span><small>人民币 / 每百万 Token · 仅作估算</small><ChevronRight size={14} /></summary>
        <div className="profile-pricing-body">
          <p>默认预置 DeepSeek 参考价（官方价格可能调整）；其他模型请按你的实际渠道填写。留 0 表示不估算。价格只保存在本机浏览器，不会上传。</p>
          <div className="pricing-table">
            <div className="pricing-header"><span>模型</span><span>输入（缓存未命中）</span><span>缓存读取</span><span>输出</span></div>
            {models.slice(0, 16).map((model) => {
              const key = priceKey(model);
              const price = prices[key] ?? { input: 0, cacheRead: 0, output: 0 };
              return <div className="pricing-row" key={key}><strong>{model.model}<small>{model.provider}</small></strong>
                {(["input", "cacheRead", "output"] as const).map((field) => <input key={field} aria-label={`${model.model} ${field} 单价`} type="number" min={0} step={0.01} value={price[field]} onChange={(event) => setPrices((current) => ({ ...current, [key]: { ...price, [field]: Math.max(0, Number(event.target.value) || 0) } }))} />)}
              </div>;
            })}
            <div className="pricing-row pricing-fallback"><strong>其他未列出的模型<small>通配单价</small></strong>
              {(["input", "cacheRead", "output"] as const).map((field) => <input key={field} aria-label={`通配 ${field} 单价`} type="number" min={0} step={0.01} value={prices["*"]?.[field] ?? 0} onChange={(event) => setPrices((current) => ({ ...current, "*": { ...(current["*"] ?? { input: 0, cacheRead: 0, output: 0 }), [field]: Math.max(0, Number(event.target.value) || 0) } }))} />)}
            </div>
          </div>
          <div className="profile-pricing-actions"><Button icon={RotateCcw} onClick={resetPrices}>恢复默认</Button><Button variant="primary" icon={Check} onClick={savePrices}>保存单价</Button></div>
        </div>
      </details>
    </section>
  </div>;
}
