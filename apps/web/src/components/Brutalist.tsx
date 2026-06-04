import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

/*
 * 颜色/字体单一真值源 = index.css :root 的 --boule-* CSS 变量（U2 收敛，KTD-1）。
 * 原先此处导出的 PAPER/INK/BLUE/… JS 常量与 CSS 变量重复且零消费者，已移除。
 * 组件薄壳一律走 .boule-* class / var(--boule-*)，不在 JS 里再抄一份色值。
 */

export function PageShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <div className={wide ? "boule-page boule-page--wide" : "boule-page"}>{children}</div>;
}

export function PageHeader({ eyebrow, title, children, action }: { eyebrow: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <header className="boule-page-header">
      <div className="boule-page-header__copy">
        <div className="boule-eyebrow">{eyebrow}</div>
        <h1 className="boule-title">{title}</h1>
        {children && <p className="boule-lede">{children}</p>}
      </div>
      {action && <div className="boule-page-header__action">{action}</div>}
    </header>
  );
}

export function Panel({ children, dark = false, className = "" }: { children: ReactNode; dark?: boolean; className?: string }) {
  return <section className={`${dark ? "boule-panel boule-panel--dark" : "boule-panel"} ${className}`}>{children}</section>;
}

export function PanelHeader({ k, title, children }: { k: string; title: string; children?: ReactNode }) {
  return (
    <div className="boule-panel-head">
      <span className="boule-eyebrow">{k}</span>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}

/** 徽章。plain/blue/orange/dark = 强调标签；running/attention/done/failed/draft = 状态点芯片
 *  （CSS 自动出 8px 状态点色，见 index.css；语义经 lib/labels.ts，不直出枚举码）。 */
export type BadgeTone = "plain" | "blue" | "orange" | "dark" | "running" | "attention" | "done" | "failed" | "draft";
export function Badge({ children, tone = "plain" }: { children: ReactNode; tone?: BadgeTone }) {
  return <span className={`boule-badge boule-badge--${tone}`}>{children}</span>;
}

export function Button({ children, variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  return <button className={`boule-btn boule-btn--${variant} ${className}`} {...props}>{children}</button>;
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`boule-input ${props.className ?? ""}`} />;
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`boule-input ${props.className ?? ""}`} />;
}

/** 行内提示条（替代各处手抄的橙/红警告块）。tone: warn=橙(默认) / danger=红 / info=墨。 */
export function Banner({ children, tone = "warn", action }: { children: ReactNode; tone?: "warn" | "danger" | "info"; action?: ReactNode }) {
  const bg = tone === "danger" ? "bg-[var(--boule-red)]" : tone === "info" ? "bg-[var(--panel-dark-bg)]" : "bg-[var(--boule-orange)]";
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`flex flex-wrap items-center justify-between gap-3 rounded-[var(--surface-radius-sm)] border border-[var(--hairline-strong)] ${bg} px-4 py-3 text-sm text-white`}>
      <div className="min-w-0">{children}</div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function DataRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="boule-data-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
