/**
 * 报告预览（U9）。**职责边界**：前端只做 iframe 隔离预览——
 * sandbox="allow-scripts" 且**不给** allow-same-origin（opaque origin，隔离 cookie/storage/API）；
 * 用 srcdoc 注入已由 U10 服务端内联 + CSP 合规的 HTML，前端不做渲染/内联逻辑。
 */

export function ReportViewer({ html, title = "报告预览" }: { html: string; title?: string }) {
  return (
    <iframe
      title={title}
      srcDoc={html}
      sandbox="allow-scripts" // 故意不含 allow-same-origin：opaque origin 隔离
      className="h-[70vh] w-full rounded-lg border border-neutral-200 bg-white"
    />
  );
}
