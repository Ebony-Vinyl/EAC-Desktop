import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { call, checkSnapshot, errorText, persist, stored } from "./api";
import type {
  AchievementDefinition, AchievementSummary, AchievementView, Catalog, JsonPayload,
  Settings, Skin, Snapshot, SocialStatus, Theme,
} from "./types";

interface Notice { id: number; message: string; tone: "success" | "error" | "info" | "achievement" }
interface Pending { id: number; action: string; label: string; instanceId?: string }
interface LauncherStore {
  snapshot: Snapshot | null;
  online: boolean;
  connecting: boolean;
  connectionError: string;
  catalog: Catalog | null;
  catalogOrigin: "backend" | "bundled" | null;
  catalogError: string;
  settings: Settings;
  skin: Skin;
  petScale: number;
  setPetScale: (scale: number) => void;
  setSkin: (skin: Skin) => void;
  hallUrl: string;
  setHallUrl: (url: string) => void;
  debug: boolean;
  setDebug: (on: boolean) => void;
  pending: Pending[];
  notices: Notice[];
  social: SocialStatus | null;
  achievements: AchievementView | null;
  achievementSummary: AchievementSummary | null;
  starredRepos: Set<string>;
  customAvatar: string | null;
  setCustomAvatar: (value: string | null) => void;
  refresh: () => Promise<void>;
  refreshCatalog: () => Promise<void>;
  refreshSocial: () => Promise<void>;
  refreshAchievements: () => Promise<void>;
  reconnect: () => Promise<void>;
  run: <T = Snapshot>(action: string, payload: JsonPayload, label: string, snapshotResult?: boolean) => Promise<T>;
  notify: (message: string, tone?: Notice["tone"]) => void;
  dismiss: (id: number) => void;
  saveAppearance: (patch: Partial<Settings>) => Promise<void>;
  recordEvent: (event: string, value?: string) => Promise<void>;
  likePlugin: (pluginId: string, liked: boolean) => Promise<{ liked: boolean; likes: number }>;
  downloadPlugin: (pluginId: string) => Promise<void>;
  starRepo: (repo: string, starred: boolean) => Promise<void>;
  logout: () => Promise<void>;
}
const Context = createContext<LauncherStore | null>(null);
const initialSkin = (): Skin => {
  try {
    const saved = JSON.parse(stored(localStorage, "eacAppearance") || "{}") as { skin?: string };
    return saved.skin === "standard" ? "standard" : "pixel";
  } catch { return "pixel"; }
};
const initialCustomAvatar = (): string | null => {
  try {
    const value = stored(localStorage, "eacCustomAvatar");
    return value && value.startsWith("data:image/") && value.length < 2_000_000 ? value : null;
  } catch { return null; }
};
const initialPetScale = (): number => {
  try {
    const saved = JSON.parse(stored(localStorage, "eacAppearance") || "{}") as { petScale?: number };
    const value = Number(saved.petScale);
    return Number.isFinite(value) ? Math.min(2, Math.max(.5, value)) : .9;
  } catch { return .9; }
};
// 大厅服务器：本机外观偏好的一部分；空字符串表示明确关闭，未写过时用官方默认。
const DEFAULT_HALL = "http://144.126.133.165:4317";
const initialHallUrl = (): string => {
  try {
    const saved = JSON.parse(stored(localStorage, "eacAppearance") || "{}") as { hallUrl?: unknown };
    return typeof saved.hallUrl === "string" ? saved.hallUrl : DEFAULT_HALL;
  } catch { return DEFAULT_HALL; }
};
function localAppearance(): Settings {
  let saved: Partial<Settings> = {};
  try { saved = JSON.parse(stored(localStorage, "eacAppearance") || "{}") as Partial<Settings>; } catch { /* Use the system preference. */ }
  return {
    theme: ["light", "dark", "system"].includes(saved.theme ?? "") ? saved.theme as Theme : "system",
    reducedMotion: saved.reducedMotion === true,
    githubClientId: typeof saved.githubClientId === "string" ? saved.githubClientId : "",
  };
}
function checkCatalog(value: Catalog): Catalog {
  if (!value || !Array.isArray(value.sources) || !Array.isArray(value.plugins) || !Array.isArray(value.packs)) {
    throw new Error("The catalog is not in the launcher contract format.");
  }
  return value;
}
export function LauncherProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [online, setOnline] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [connectionError, setConnectionError] = useState("");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogOrigin, setCatalogOrigin] = useState<LauncherStore["catalogOrigin"]>(null);
  const [catalogError, setCatalogError] = useState("");
  const [social, setSocial] = useState<SocialStatus | null>(null);
  const [achievements, setAchievements] = useState<AchievementView | null>(null);
  const [achievementSummary, setAchievementSummary] = useState<AchievementSummary | null>(null);
  const [starredRepos, setStarredRepos] = useState<Set<string>>(new Set());
  const [customAvatar, setCustomAvatarState] = useState<string | null>(initialCustomAvatar);
  const [settings, setSettings] = useState<Settings>(localAppearance);
  const [skin, setSkinState] = useState<Skin>(initialSkin);
  const [petScale, setPetScaleState] = useState<number>(initialPetScale);
  const [hallUrl, setHallUrlState] = useState<string>(initialHallUrl);
  const [debug, setDebugState] = useState<boolean>(() => {
    try { return JSON.parse(stored(localStorage, "eacAppearance") || "{}").debug === true; } catch { return false; }
  });
  const [pending, setPending] = useState<Pending[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const serial = useRef(0);
  const mutationRevision = useRef(0);
  const epoch = useRef(0);
  const poll = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const onlineRef = useRef(false);
  const knownUnlocked = useRef<Set<string>>(new Set());
  const unlockInitialized = useRef(false);
  const achievementDefs = useRef<AchievementDefinition[]>([]);
  const apply = useCallback((next: Snapshot) => {
    checkSnapshot(next);
    setSnapshot(next);
    setSettings(next.settings);
    persist(localStorage, "eacAppearance", JSON.stringify({ ...next.settings, skin, petScale, hallUrl, debug }));
    if (next.social) {
      setSocial((current) => ({
        authenticated: next.social!.authenticated,
        profile: next.social!.profile,
        likedPlugins: next.social!.likedPlugins,
        starOk: next.social!.starOk ?? current?.starOk ?? null,
        clientConfigured: next.social!.clientConfigured ?? current?.clientConfigured ?? false,
        scopes: current?.scopes ?? null,
      }));
    }
    if (next.achievements) setAchievementSummary(next.achievements);
    setOnline(true);
    onlineRef.current = true;
    setConnectionError("");
  }, [skin, petScale, hallUrl, debug]);
  const notify = useCallback((message: string, tone: Notice["tone"] = "info") => {
    const id = ++serial.current;
    setNotices((items) => [...items.slice(-3), { id, message, tone }]);
    if (tone === "achievement") {
      window.setTimeout(() => setNotices((items) => items.filter((item) => item.id !== id)), 7000);
    }
  }, []);
  const dismiss = useCallback((id: number) => setNotices((items) => items.filter((item) => item.id !== id)), []);
  const refresh = useCallback(async () => {
    if (poll.current) return poll.current;
    const currentEpoch = epoch.current;
    const revision = mutationRevision.current;
    const request = (async () => {
      try {
        const next = await call<Snapshot>("snapshot");
        if (mounted.current && currentEpoch === epoch.current && revision === mutationRevision.current) apply(next);
      } catch (error) {
        if (mounted.current && currentEpoch === epoch.current && revision === mutationRevision.current) {
          setOnline(false);
          onlineRef.current = false;
          setConnectionError(errorText(error));
        }
      } finally {
        if (mounted.current && currentEpoch === epoch.current) setConnecting(false);
      }
    })();
    poll.current = request;
    try { await request; } finally { if (poll.current === request) poll.current = null; }
  }, [apply]);
  const refreshCatalog = useCallback(async () => {
    const currentEpoch = epoch.current;
    try {
      const next = checkCatalog(await call<Catalog>("catalog"));
      if (!mounted.current || currentEpoch !== epoch.current) return;
      setCatalog(next);
      setCatalogOrigin("backend");
      setCatalogError("");
    } catch {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}catalog.json`, { cache: "no-cache", signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next = checkCatalog(await response.json() as Catalog);
        if (!mounted.current || currentEpoch !== epoch.current) return;
        setCatalog(next);
        setCatalogOrigin("bundled");
        setCatalogError("");
      } catch {
        if (!mounted.current || currentEpoch !== epoch.current) return;
        setCatalogError("The catalog is unavailable. Connect to Rust or add the shipped /catalog.json to browse.");
      }
    }
  }, []);
  const refreshSocial = useCallback(async () => {
    try {
      const next = await call<SocialStatus>("github_status");
      if (!mounted.current) return;
      setSocial(next);
      if (next.authenticated) {
        try {
          const stars = await call<{ repos: string[] }>("github_starred");
          if (mounted.current) setStarredRepos(new Set(stars.repos.map((repo) => repo.toLowerCase())));
        } catch { /* The star list is optional; login state still stands. */ }
      } else {
        setStarredRepos(new Set());
      }
    } catch { /* Keep the last known social state while offline. */ }
  }, []);
  const refreshAchievements = useCallback(async () => {
    try {
      const next = await call<AchievementView>("achievements");
      if (!mounted.current) return;
      setAchievements(next);
      setAchievementSummary(next.summary);
      achievementDefs.current = next.definitions;
    } catch { /* Achievements remain viewable from the last snapshot. */ }
  }, []);
  const reconnect = useCallback(async () => {
    epoch.current += 1;
    poll.current = null;
    setConnecting(true);
    setOnline(false);
    onlineRef.current = false;
    setSnapshot(null);
    await Promise.allSettled([refresh(), refreshCatalog(), refreshSocial(), refreshAchievements()]);
  }, [refresh, refreshCatalog, refreshSocial, refreshAchievements]);
  const run = useCallback(async <T,>(action: string, payload: JsonPayload, label: string, snapshotResult = true): Promise<T> => {
    if (!onlineRef.current) throw new Error("Connect to the Rust backend to perform this action.");
    const id = ++serial.current;
    const currentEpoch = epoch.current;
    setPending((items) => [...items, { id, action, label, instanceId: (payload.instanceId ?? payload.id) as string | undefined }]);
    try {
      const result = await call<T>(action, payload);
      if (currentEpoch !== epoch.current) throw new Error("The connection changed while the operation was running. Refresh to inspect its result.");
      if (snapshotResult) {
        mutationRevision.current += 1;
        apply(result as Snapshot);
      }
      return result;
    } catch (error) {
      notify(errorText(error), "error");
      void refresh();
      throw error;
    } finally {
      setPending((items) => items.filter((item) => item.id !== id));
    }
  }, [apply, notify, refresh]);
  const recordEvent = useCallback(async (event: string, value?: string) => {
    if (!onlineRef.current) return;
    try {
      await call("record_event", { event, ...(value ? { value } : {}) });
      void refreshAchievements();
    } catch { /* Achievements are best-effort and never block the main action. */ }
  }, [refreshAchievements]);
  const likePlugin = useCallback(async (pluginId: string, liked: boolean) => {
    const result = await call<{ liked: boolean; likes: number; newlyUnlocked: string[] }>("market_like", { pluginId, liked });
    setSocial((current) => current ? {
      ...current,
      likedPlugins: liked
        ? [...new Set([...current.likedPlugins, pluginId])]
        : current.likedPlugins.filter((id) => id !== pluginId),
    } : current);
    if (result.newlyUnlocked?.length) void refreshAchievements();
    return result;
  }, [refreshAchievements]);
  const downloadPlugin = useCallback(async (pluginId: string) => {
    try {
      const result = await call<{ newlyUnlocked: string[] }>("market_download", { pluginId });
      if (result.newlyUnlocked?.length) void refreshAchievements();
    } catch { /* Local download stats are supplementary to the real install result. */ }
  }, [refreshAchievements]);
  const starRepo = useCallback(async (repo: string, starred: boolean) => {
    const result = await call<{ starred: boolean; newlyUnlocked: string[] }>("github_star", { repo, starred });
    setStarredRepos((current) => {
      const next = new Set(current);
      const key = repo.toLowerCase();
      if (starred) next.add(key); else next.delete(key);
      return next;
    });
    if (result.newlyUnlocked?.length) void refreshAchievements();
  }, [refreshAchievements]);
  const logout = useCallback(async () => {
    await call("github_logout");
    setSocial((current) => ({
      authenticated: false,
      profile: null,
      scopes: null,
      likedPlugins: [],
      clientConfigured: current?.clientConfigured ?? false,
    }));
    setStarredRepos(new Set());
  }, []);
  const saveAppearance = useCallback(async (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    persist(localStorage, "eacAppearance", JSON.stringify({ ...next, skin, petScale, hallUrl, debug }));
    if (onlineRef.current) {
      try { await run("save_settings", patch, "Saving appearance"); }
      catch { notify("Appearance is stored locally; the backend setting could not be saved.", "info"); }
    }
  }, [run, settings, skin, petScale, hallUrl, debug, notify]);
  const setSkin = useCallback((next: Skin) => {
    setSkinState(next);
    persist(localStorage, "eacAppearance", JSON.stringify({ ...settings, skin: next, petScale, hallUrl, debug }));
  }, [settings, petScale, hallUrl, debug]);
  const setPetScale = useCallback((scale: number) => {
    const next = Math.min(2, Math.max(.5, Number(scale) || .9));
    setPetScaleState(next);
    persist(localStorage, "eacAppearance", JSON.stringify({ ...settings, skin, petScale: next, hallUrl, debug }));
  }, [settings, skin, hallUrl, debug]);
  const setHallUrl = useCallback((url: string) => {
    setHallUrlState(url);
    persist(localStorage, "eacAppearance", JSON.stringify({ ...settings, skin, petScale, hallUrl: url, debug }));
  }, [settings, skin, petScale, debug]);
  const setDebug = useCallback((on: boolean) => {
    setDebugState(on);
    persist(localStorage, "eacAppearance", JSON.stringify({ ...settings, skin, petScale, hallUrl, debug: on }));
  }, [settings, skin, petScale, hallUrl]);
  const setCustomAvatar = useCallback((value: string | null) => {
    if (value && (!value.startsWith("data:image/") || value.length >= 2_000_000)) return;
    setCustomAvatarState(value);
    if (value) persist(localStorage, "eacCustomAvatar", value);
    else { try { localStorage.removeItem("eacCustomAvatar"); } catch { /* Storage may be disabled. */ } }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    void refreshCatalog();
    void refreshSocial();
    void refreshAchievements();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 3000);
    return () => { mounted.current = false; window.clearInterval(interval); };
  }, [refresh, refreshCatalog, refreshSocial, refreshAchievements]);
  const wasOnline = useRef(false);
  useEffect(() => {
    if (online && !wasOnline.current) {
      void refreshCatalog();
      void refreshSocial();
      void refreshAchievements();
    }
    wasOnline.current = online;
  }, [online, refreshCatalog, refreshSocial, refreshAchievements]);
  useEffect(() => {
    const unlocked = snapshot?.achievements?.unlocked;
    if (!unlocked) return;
    const ids = Object.keys(unlocked);
    if (!unlockInitialized.current) {
      ids.forEach((id) => knownUnlocked.current.add(id));
      unlockInitialized.current = true;
      return;
    }
    const fresh = ids.filter((id) => !knownUnlocked.current.has(id));
    if (!fresh.length) return;
    fresh.forEach((id) => knownUnlocked.current.add(id));
    for (const id of fresh) {
      const definition = achievementDefs.current.find((item) => item.id === id);
      notify(`成就解锁 · ${definition?.name ?? id}`, "achievement");
    }
    void refreshAchievements();
  }, [snapshot?.achievements?.unlocked, notify, refreshAchievements]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const dark = settings.theme === "dark" || (settings.theme === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      document.documentElement.dataset.motion = settings.reducedMotion ? "reduced" : "full";
      document.documentElement.dataset.skin = skin;
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", skin === "pixel" ? (dark ? "#06172b" : "#3d87f7") : (dark ? "#101823" : "#f4f7fb"));
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [settings, skin]);
  return <Context.Provider value={{
    snapshot, online, connecting, connectionError, catalog, catalogOrigin, catalogError,
    settings, skin, setSkin, petScale, setPetScale, hallUrl, setHallUrl, debug, setDebug, pending, notices,
    social, achievements, achievementSummary, starredRepos, customAvatar, setCustomAvatar,
    refresh, refreshCatalog, refreshSocial, refreshAchievements, reconnect, run, notify, dismiss, saveAppearance,
    recordEvent, likePlugin, downloadPlugin, starRepo, logout,
  }}>{children}</Context.Provider>;
}
export function useLauncher() {
  const value = useContext(Context);
  if (!value) throw new Error("LauncherProvider is missing.");
  return value;
}
