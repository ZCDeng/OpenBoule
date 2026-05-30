/**
 * 报告渲染（U10）——零-XSS。
 *
 * 双重防线（plan §sandbox 渲染 4）：iframe opaque-origin sandbox 是隔离层；本模块是**渲染前硬拒**层。
 * - sanitizeReportHtml：正则硬拒 <script>/<iframe>/on*=/javascript:（authored HTML 防御纵深）
 * - interpolate：模板插值只取标量、强制 HTML-escape，非标量 fail loud（结构化数据→零脚本注入）
 */

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPE[c]!);
}

/**
 * 硬拒危险结构（authored 客户 HTML 的防御纵深）：
 * 删 <script>…</script> / <iframe>…</iframe> / 内联 on*= 事件 / javascript: 协议。
 */
export function sanitizeReportHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, "")
    .replace(/<iframe\b[^>]*\/?>/gi, "")
    // on*= 事件处理器（带引号或裸值）
    .replace(/\s+on\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\s+on\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\s+on\w+\s*=\s*[^\s>]+/gi, "")
    // javascript: 协议（href/src 等）
    .replace(/javascript\s*:/gi, "blocked:");
}

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

/**
 * 模板插值 {{ key }} → escapeHtml(标量)。data 缺键或非标量（对象/数组/函数）→ 抛 TemplateError（fail loud）。
 * 杜绝把任意结构/未转义内容插进 HTML。
 */
export function interpolate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    if (!(key in data)) throw new TemplateError(`模板缺键: ${key}`);
    const v = data[key];
    const t = typeof v;
    if (v === null || (t !== "string" && t !== "number" && t !== "boolean")) {
      throw new TemplateError(`模板键 ${key} 非标量（拒绝插值，防注入）`);
    }
    return escapeHtml(String(v));
  });
}

/** 组装完整报告文档（body 经 sanitize）。供 /s/:token/report 顶层导航返回。 */
export function buildReportDocument(args: { title: string; bodyHtml: string }): string {
  const safeTitle = escapeHtml(args.title);
  const safeBody = sanitizeReportHtml(args.bodyHtml);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>body{font-family:system-ui,"Noto Sans SC",sans-serif;max-width:48rem;margin:2rem auto;padding:0 1rem;line-height:1.7;color:#1a1a1a}</style>
</head><body>${safeBody}</body></html>`;
}
