import { Heart, Star, Download, TrendingUp, Trophy } from "lucide-react";
import { call } from "./api";
import { hallBase, hallFetch, hallClientId } from "./hall";
import type { CatalogPlugin } from "./types";

export type RankPeriod = "day" | "week" | "month";
export interface PluginStat { id: string; downloads: number; likes: number }
export interface CardStat { downloads: number; likes: number }
export interface LocalStatsResponse {
  source: "local";
  downloads: Record<RankPeriod, { id: string; downloads: number }[]>;
  likes: { id: string; likes: number }[];
  totalDownloads: number;
}
export const periodLabel: Record<RankPeriod, string> = { day: "今日", week: "本周", month: "本月" };
export const periodLongLabel: Record<RankPeriod, string> = { day: "日榜", week: "周榜", month: "月榜" };

export function repoFromPlugin(plugin: CatalogPlugin): string | null {
  const candidates = [plugin.source, plugin.ref ?? ""];
  for (const value of candidates) {
    if (!value) continue;
    if (value.startsWith("github:")) {
      const repo = value.slice("github:".length).split("#")[0].replace(/\.git$/, "");
      if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return repo;
    }
    const match = value.match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
    if (match) return `${match[1]}/${match[2].replace(/\.git$/, "")}`;
  }
  return null;
}

function localStatMap(local: LocalStatsResponse, period: RankPeriod): Map<string, CardStat> {
  const map = new Map<string, CardStat>();
  for (const item of local.downloads[period] ?? []) map.set(item.id, { downloads: item.downloads, likes: 0 });
  for (const item of local.likes ?? []) {
    const current = map.get(item.id) ?? { downloads: 0, likes: 0 };
    current.likes = item.likes;
    map.set(item.id, current);
  }
  return map;
}

export async function loadRankings(period: RankPeriod, hallUrl: string, limit = 10): Promise<{ source: "hall" | "local"; stats: PluginStat[] }> {
  const base = hallBase(hallUrl);
  if (base) {
    try {
      const result = await hallFetch<{ plugins: PluginStat[] }>(base, `/api/plugins/stats?period=${period}&limit=${limit}`);
      if (Array.isArray(result.plugins) && result.plugins.length) {
        return { source: "hall", stats: result.plugins.slice(0, limit) };
      }
    } catch { /* Older hall servers fall back to local, real install records. */ }
  }
  const local = await call<LocalStatsResponse>("market_stats");
  const likes = new Map(local.likes.map((item) => [item.id, item.likes]));
  const stats = (local.downloads[period] ?? []).slice(0, limit).map((item) => ({
    id: item.id,
    downloads: item.downloads,
    likes: likes.get(item.id) ?? 0,
  }));
  return { source: "local", stats };
}

export async function loadCardStats(ids: string[], period: RankPeriod, hallUrl: string): Promise<Map<string, CardStat>> {
  const base = hallBase(hallUrl);
  if (base && ids.length) {
    try {
      const result = await hallFetch<{ plugins: PluginStat[] }>(base, `/api/plugins/stats?period=${period}&ids=${encodeURIComponent(ids.join(","))}`);
      if (Array.isArray(result.plugins)) {
        return new Map(result.plugins.map((item) => [item.id, { downloads: item.downloads, likes: item.likes }]));
      }
    } catch { /* Fall through to local counts. */ }
  }
  const local = await call<LocalStatsResponse>("market_stats");
  return localStatMap(local, period);
}

export async function sendHallDownload(hallUrl: string, pluginId: string) {
  const base = hallBase(hallUrl);
  if (!base) return null;
  return hallFetch<{ downloads: number; likes: number }>(base, `/api/plugins/${encodeURIComponent(pluginId)}/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client: hallClientId() }),
  });
}

export async function sendHallLike(hallUrl: string, pluginId: string) {
  const base = hallBase(hallUrl);
  if (!base) return null;
  return hallFetch<{ likes: number; liked: boolean }>(base, `/api/plugins/${encodeURIComponent(pluginId)}/like`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client: hallClientId() }),
  });
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function MarketPulse({ period, onPeriod, stats, source, loading, error, lookup, onPick }: {
  period: RankPeriod;
  onPeriod: (period: RankPeriod) => void;
  stats: PluginStat[];
  source: "hall" | "local" | "";
  loading: boolean;
  error: string;
  lookup: (id: string) => CatalogPlugin | undefined;
  onPick: (id: string) => void;
}) {
  const top = stats.slice(0, 3);
  const rest = stats.slice(3, 10);
  return <section className="market-pulse">
    <div className="market-pulse-heading">
      <div><span className="eyebrow">MARKET / TIDE</span><h2><TrendingUp size={18} />下载潮汐榜</h2><p>按真实安装次数排序，日、周、月三个窗口。</p></div>
      <div className="market-pulse-controls">
        <span className={`pulse-source ${source}`}><i />{loading ? "读取中" : source === "hall" ? "大厅实时" : source === "local" ? "本机记录" : "暂无数据"}</span>
        <div className="segmented" aria-label="榜单周期">
          {(["day", "week", "month"] as const).map((item) => <button key={item} className={period === item ? "active" : ""} aria-pressed={period === item} onClick={() => onPeriod(item)}>{periodLongLabel[item]}</button>)}
        </div>
      </div>
    </div>
    {loading && !stats.length ? <div className="pulse-loading"><span /><span /><span /></div>
      : stats.length ? <>
        <div className="pulse-podium">{top.map((item, index) => {
          const plugin = lookup(item.id);
          return <button type="button" key={item.id} className={`pulse-podium-card pulse-rank-${index + 1}`} onClick={() => onPick(item.id)}>
            <span className="pulse-rank"><Trophy size={13} />{index + 1}</span>
            <div className="pulse-podium-name"><strong>{plugin?.name ?? item.id}</strong><small>{plugin?.category || "未分类"}</small></div>
            <div className="pulse-podium-stats"><span><Download size={12} />{formatCount(item.downloads)}</span><span><Heart size={12} />{formatCount(item.likes)}</span></div>
            <span className="pulse-period">{periodLabel[period]}</span>
          </button>;
        })}</div>
        {rest.length > 0 && <ol className="pulse-rest">{rest.map((item, index) => {
          const plugin = lookup(item.id);
          return <li key={item.id}><button type="button" onClick={() => onPick(item.id)}>
            <span className="pulse-rest-rank">{String(index + 4).padStart(2, "0")}</span>
            <span className="pulse-rest-name"><strong>{plugin?.name ?? item.id}</strong><small>{plugin?.category || "未分类"}</small></span>
            <span className="pulse-rest-stat"><Download size={11} />{formatCount(item.downloads)}</span>
            <span className="pulse-rest-stat"><Heart size={11} />{formatCount(item.likes)}</span>
          </button></li>;
        })}</ol>}
      </> : <div className="pulse-empty"><TrendingUp size={22} /><div><strong>{error ? "榜单读取失败" : "这个周期还没有下载记录"}</strong><p>{error || "从市场安装插件后，真实安装次数会进入榜单。大厅离线时显示本机记录。"}</p></div></div>}
    <div className="pulse-foot"><span>{source === "hall" ? "数据来自大厅服务器汇总；点赞与下载均按真实操作记录。" : "数据来自本机成功安装记录，仅统计这台机器。"}</span><span>{periodLabel[period]} TOP 10</span></div>
  </section>;
}

export function PluginSocialActions({ liked, starred, hasRepo, likes, downloads, period, likeBusy, starBusy, onLike, onStar }: {
  liked: boolean;
  starred: boolean;
  hasRepo: boolean;
  likes: number;
  downloads: number;
  period: RankPeriod;
  likeBusy: boolean;
  starBusy: boolean;
  onLike: () => void;
  onStar: () => void;
}) {
  return <div className="plugin-social">
    <button type="button" className={`plugin-like ${liked ? "is-liked" : ""}`} aria-pressed={liked} aria-label={liked ? "取消点赞" : "点赞插件"} disabled={likeBusy} onClick={onLike}><Heart size={13} fill={liked ? "currentColor" : "none"} /><span>{formatCount(likes)}</span></button>
    {hasRepo && <button type="button" className={`plugin-star ${starred ? "is-starred" : ""}`} aria-pressed={starred} aria-label={starred ? "取消 Star" : "在 GitHub Star 此项目"} disabled={starBusy} onClick={onStar}><Star size={13} fill={starred ? "currentColor" : "none"} /><span>{starred ? "已 Star" : "Star"}</span></button>}
    <span className="plugin-downloads" title={`${periodLabel[period]}真实安装次数`}><Download size={12} />{formatCount(downloads)}<small>{periodLabel[period]}</small></span>
  </div>;
}
