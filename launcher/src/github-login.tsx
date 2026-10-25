import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowRight, Check, Copy, ExternalLink, Github, KeyRound, LoaderCircle, LogOut,
  RefreshCw, ShieldCheck, Smartphone, TriangleAlert,
} from "lucide-react";
import { call, errorText, native } from "./api";
import { Badge, Button, External as ExternalAnchor, Field, FormError, Modal } from "./components";
import { useLauncher } from "./store";
import type { SocialProfile } from "./types";

interface DeviceFlow {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}
interface PollResult {
  status: "pending" | "authorized" | "expired" | "denied";
  interval?: number;
  profile?: SocialProfile;
  scopes?: string[];
  newlyUnlocked?: string[];
}
interface TokenResult {
  status: "authorized";
  profile: SocialProfile;
  scopes: string[];
  newlyUnlocked?: string[];
}

function openExternal(url: string) {
  if (native) return call("open_url", { url }).catch(() => undefined);
  window.open(url, "_blank", "noopener,noreferrer");
  return Promise.resolve();
}

export function GitHubLoginDialog({ close }: { close: () => void }) {
  const { social, settings, run, refreshSocial, refreshAchievements, logout, notify } = useLauncher();
  const [tab, setTab] = useState<"device" | "token">("device");
  const [clientId, setClientId] = useState(settings.githubClientId || "");
  const [phase, setPhase] = useState<"idle" | "starting" | "waiting" | "authorized">("idle");
  const [flow, setFlow] = useState<DeviceFlow | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [savedClient, setSavedClient] = useState(false);
  const closeRef = useRef(close);
  closeRef.current = close;
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  useEffect(() => {
    if (phase !== "waiting" || !flow) return;
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      try {
        const result = await call<PollResult>("github_login_poll");
        if (cancelled) return;
        if (result.status === "authorized") {
          setPhase("authorized");
          await refreshSocial();
          await refreshAchievements();
          notify(`已登录 GitHub：${result.profile?.login ?? ""}`, "success");
          timer = window.setTimeout(() => closeRef.current(), 1100);
          return;
        }
        if (result.status === "expired") {
          setPhase("idle");
          setFlow(null);
          setError("授权码已过期，请重新发起登录。");
          return;
        }
        if (result.status === "denied") {
          setPhase("idle");
          setFlow(null);
          setError("你在 GitHub 上取消了这次授权。");
          return;
        }
        timer = window.setTimeout(tick, Math.max(2, result.interval ?? flow.interval) * 1000);
      } catch (reason) {
        if (!cancelled) {
          setPhase("idle");
          setError(errorText(reason));
        }
      }
    };
    timer = window.setTimeout(tick, Math.max(2, flow.interval) * 1000);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [phase, flow, notify, refreshSocial, refreshAchievements]);

  const saveClient = async () => {
    const value = clientId.trim();
    if (!/^[A-Za-z0-9._-]{6,100}$/.test(value)) {
      setError("Client ID 格式不正确。它通常以 Iv1. 或 Ov23 开头。");
      return false;
    }
    setBusy(true);
    setError("");
    try {
      await run("save_settings", { githubClientId: value }, "保存 GitHub Client ID");
      await refreshSocial();
      setSavedClient(true);
      notify("GitHub Client ID 已保存。", "success");
      return true;
    } catch (reason) {
      setError(errorText(reason));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    setError("");
    setPhase("starting");
    try {
      if (!social?.clientConfigured && clientId.trim() !== settings.githubClientId) {
        const saved = await saveClient();
        if (!saved) { setPhase("idle"); return; }
      }
      const result = await call<DeviceFlow>("github_login_start");
      setFlow(result);
      setPhase("waiting");
      void openExternal(result.verificationUri);
    } catch (reason) {
      setPhase("idle");
      setError(errorText(reason));
    }
  };

  const copyCode = () => {
    if (!flow) return;
    void navigator.clipboard.writeText(flow.userCode).then(() => {
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1800);
    }).catch(() => notify("浏览器未允许访问剪贴板。", "error"));
  };

  const submitToken = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await call<TokenResult>("github_login_token", { token: token.trim() });
      await refreshSocial();
      await refreshAchievements();
      notify(`已登录 GitHub：${result.profile.login}`, "success");
      closeRef.current();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const refreshAccount = async () => {
    setRefreshing(true);
    setError("");
    try {
      await call("github_refresh");
      await refreshSocial();
      notify("GitHub 授权状态已刷新。", "success");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setRefreshing(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await logout();
      notify("已退出 GitHub 账号。", "info");
      closeRef.current();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const profile = social?.profile;
  if (social?.authenticated && profile) {
    const scopes = social.scopes ?? [];
    // starOk 由引擎登录后探测 GET /user/starred 得出，对细粒度令牌也准确；
    // 探测不可用时退回作用域判断（经典令牌）。
    const starState: "ok" | "missing" | "unknown" =
      social.starOk === true ? "ok"
      : social.starOk === false ? "missing"
      : scopes.includes("public_repo") || scopes.includes("repo") ? "ok"
      : scopes.length > 0 ? "missing"
      : "unknown";
    return <Modal title="GitHub 账号" subtitle="登录状态、授权范围与本机凭据。" onClose={close} busy={busy}>
      <div className="modal-body github-account-panel">
        <div className="github-profile-card">
          <span className="github-profile-avatar"><img src={profile.avatarUrl} alt="" referrerPolicy="no-referrer" /></span>
          <div className="github-profile-copy">
            <span className="eyebrow">GITHUB / CONNECTED</span>
            <h3>{profile.name || profile.login}</h3>
            <p>@{profile.login}</p>
            {profile.bio && <p className="github-bio">{profile.bio}</p>}
          </div>
          <Badge tone="cyan">已连接</Badge>
        </div>
        <div className="github-scope-list">
          <div><ShieldCheck size={15} /><span>读取公开资料</span><Badge>{scopes.includes("read:user") || scopes.length === 0 ? "read:user" : "已授权"}</Badge></div>
          <div className={starState === "missing" ? "is-warning" : ""}>
            {starState === "ok" ? <Check size={15} /> : <TriangleAlert size={15} />}
            <span>在启动器内 Star 项目</span>
            <Badge tone={starState === "ok" ? "cyan" : starState === "missing" ? "coral" : "yellow"}>
              {starState === "ok" ? (social.starOk === true ? "Starring 权限" : "public_repo") : starState === "missing" ? "缺少 Star 权限" : "权限未确认"}
            </Badge>
          </div>
        </div>
        {starState === "missing" && <div className="github-warning"><TriangleAlert size={16} /><p>当前令牌不能 Star。请换一个带 <code>public_repo</code> 的经典令牌，或创建细粒度令牌并勾选 Account permissions → <code>Starring (read/write)</code>。</p></div>}
        {starState === "unknown" && <div className="github-security-note"><ShieldCheck size={15} /><p>该令牌未报告权限明细。若 Star 失败，请重新创建令牌并勾选 <code>Starring (read/write)</code>（细粒度）或 <code>public_repo</code>（经典）。</p></div>}
        <div className="github-security-note"><KeyRound size={15} /><p>令牌只保存在启动器数据目录的 <code>github.json</code>，不会写入快照、日志或大厅请求。</p></div>
        <FormError error={error} />
      </div>
      <div className="modal-footer">
        <Button onClick={close} disabled={busy}>关闭</Button>
        <div className="inline-actions">
          <Button icon={RefreshCw} busy={refreshing} onClick={() => void refreshAccount()} disabled={busy}>重新验证</Button>
          <Button variant="danger" icon={LogOut} busy={busy} onClick={() => void signOut()}>退出登录</Button>
        </div>
      </div>
    </Modal>;
  }

  return <Modal title="登录 GitHub" subtitle="点赞、Star 与成就都会记在这个账号上。" onClose={close} busy={phase === "waiting" || busy}>
    <div className="modal-body github-login">
      <div className="login-tabs segmented" role="tablist" aria-label="登录方式">
        <button type="button" role="tab" aria-selected={tab === "device"} className={tab === "device" ? "active" : ""} onClick={() => { setTab("device"); setError(""); }}><Smartphone size={14} />浏览器授权</button>
        <button type="button" role="tab" aria-selected={tab === "token"} className={tab === "token" ? "active" : ""} onClick={() => { setTab("token"); setError(""); }}><KeyRound size={14} />访问令牌</button>
      </div>
      {tab === "device" ? <>
        {!social?.clientConfigured && <div className="github-setup">
          <div className="github-setup-heading"><Github size={18} /><div><strong>首次使用：配置 OAuth App</strong><span>只需要做一次。Client ID 是公开信息，不是密钥。</span></div></div>
          <ol>
            <li>打开 GitHub 的 <ExternalAnchor href="https://github.com/settings/developers">Developer settings → OAuth Apps</ExternalAnchor>，新建一个 OAuth App。</li>
            <li>在应用设置里勾选 <code>Enable Device Flow</code>。</li>
            <li>把应用页上的 <code>Client ID</code> 填到下面。</li>
          </ol>
          <div className="github-client-row">
            <input aria-label="GitHub OAuth Client ID" value={clientId} onChange={(event) => { setClientId(event.target.value); setSavedClient(false); }} placeholder="Iv1.xxxxxxxxxxxxxxxx" spellCheck={false} />
            <Button icon={savedClient ? Check : ArrowRight} busy={busy} onClick={() => void saveClient()} disabled={!clientId.trim()}>{savedClient ? "已保存" : "保存"}</Button>
          </div>
          <small>发布构建时设置 <code>EAC_GITHUB_CLIENT_ID</code> 会把 Client ID 编译进程序；运行时环境变量优先于此处保存的值。</small>
        </div>}
        {phase === "waiting" && flow ? <div className="device-flow" aria-live="polite">
          <span className="device-flow-eyebrow">DEVICE AUTHORIZATION</span>
          <p>在 GitHub 页面输入下面的代码：</p>
          <div className="device-code">
            <span>{flow.userCode}</span>
            <button type="button" className="device-copy" onClick={copyCode} aria-label={copied ? "已复制授权码" : "复制授权码"}>{copied ? <Check size={16} /> : <Copy size={16} />}</button>
          </div>
          <div className="device-flow-actions">
            <Button variant="primary" icon={ExternalLink} onClick={() => void openExternal(flow.verificationUri)}>打开 GitHub 授权页</Button>
            <span className="device-flow-status"><LoaderCircle size={14} className="spin" />等待确认</span>
          </div>
          <small>代码 {Math.max(1, Math.round(flow.expiresIn / 60))} 分钟内有效。授权完成后这里会自动关闭。</small>
        </div> : phase === "authorized" ? <div className="github-authorized"><span><Check size={20} /></span><div><strong>授权成功</strong><p>正在同步账号资料与成就…</p></div></div> : <div className="github-device-intro">
          <span className="github-device-mark"><Github size={30} /></span>
          <h3>用浏览器完成一次设备授权</h3>
          <p>启动器会显示一个一次性代码，你在 GitHub 上确认后即可登录。不需要把密码交给启动器，也不需要配置回调地址。</p>
          <div className="github-permissions"><span><Check size={13} />读取公开资料</span><span><Check size={13} />Star 公开项目</span><span><Check size={13} />点赞插件</span></div>
        </div>}
        {phase !== "waiting" && phase !== "authorized" && <Button variant="primary" icon={ArrowRight} busy={phase === "starting"} onClick={() => void start()} disabled={busy || (!social?.clientConfigured && !clientId.trim())}>{phase === "starting" ? "正在向 GitHub 申请代码…" : "生成一次性授权码"}</Button>}
      </> : <form onSubmit={(event) => void submitToken(event)}>
        <div className="github-token-intro">
          <span className="github-device-mark"><KeyRound size={26} /></span>
          <h3>使用经典访问令牌</h3>
          <p>两种令牌都可以：<br />经典令牌需要 <code>read:user</code> + <code>public_repo</code>；<br />细粒度令牌（<code>github_pat_</code> 开头）只需 Account permissions 里的 <code>Profile (read)</code> + <code>Starring (read/write)</code>，权限更小。</p>
        </div>
        <Field label="GitHub 访问令牌" required hint="只保存在本机启动器数据目录；不会发送给插件市场或大厅。">
          <input aria-label="GitHub 访问令牌" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="ghp_… 或 github_pat_…" autoComplete="off" spellCheck={false} required />
        </Field>
        <div className="github-token-links"><ExternalAnchor href="https://github.com/settings/tokens/new?scopes=read:user,public_repo&description=EAC%20Launcher">在 GitHub 创建带这两个权限的令牌</ExternalAnchor></div>
        <div className="github-security-note"><ShieldCheck size={15} /><p>登录后可在个人中心随时刷新授权或退出。启动器不会读取你的私有仓库。</p></div>
        <FormError error={error} />
        <div className="github-token-submit"><Button type="submit" variant="primary" icon={Github} busy={busy} disabled={!token.trim()}>登录</Button></div>
      </form>}
      {tab === "device" && <FormError error={error} />}
    </div>
    <div className="modal-footer"><Button onClick={close} disabled={phase === "waiting" || busy}>取消</Button></div>
  </Modal>;
}
