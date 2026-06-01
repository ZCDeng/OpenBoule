import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../stores/auth.ts";
import { Badge } from "./Brutalist.tsx";

const NAV = [
  { to: "/projects", label: "项目", k: "PROJECTS" },
  { to: "/methodology", label: "方法论", k: "METHOD" },
  { to: "/settings", label: "配置", k: "CONFIG" },
];

export function Navigation() {
  const loc = useLocation();
  const logout = useAuth((s) => s.logout);
  return (
    <nav className="sticky top-0 z-50 border-b-2 border-black bg-[var(--boule-paper)]">
      <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-6 px-10">
        <Link to="/projects" className="flex items-baseline gap-3">
          <span className="font-[var(--boule-disp)] text-[22px] font-black tracking-[-0.02em]">OpenConsult<span className="text-[var(--boule-blue)]">///</span></span>
          <span className="border border-black px-2 py-0.5 font-[var(--boule-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--boule-muted)]">BOULE</span>
        </Link>
        <div className="hidden items-center gap-2 md:flex">
          {NAV.map((n) => {
            const active = loc.pathname.startsWith(n.to);
            return (
              <Link key={n.to} to={n.to} className={`border-2 border-black px-3 py-2 font-[var(--boule-mono)] text-[11px] uppercase tracking-[0.1em] ${active ? "bg-[var(--boule-blue)] text-white" : "hover:bg-black hover:text-white"}`}>
                {n.label}<span className="ml-2 hidden text-[9px] opacity-60 lg:inline">{n.k}</span>
              </Link>
            );
          })}
        </div>
        <div className="ml-auto hidden sm:block"><Badge tone="orange">Claude专用</Badge></div>
        <button onClick={logout} className="border-2 border-black bg-black px-4 py-2 font-[var(--boule-mono)] text-[11px] uppercase tracking-[0.12em] text-white hover:bg-[var(--boule-paper)] hover:text-black">
          登出
        </button>
      </div>
    </nav>
  );
}
