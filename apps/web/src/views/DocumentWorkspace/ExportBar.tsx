/**
 * 产物导出条（格式转换交互）。对当前选中产物给出 Markdown / HTML / PDF 三种格式。
 * 交互件（type:"interactive"，本身就是 HTML）只给 HTML / PDF；文档（markdown）三种都给。
 */
import { Button } from "../../components/Brutalist.tsx";
import { exportMarkdown, exportHtml, printAsPdf } from "../../lib/export.ts";
import { toast } from "../../stores/notification.ts";

export function ExportBar({ name, body, isHtml }: { name: string; body: string; isHtml: boolean }) {
  const safe = (name || "document").replace(/[^\w一-龥-]+/g, "_").slice(0, 60) || "document";
  if (!body) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-[var(--boule-mono)] text-[11px] uppercase tracking-[0.1em] text-[var(--boule-muted)]">导出格式</span>
      {!isHtml && (
        <Button variant="secondary" onClick={() => { exportMarkdown(safe, body); toast.success("已导出 Markdown(.md)。", "格式转换"); }}>
          Markdown
        </Button>
      )}
      <Button variant="secondary" onClick={() => { exportHtml(safe, body, isHtml); toast.success("已导出 HTML(.html)。", "格式转换"); }}>
        HTML
      </Button>
      <Button variant="secondary" onClick={() => { printAsPdf(safe, body, isHtml); }}>
        PDF / 打印
      </Button>
    </div>
  );
}
