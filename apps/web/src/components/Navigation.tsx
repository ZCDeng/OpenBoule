import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../stores/auth.ts";
import { useTheme, type ThemePref } from "../stores/theme.ts";
import { Badge } from "./Brutalist.tsx";

const NAV = [
  { to: "/projects", label: "项目", k: "PROJECTS" },
  { to: "/methodology", label: "方法论", k: "METHOD" },
  { to: "/settings", label: "配置", k: "CONFIG" },
];

const THEME_META: Record<ThemePref, { glyph: string; label: string }> = {
  system: { glyph: "◐", label: "跟随系统" },
  light: { glyph: "○", label: "亮色" },
  dark: { glyph: "●", label: "暗色" },
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
      className="flex items-center gap-2 rounded-[var(--surface-radius-sm)] border border-[var(--hairline-strong)] px-3 py-1.5 font-[var(--boule-mono)] text-[11px] uppercase tracking-[0.12em] transition-colors hover:bg-[var(--surface-bg-raise)]"
    >
      <span aria-hidden className="text-[13px] leading-none text-[var(--boule-blue)]">{meta.glyph}</span>
      <span className="hidden lg:inline">{meta.label}</span>
    </button>
  );
}

export function Navigation() {
  const loc = useLocation();
  const logout = useAuth((s) => s.logout);
  const [open, setOpen] = useState(false);
  return (
    <nav className="sticky top-0 z-50 border-b border-[var(--hairline-strong)] bg-[var(--boule-paper)]">
      <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-6 px-6 md:px-10">
        <Link to="/projects" onClick={() => setOpen(false)} className="flex items-baseline gap-3">
          <span className="font-[var(--boule-disp)] text-[22px] font-black tracking-[-0.02em]">OpenConsult<span className="text-[var(--boule-blue)]">///</span></span>
          <span className="rounded-[var(--surface-radius-sm)] border border-[var(--hairline-strong)] px-2 py-0.5 font-[var(--boule-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--boule-muted)]">BOULE</span>
        </Link>
        <div className="hidden items-center gap-2 md:flex">
          {NAV.map((n) => {
            const active = loc.pathname.startsWith(n.to);
            return (
              <Link key={n.to} to={n.to} aria-current={active ? "page" : undefined} className={`rounded-[var(--surface-radius-sm)] border px-3 py-1.5 font-[var(--boule-mono)] text-[11px] uppercase tracking-[0.1em] transition-colors ${active ? "border-[var(--boule-blue)] bg-[var(--boule-blue)] text-white" : "border-[var(--hairline-strong)] hover:bg-[var(--surface-bg-raise)]"}`}>
                {n.label}<span className="ml-2 hidden text-[9px] opacity-60 lg:inline">{n.k}</span>
              </Link>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
          <span className="hidden sm:block"><Badge tone="orange">Claude专用</Badge></span>
          <button onClick={logout} className="hidden rounded-[var(--surface-radius-sm)] border border-[var(--hairline-strong)] px-4 py-1.5 font-[var(--boule-mono)] text-[11px] uppercase tracking-[0.12em] transition-colors hover:bg-[var(--surface-bg-raise)] md:block">
            登出
          </button>
          <button
            type="button"
            aria-label={open ? "关闭菜单" : "打开菜单"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
            className="rounded-[var(--surface-radius-sm)] border border-[var(--hairline-strong)] px-3 py-1.5 font-[var(--boule-mono)] text-[12px] uppercase tracking-[0.12em] transition-colors hover:bg-[var(--surface-bg-raise)] md:hidden"
          >
            {open ? "✕ 关闭" : "≡ 菜单"}
          </button>
        </div>
      </div>
      {open && (
        <div id="mobile-nav" className="border-t border-[var(--hairline-strong)] bg-[var(--boule-paper)] md:hidden">
          {NAV.map((n) => {
            const active = loc.pathname.startsWith(n.to);
            return (
              <Link key={n.to} to={n.to} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined} className={`block border-b border-[var(--hairline-color)] px-6 py-4 font-[var(--boule-mono)] text-[12px] uppercase tracking-[0.1em] ${active ? "bg-[var(--boule-blue)] text-white" : "hover:bg-[var(--surface-bg-raise)]"}`}>
                {n.label}<span className="ml-2 text-[9px] opacity-60">{n.k}</span>
              </Link>
            );
          })}
          <button onClick={() => { setOpen(false); logout(); }} className="block w-full border-b border-[var(--hairline-color)] px-6 py-4 text-left font-[var(--boule-mono)] text-[12px] uppercase tracking-[0.12em] hover:bg-[var(--surface-bg-raise)]">
            登出
          </button>
        </div>
      )}
    </nav>
  );
}
