/**
 * Material3 Navigation Rail（宽屏左侧导航）。80dp 宽，每项 = 图标(active 时药丸指示条) + 小标签。
 * 仅 lg+ 显示；窄屏仍用顶栏 Navigation 的链接 / 汉堡菜单。固定在顶栏下方。
 */
import { Link, useLocation } from "react-router-dom";
import { Icon } from "./Icon.tsx";

const RAIL = [
  { to: "/projects", label: "项目", icon: "folder" },
  { to: "/files", label: "文件管理", icon: "inventory_2" },
  { to: "/settings", label: "配置", icon: "settings" },
];

export function NavigationRail() {
  const loc = useLocation();
  return (
    <nav className="boule-rail" aria-label="主导航">
      {RAIL.map((r) => {
        const active = loc.pathname.startsWith(r.to);
        return (
          <Link key={r.to} to={r.to} aria-current={active ? "page" : undefined} className={`boule-rail__item${active ? " boule-rail__item--active" : ""}`}>
            <span className="boule-rail__indicator"><Icon name={r.icon} size={24} /></span>
            <span className="boule-rail__label">{r.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
