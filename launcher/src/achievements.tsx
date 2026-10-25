import { useMemo, useState } from "react";
import {
  Activity, Archive, Box, Calendar, CalendarDays, CalendarRange, ChartNoAxesColumn,
  Check, Cog, Compass, Download, Flame, Github, Heart, Layers, Lock, Moon, MoonStar,
  Orbit, Package, PlaneLanding, Plug, Rocket, Search, Shield, Sparkles, Star, Sunrise,
  Trophy, Waves,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge, Button, dateTime, Empty, SectionTitle } from "./components";import { useLauncher } from "./store";
import type { AchievementDefinition, AchievementTier } from "./types";
import type { ViewProps } from "./workspace";

const icons: Record<string, LucideIcon> = {
  spark: Sparkles, moon: Moon, sunrise: Sunrise, box: Box, rocket: Rocket, layers: Layers,
  archive: Archive, shield: Shield, github: Github, star: Star, constellation: Orbit,
  compass: Compass, heart: Heart, gear: Cog, plug: Plug, "moon-gear": MoonStar,
  package: Package, parachute: PlaneLanding, search: Search, chart: ChartNoAxesColumn,
  calendar: CalendarDays, "calendar-week": CalendarRange, "calendar-month": Calendar,
  waves: Waves, download: Download, tide: Activity,
};
const tierLabels: Record<AchievementTier, string> = { common: "普通", rare: "稀有", epic: "史诗", legendary: "传说" };

function AchievementIcon({ definition, size = 19 }: { definition: AchievementDefinition; size?: number }) {
  const Icon = definition.unlockedAt ? icons[definition.icon] ?? Trophy : definition.hidden ? Lock : icons[definition.icon] ?? Trophy;
  return <Icon size={size} strokeWidth={1.7} />;
}

export function Achievements(_: ViewProps) {
  const { achievements, achievementSummary, social } = useLauncher();
  const [category, setCategory] = useState("全部");
  const [status, setStatus] = useState<"all" | "unlocked" | "locked">("all");
  const definitions = achievements?.definitions ?? [];
  const summary = achievements?.summary ?? achievementSummary;
  const categories = useMemo(() => ["全部", ...new Set(definitions.map((item) => item.category))], [definitions]);
  const filtered = useMemo(() => definitions.filter((item) =>
    (category === "全部" || item.category === category)
    && (status === "all" || (status === "unlocked" ? !!item.unlockedAt : !item.unlockedAt))), [definitions, category, status]);
  const recent = useMemo(() => definitions
    .filter((item) => item.unlockedAt)
    .sort((a, b) => (b.unlockedAt ?? "").localeCompare(a.unlockedAt ?? ""))
    .slice(0, 4), [definitions]);
  const total = summary?.total ?? definitions.length;
  const unlocked = summary?.unlockedCount ?? definitions.filter((item) => item.unlockedAt).length;
  const percent = total ? Math.round((unlocked / total) * 100) : 0;
  const points = summary?.points ?? 0;
  const maxPoints = summary?.maxPoints ?? definitions.reduce((sum, item) => sum + item.points, 0);
  return <div className="view achievements-view">
    <div className="page-heading">
      <div><span className="eyebrow">JOURNEY / ACHIEVEMENTS</span><h1>成就<span className="heading-dot">.</span></h1><p>每一次真实操作，都会在这片深海里留下光点。</p></div>
      {!social?.authenticated && <Badge tone="yellow">GitHub 登录 · 开发中</Badge>}
    </div>
    <section className="achievement-hero">
      <div className="achievement-ring" style={{ "--progress": percent } as React.CSSProperties}>
        <div className="achievement-ring-inner"><strong>{percent}<span>%</span></strong><small>完成度</small></div>
      </div>
      <div className="achievement-hero-copy">
        <span className="eyebrow">DEEP SEA LOG / {new Date().getFullYear()}</span>
        <h2>{percent >= 100 ? "深海全图鉴" : percent >= 60 ? "资深下潜者" : percent >= 25 ? "稳定航行中" : "旅程刚刚开始"}</h2>
        <p>{unlocked} 个成就已点亮，共 {total} 个。隐藏成就不会剧透，达成后才会显形。</p>
        <div className="achievement-hero-chips">
          <span><Trophy size={13} />{points} / {maxPoints} PT</span>
          <span><Flame size={13} />连续 {summary?.streak ?? 0} 天</span>
          <span><CalendarDays size={13} />累计 {summary?.days ?? 0} 天</span>
          <span><Check size={13} />{unlocked} / {total}</span>
        </div>
      </div>
      <div className="achievement-hero-meter">
        <div><span>本季进度</span><strong>{points}<small> PT</small></strong></div>
        <div className="achievement-meter-track"><span style={{ width: `${maxPoints ? (points / maxPoints) * 100 : 0}%` }} /></div>
        <small>{maxPoints - points} PT 即可点亮全部成就</small>
      </div>
    </section>
    {recent.length > 0 && <section className="achievement-recent">
      <SectionTitle title="最近点亮" eyebrow="RECENT UNLOCKS"><Badge tone="cyan">{recent.length} 条</Badge></SectionTitle>
      <div className="achievement-recent-row">{recent.map((item) => <div className={`achievement-recent-item tier-${item.tier}`} key={item.id}>
        <span className="achievement-recent-icon"><AchievementIcon definition={item} size={17} /></span>
        <div><strong>{item.name}</strong><small>{dateTime(item.unlockedAt ?? undefined)}</small></div>
        <span className="achievement-recent-points">+{item.points}</span>
      </div>)}</div>
    </section>}
    <div className="achievement-toolbar">
      <div className="category-strip achievement-categories">{categories.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}<span>{definitions.filter((entry) => item === "全部" || entry.category === item).length}</span></button>)}</div>
      <div className="segmented" aria-label="成就状态筛选">
        {([["all", "全部"], ["unlocked", "已点亮"], ["locked", "未点亮"]] as const).map(([value, label]) =>
          <button key={value} className={status === value ? "active" : ""} aria-pressed={status === value} onClick={() => setStatus(value)}>{label}</button>)}
      </div>
    </div>
    {filtered.length ? <div className="achievement-grid">{filtered.map((item, index) => {
      const progress = item.target > 0 ? Math.min(100, Math.round((item.current / item.target) * 100)) : 100;
      const hidden = item.hidden && !item.unlockedAt;
      return <article key={item.id} className={`achievement-card tier-${item.tier} ${item.unlockedAt ? "is-unlocked" : "is-locked"} ${hidden ? "is-hidden" : ""}`} style={{ "--item-index": Math.min(index, 12) } as React.CSSProperties}>
        <div className="achievement-card-top">
          <span className="achievement-icon"><AchievementIcon definition={item} /></span>
          <span className="achievement-tier">{hidden ? "隐藏" : tierLabels[item.tier]}</span>
          {item.unlockedAt && <span className="achievement-check"><Check size={11} /></span>}
        </div>
        <h3>{item.name}</h3>
        <p>{item.description}</p>
        <div className="achievement-progress-meta">
          <span>{hidden ? "???" : `${item.current} / ${item.target}`}</span>
          <span className="achievement-points">{item.points} PT</span>
        </div>
        <div className="achievement-progress"><span style={{ width: `${progress}%` }} /></div>
        <div className="achievement-card-foot">
          <span>{item.category}</span>
          <span>{item.unlockedAt ? dateTime(item.unlockedAt) : hidden ? "隐藏成就" : "未点亮"}</span>
        </div>
      </article>;
    })}</div> : <Empty icon={Trophy} title={definitions.length ? "这个筛选下没有成就" : "成就目录尚未加载"} action={definitions.length ? <Button onClick={() => { setCategory("全部"); setStatus("all"); }}>清空筛选</Button> : undefined}>{definitions.length ? "换一个分类或状态看看。" : "连接本地引擎后，成就目录会从真实状态加载。"}</Empty>}
  </div>;
}
