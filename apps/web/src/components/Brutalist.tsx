import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export const PAPER = "#F1F0EB";
export const INK = "#0B0B0B";
export const BLUE = "#1A18EE";
export const CLAUDE_ORANGE = "#D97757";
export const MUTED = "#6A6A63";
export const DISP = '"Helvetica Neue","Arial Black","PingFang SC","Source Han Sans SC",sans-serif';
export const BODY = '-apple-system,"PingFang SC","Source Han Sans SC","Segoe UI",sans-serif';
export const MONO = '"SF Mono","JetBrains Mono",ui-monospace,"Menlo",monospace';

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

export function Badge({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "blue" | "orange" | "dark" }) {
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

export function DataRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="boule-data-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
