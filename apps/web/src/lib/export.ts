/**
 * 产物格式转换/导出（macOS app / 五类交互之「格式转换」）。纯客户端：
 *   - Markdown(.md)：原文下载
 *   - HTML(.html)：交互件原样；文档用轻量 md→html 包成自带样式的整页
 *   - PDF：开打印窗口走系统「打印 / 存为 PDF」
 */

/** 触发浏览器下载一段文本。 */
function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(s: string): string {
  // 行内：先转义，再还原 **粗体** / *斜体* / `代码` / [文字](链接)
  let t = escapeHtml(s);
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return t;
}

/** 轻量 Markdown→HTML（标题/列表/引用/代码块/段落/分隔线/行内）。够导出用，非全规范实现。 */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inUl = false;
  let inOl = false;
  let inCode = false;
  const closeLists = () => {
    if (inUl) { out.push("</ul>"); inUl = false; }
    if (inOl) { out.push("</ol>"); inOl = false; }
  };
  for (const raw of lines) {
    const line = raw;
    if (/^```/.test(line.trim())) {
      if (inCode) { out.push("</code></pre>"); inCode = false; }
      else { closeLists(); out.push("<pre><code>"); inCode = true; }
      continue;
    }
    if (inCode) { out.push(escapeHtml(line)); continue; }
    if (line.trim() === "") { closeLists(); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { closeLists(); const n = h[1]!.length; out.push(`<h${n}>${inline(h[2]!)}</h${n}>`); continue; }
    if (/^(---|\*\*\*|___)\s*$/.test(line)) { closeLists(); out.push("<hr/>"); continue; }
    if (/^>\s?/.test(line)) { closeLists(); out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`); continue; }
    const ul = /^[-*+]\s+(.*)$/.exec(line);
    if (ul) { if (!inUl) { closeLists(); out.push("<ul>"); inUl = true; } out.push(`<li>${inline(ul[1]!)}</li>`); continue; }
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    if (ol) { if (!inOl) { closeLists(); out.push("<ol>"); inOl = true; } out.push(`<li>${inline(ol[1]!)}</li>`); continue; }
    closeLists();
    out.push(`<p>${inline(line)}</p>`);
  }
  if (inCode) out.push("</code></pre>");
  closeLists();
  return out.join("\n");
}

const PRINT_CSS = `
  body{font:16px/1.7 -apple-system,"PingFang SC","Source Han Sans SC",system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 24px;color:#1b1b17}
  h1,h2,h3,h4{font-family:"Source Han Serif SC",Georgia,serif;line-height:1.3;margin:1.4em 0 .5em}
  h1{font-size:2em} h2{font-size:1.5em} h3{font-size:1.2em}
  pre{background:#f0eee7;padding:14px;border-radius:8px;overflow:auto}
  code{font-family:"SF Mono",ui-monospace,monospace;font-size:.92em}
  blockquote{border-left:3px solid #1a18ee;margin:1em 0;padding:.2em 1em;color:#49473e}
  a{color:#1a18ee} hr{border:none;border-top:1px solid #cbc9bd;margin:2em 0}
  @media print{body{margin:0}}
`;

function fullHtml(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_CSS}</style></head><body>${bodyHtml}</body></html>`;
}

/** 导出 Markdown 原文。 */
export function exportMarkdown(name: string, body: string): void {
  downloadText(`${name}.md`, body, "text/markdown");
}

/** 导出 HTML：交互件(isHtml)原样下载；文档 md→html 包整页。 */
export function exportHtml(name: string, body: string, isHtml: boolean): void {
  const html = isHtml ? body : fullHtml(name, markdownToHtml(body));
  downloadText(`${name}.html`, html, "text/html");
}

/** 打印 / 存为 PDF：开新窗口写入内容后调用系统打印。 */
export function printAsPdf(name: string, body: string, isHtml: boolean): void {
  const html = isHtml ? body : fullHtml(name, markdownToHtml(body));
  const w = window.open("", "_blank", "noopener,width=860,height=1100");
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  // 等渲染再打印
  setTimeout(() => w.print(), 300);
}
