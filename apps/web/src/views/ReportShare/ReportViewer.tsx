export function ReportViewer({ html, title = "报告预览" }: { html: string; title?: string }) {
  return <iframe title={title} srcDoc={html} sandbox="allow-scripts" className="h-[70vh] w-full border-2 border-[var(--app-fg)] bg-[var(--boule-paper)] shadow-[6px_6px_0_var(--app-fg)]" />;
}
