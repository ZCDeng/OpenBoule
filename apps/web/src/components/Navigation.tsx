import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../stores/auth.ts";
import { useTheme, type ThemePref } from "../stores/theme.ts";
import { Badge } from "./Brutalist.tsx";
import { MessageCenterButton } from "./MessageCenter.tsx";
import { Icon } from "./Icon.tsx";

const NAV = [
  { to: "/projects", label: "项目" },
  { to: "/methodology", label: "方法论" },
  { to: "/settings", label: "配置" },
];

const THEME_META: Record<ThemePref, { icon: string; label: string }> = {
  system: { icon: "brightness_auto", label: "跟随系统" },
  light: { icon: "light_mode", label: "亮色" },
  dark: { icon: "dark_mode", label: "暗色" },
};

function ThemeToggle() {
  const pref = useTheme((s) => s.pref);
  const cycle = useTheme((s) => s.cycle);
  const meta = THEME_META[pref];
  return (
    <button
      type="button"
      onClick={cycle}
      title={`主题：${meta.label}（点击切换）`}
      aria-label={`主题：${meta.label}，点击切换`}
      className="flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium text-[var(--md-on-surface-variant)] transition-colors hover:bg-[var(--row-hover-bg)]"
    >
      <Icon name={meta.icon} size={18} className="text-[var(--md-primary)]" />
      <span className="hidden lg:inline">{meta.label}</span>
    </button>
  );
}

export function Navigation() {
  const loc = useLocation();
  const logout = useAuth((s) => s.logout);
  const [open, setOpen] = useState(false);
  return (
    <nav className="sticky top-0 z-50 bg-[var(--md-surface)]" style={{ boxShadow: "var(--md-elevation-1)" }}>
      <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-6 px-6 md:px-10">
        <Link to="/projects" onClick={() => setOpen(false)} className="flex items-baseline gap-2.5">
          <span className="font-[var(--boule-disp)] text-[20px] font-semibold tracking-[-0.01em] text-[var(--md-on-surface)]">OpenConsult<span className="text-[var(--md-primary)]">///</span></span>
          <span className="rounded-full bg-[var(--md-secondary-container)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--md-on-secondary-container)]">Boule</span>
        </Link>
        <div className="hidden items-center gap-1 md:flex lg:hidden">
          {NAV.map((n) => {
            const active = loc.pathname.startsWith(n.to);
            return (
              <Link key={n.to} to={n.to} aria-current={active ? "page" : undefined} className={`rounded-full px-4 py-2 text-[14px] font-medium transition-colors ${active ? "bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]" : "text-[var(--md-on-surface-variant)] hover:bg-[var(--row-hover-bg)]"}`}>
                {n.label}
              </Link>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <MessageCenterButton />
          <ThemeToggle />
          <span className="hidden sm:block"><Badge tone="orange">Claude 专用</Badge></span>
          <button onClick={logout} className="hidden rounded-full px-4 py-2 text-[14px] font-medium text-[var(--md-on-surface-variant)] transition-colors hover:bg-[var(--row-hover-bg)] md:block">
            登出
          </button>
          <button
            type="button"
            aria-label={open ? "关闭菜单" : "打开菜单"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center rounded-full px-3 py-2 text-[var(--md-on-surface-variant)] transition-colors hover:bg-[var(--row-hover-bg)] md:hidden"
          >
            <Icon name={open ? "close" : "menu"} size={22} />
          </button>
        </div>
      </div>
      {open && (
        <div id="mobile-nav" className="border-t border-[var(--md-outline-variant)] bg-[var(--md-surface)] md:hidden">
          {NAV.map((n) => {
            const active = loc.pathname.startsWith(n.to);
            return (
              <Link key={n.to} to={n.to} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined} className={`block px-6 py-4 text-[15px] font-medium ${active ? "bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]" : "text-[var(--md-on-surface-variant)] hover:bg-[var(--row-hover-bg)]"}`}>
                {n.label}
              </Link>
            );
          })}
          <button onClick={() => { setOpen(false); logout(); }} className="block w-full px-6 py-4 text-left text-[15px] font-medium text-[var(--md-on-surface-variant)] hover:bg-[var(--row-hover-bg)]">
            登出
          </button>
        </div>
      )}
    </nav>
  );
}
