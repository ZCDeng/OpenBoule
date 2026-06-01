/**
 * 6 态原语（U7）——重绘为 Landing 同款 brutalist 语言。
 */

import type { ReactNode } from "react";
import { Button, Panel } from "./Brutalist.tsx";

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <Panel>
      <div className="boule-panel-body animate-pulse space-y-3" aria-busy="true" aria-label="加载中">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-5 border-2 border-black bg-[var(--boule-paper)]" style={{ width: `${96 - i * 9}%` }} />
        ))}
      </div>
    </Panel>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <Panel>
      <div className="boule-panel-body py-12 text-center">
        <p className="font-[var(--boule-disp)] text-3xl font-black tracking-[-0.03em]">{title}</p>
        {hint && <p className="mx-auto mt-3 max-w-xl text-sm text-[#33332e]">{hint}</p>}
        {action && <div className="mt-6 flex justify-center">{action}</div>}
      </div>
    </Panel>
  );
}

export function ErrorBanner({ severity, message, onRetry }: { severity: "P0" | "P1" | "P2"; message: string; onRetry?: () => void }) {
  const tone = {
    P0: "bg-red-600 text-white",
    P1: "bg-[var(--boule-orange)] text-white",
    P2: "bg-[var(--boule-paper)] text-black",
  }[severity];
  return (
    <div className={`flex items-center justify-between gap-4 border-2 border-black px-4 py-3 text-sm shadow-[4px_4px_0_#0B0B0B] ${tone}`} role="alert">
      <span className="font-[var(--boule-mono)] text-xs uppercase tracking-[0.08em]">{severity} · {message}</span>
      {onRetry && <Button variant="secondary" onClick={onRetry}>重试</Button>}
    </div>
  );
}

export function OfflineBanner({ reconnecting }: { reconnecting: boolean }) {
  if (!reconnecting) return null;
  return (
    <div className="border-b-2 border-black bg-[var(--boule-orange)] px-4 py-2 text-center font-[var(--boule-mono)] text-xs uppercase tracking-[0.12em] text-white" role="status">
      连接中断，正在重连 · 只读浏览可继续
    </div>
  );
}

export function PermissionDenied({ need = "Editor" }: { need?: string }) {
  return <EmptyState title="权限不足" hint={`当前角色无权访问此操作，请联系项目 Owner 申请 ${need} 权限。`} />;
}
