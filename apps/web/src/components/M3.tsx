/**
 * Material3 组件变体（Chip / FAB / Dialog / ConfirmDialog / SegmentedTabs）。
 * 走 index.css 的 --md-* token；明暗自动跟随。供工作台逐步替换 brutalist 原语。
 */
import { useEffect, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";

/** M3 Chip（assist/filter）。selected 走 secondary-container 填充。 */
export function Chip({ label, selected, tone, onClick }: { label: ReactNode; selected?: boolean; tone?: "neutral" | "primary" | "success" | "warning" | "error"; onClick?: () => void }) {
  const cls = ["boule-chip"];
  if (selected) cls.push("boule-chip--selected");
  if (tone && tone !== "neutral") cls.push(`boule-chip--${tone}`);
  if (onClick) cls.push("boule-chip--clickable");
  return (
    <span className={cls.join(" ")} onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}>
      {label}
    </span>
  );
}

/** M3 FAB（floating action button，extended）。primary 容器 + elevation + Material Symbols 图标。 */
export function Fab({ label, icon = "add", onClick, disabled }: { label: string; icon?: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="boule-fab" onClick={onClick} disabled={disabled} aria-label={label}>
      <Icon name={icon} size={22} className="boule-fab__icon" />
      <span className="boule-fab__label">{label}</span>
    </button>
  );
}

/** M3 Dialog（带 scrim 的模态）。ESC / 点遮罩关闭。 */
export function Dialog({ open, title, children, onClose, actions }: { open: boolean; title?: ReactNode; children: ReactNode; onClose: () => void; actions?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="boule-scrim" onClick={onClose} role="presentation">
      <div className="boule-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {title ? <div className="boule-dialog__title">{title}</div> : null}
        <div className="boule-dialog__body">{children}</div>
        {actions ? <div className="boule-dialog__actions">{actions}</div> : null}
      </div>
    </div>
  );
}

/** M3 分段 Tabs（带滑动指示条由 CSS 的下边框承担）。 */
export function SegmentedTabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="boule-seg-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`boule-seg-tab${value === t.id ? " boule-seg-tab--active" : ""}`} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
