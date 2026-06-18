/**
 * Material 3 图标（Material Symbols Outlined，经 index.html 的 Google Fonts 加载）。
 * 用 ligature 名（如 "notifications" / "add" / "description"）。离线时降级为该词文本。
 */
export function Icon({ name, size = 20, className, style }: { name: string; size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <span
      className={`material-symbols-outlined${className ? " " + className : ""}`}
      style={{ fontSize: size, lineHeight: 1, width: size, height: size, overflow: "hidden", display: "inline-flex", alignItems: "center", justifyContent: "center", userSelect: "none", flex: "none", ...style }}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
