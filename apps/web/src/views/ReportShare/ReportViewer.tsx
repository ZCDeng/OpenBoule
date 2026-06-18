export function ReportViewer({ html, title = "报告预览" }: { html: string; title?: string }) {
  return <iframe title={title} srcDoc={html} sandbox="allow-scripts" className="h-[70vh] w-full rounded-[var(--md-shape-md)] border border-[var(--md-outline-variant)] bg-[var(--md-surface)] shadow-[var(--md-elevation-1)]" />;
}
