import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../stores/auth.ts";

const NAV = [
  { to: "/projects", label: "项目" },
  { to: "/methodology", label: "方法论" },
];

export function Navigation() {
  const loc = useLocation();
  const logout = useAuth((s) => s.logout);
  return (
    <nav className="flex items-center gap-6 border-b border-neutral-200 bg-white px-6 py-3">
      <Link to="/projects" className="font-serif text-lg font-semibold">
        Boule
      </Link>
      <div className="flex gap-4 text-sm">
        {NAV.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            className={loc.pathname.startsWith(n.to) ? "text-neutral-900" : "text-neutral-500 hover:text-neutral-800"}
          >
            {n.label}
          </Link>
        ))}
      </div>
      <button onClick={logout} className="ml-auto text-sm text-neutral-500 hover:text-neutral-800">
        登出
      </button>
    </nav>
  );
}
