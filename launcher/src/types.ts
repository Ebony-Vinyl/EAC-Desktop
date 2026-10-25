export type Theme = "light" | "dark" | "system";
export type Skin = "pixel" | "standard";
export type Kind = "harness" | "eac-desktop" | "official-desktop";
export type InstanceStatus = "stopped" | "starting" | "running" | "error";

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  source: string;
  coreRange?: string;
}
export interface Instance {
  id: string;
  name: string;
  kind: Kind;
  kernelId: string | null;
  port: number;
  home: string;
  workspace: string;
  plugins: InstalledPlugin[];
  createdAt: string;
  status: InstanceStatus;
  pid?: number;
  url?: string;
  executable?: string;
  inventoryError?: string;
}
export interface Kernel {
  id: string;
  version: string;
  path: string;
  nodePath: string;
  cliPath: string;
  installedAt: string;
  source: string;
}
export interface Task {
  id: string;
  label: string;
  status: "running" | "completed" | "failed" | "cancelled";
  progress: number | null;
  message: string;
  timestamp: string;
}
export interface Settings {
  theme: Theme;
  reducedMotion: boolean;
  githubClientId: string;
}
export interface SocialProfile {
  id: number;
  login: string;
  name?: string | null;
  avatarUrl: string;
  htmlUrl: string;
  bio?: string | null;
  company?: string | null;
  location?: string | null;
  blog?: string | null;
  twitterUsername?: string | null;
  email?: string | null;
  publicRepos?: number;
  publicGists?: number;
  followers?: number;
  following?: number;
  createdAt?: string;
}
export interface UsageTotals {
  tokens: number;
  input: number;
  output: number;
  cacheRead: number;
  reasoning: number;
  messages: number;
  durationMs: number;
  heat: number;
  avgSpeed: number | null;
}
export interface UsageModel extends UsageTotals {
  provider: string;
  model: string;
  lastAt?: string | null;
}
export interface UsageDay {
  date: string;
  tokens: number;
  input?: number;
  output: number;
  cacheRead?: number;
  messages?: number;
  heat: number;
}
export interface UsageRoot {
  label: string;
  path: string;
  files: number;
  records: number;
  errors: number;
  lastError?: string | null;
}
export interface UsageProfile {
  generatedAt: string;
  totals: UsageTotals;
  today: UsageTotals;
  week: UsageTotals;
  month: UsageTotals;
  heatmap: UsageDay[];
  recent: UsageDay[];
  models: UsageModel[];
  providers: { provider: string; tokens: number; messages: number }[];
  roots: UsageRoot[];
  sessions: number;
  turns: number;
  steps: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  avgSpeed: number | null;
  firstAt?: string | null;
  lastAt?: string | null;
  cachedFiles: number;
}
export interface SocialStatus {
  authenticated: boolean;
  profile?: SocialProfile | null;
  scopes?: string[] | null;
  starOk?: boolean | null;
  clientConfigured: boolean;
  likedPlugins: string[];
}
export type AchievementTier = "common" | "rare" | "epic" | "legendary";
export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  tier: AchievementTier;
  icon: string;
  target: number;
  current: number;
  points: number;
  hidden: boolean;
  unlockedAt?: string | null;
}
export interface AchievementSummary {
  total: number;
  unlockedCount: number;
  points: number;
  maxPoints: number;
  streak: number;
  bestStreak: number;
  days: number;
  opens: number;
  unlocked: Record<string, string>;
}
export interface AchievementView {
  definitions: AchievementDefinition[];
  summary: AchievementSummary;
  today: string;
}
export interface Snapshot {
  createdInstanceId?: string;
  root: string;
  platform: string;
  instances: Instance[];
  kernels: Kernel[];
  tasks: Task[];
  settings: Settings;
  social?: Pick<SocialStatus, "authenticated" | "profile" | "likedPlugins" | "clientConfigured" | "starOk">;
  achievements?: AchievementSummary;
}
export interface Source {
  id: string;
  name: string;
  url: string;
  description: string;
}
export interface CatalogPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  source: string;
  ref?: string;
  sha256?: string;
  coreRange?: string;
  license?: string;
  category?: string;
  installable: boolean;
  downloads?: number;
  stars?: number;
  reason?: string;
}
export interface Pack {
  id: string;
  name: string;
  description: string;
  source: string;
  kernelVersion?: string;
  plugins: { ref: string; sha256?: string }[];
}
export interface Catalog {
  updatedAt: string;
  sources: Source[];
  plugins: CatalogPlugin[];
  packs: Pack[];
}
export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
  sha256?: string;
}
export interface Release {
  tag: string;
  prerelease: boolean;
  publishedAt: string;
  body: string;
  assets: ReleaseAsset[];
}
export interface Backup {
  id: string;
  createdAt: string;
  path: string;
}
export type View = "overview" | "instances" | "market" | "kernels" | "releases" | "packs" | "tasks" | "achievements" | "profile" | "settings";
export type JsonPayload = Record<string, unknown>;

export const kindLabel: Record<Kind, string> = {
  harness: "Harness",
  "eac-desktop": "EAC Desktop",
  "official-desktop": "Official Desktop",
};
