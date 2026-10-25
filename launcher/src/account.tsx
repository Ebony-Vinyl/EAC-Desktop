import { useEffect, useRef, useState } from "react";
import { ChevronUp, ExternalLink, Flame, Github, LogOut, MoreHorizontal, RefreshCw, Trophy, UserRound } from "lucide-react";
import { call, errorText, GITHUB_LOGIN_ENABLED, native, safeUrl } from "./api";
import { useLauncher } from "./store";
import type { View } from "./types";

export function AccountDock({ onLogin, onNavigate }: { onLogin: () => void; onNavigate: (view: View) => void }) {
  const { social, achievementSummary, customAvatar, logout, notify } = useLauncher();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const pointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", pointer);
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("mousedown", pointer);
      document.removeEventListener("keydown", keydown);
    };
  }, [open]);
  const profile = social?.profile;
  const openProfile = () => {
    const url = safeUrl(profile?.htmlUrl);
    if (!url) return;
    if (native) void call("open_url", { url }).catch((reason: unknown) => notify(errorText(reason), "error"));
    else window.open(url, "_blank", "noopener,noreferrer");
  };
  const signOut = () => {
    setOpen(false);
    void logout().then(() => notify("已退出 GitHub 账号。", "info")).catch((reason: unknown) => notify(errorText(reason), "error"));
  };
  if (!GITHUB_LOGIN_ENABLED) {
    // 登录关闭期间固定显示「开发中」占位，不暴露任何已存在的登录态。
    return <div className="account-login account-dev" aria-label="GitHub 登录功能开发中">
      <span className="account-github-mark"><Github size={17} /></span>
      <span className="account-login-copy"><strong>GitHub 登录</strong><small>功能开发中 · 暂未开放</small></span>
      <span className="account-dev-badge">DEV</span>
    </div>;
  }
  if (!social?.authenticated || !profile) {
    return <button type="button" className="account-login" onClick={onLogin}>
      <span className="account-github-mark"><Github size={17} /></span>
      <span className="account-login-copy"><strong>登录 GitHub</strong><small>点赞 · Star · 记录成就</small></span>
      <span className="account-login-arrow">→</span>
    </button>;
  }
  const initial = (profile.name || profile.login).trim().slice(0, 1).toUpperCase() || "G";
  const avatar = customAvatar || profile.avatarUrl;
  return <div className="account-dock" ref={rootRef}>
    <div className={`account-card ${open ? "is-open" : ""}`}>
      <button type="button" className="account-main" onClick={() => onNavigate("profile")} aria-label="打开个人中心">
        <span className="account-avatar">
          <img src={avatar} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} />
          <span className="account-avatar-fallback">{initial}</span>
          <i className="account-online" aria-hidden="true" />
        </span>
        <span className="account-copy">
          <strong>{profile.name || profile.login}</strong>
          <small>@{profile.login}</small>
        </span>
        {achievementSummary && achievementSummary.streak > 0
          ? <span className="account-streak" title={`连续 ${achievementSummary.streak} 天`}><Flame size={11} />{achievementSummary.streak}</span>
          : null}
      </button>
      <button type="button" className="account-menu-button" aria-label="账号菜单" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <MoreHorizontal size={15} className="account-more" />
        <ChevronUp size={12} className={`account-chevron ${open ? "is-open" : ""}`} />
      </button>
    </div>
    {open && <div className="account-menu" role="menu">
      <div className="account-menu-head">
        <span className="account-avatar account-avatar-large">
          <img src={avatar} alt="" referrerPolicy="no-referrer" />
          <span className="account-avatar-fallback">{initial}</span>
        </span>
        <div><strong>{profile.name || profile.login}</strong><small>@{profile.login}</small></div>
        {achievementSummary && <span className="account-points">{achievementSummary.points} PT</span>}
      </div>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onNavigate("profile"); }}><UserRound size={15} /><span>个人中心</span></button>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onNavigate("achievements"); }}><Trophy size={15} /><span>我的成就</span>{achievementSummary && <small>{achievementSummary.unlockedCount}/{achievementSummary.total}</small>}</button>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); openProfile(); }}><ExternalLink size={15} /><span>GitHub 主页</span></button>
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onLogin(); }}><RefreshCw size={15} /><span>账号与授权</span></button>
      <div className="menu-divider" />
      <button type="button" role="menuitem" className="account-signout" onClick={signOut}><LogOut size={15} /><span>退出登录</span></button>
    </div>}
  </div>;
}
