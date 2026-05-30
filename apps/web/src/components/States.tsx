/**
 * 6 态原语（U7）。每个视图必须显式处理：加载 / 空 / 内容 / 错误(P0/P1/P2) / 离线降级 / 权限不足。
 * 集中成可复用组件，避免各页各写一套、漏态。
 */

import type { ReactNode } from "react";

/** 1. 初始加载态 —— skeleton 占位。 */
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-3" aria-busy="true" aria-label="加载中">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 rounded bg-neutral-200" />
      ))}
    </div>
  );
}

/** 2. 空态 —— 引导 CTA。 */
export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-neutral-500">
      <p className="text-lg">{title}</p>
      {hint && <p className="mt-1 text-sm">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** 4. 错误态 —— P0 阻塞(红置顶+重试) / P1 影响质量(黄内联) / P2 信息(灰可折叠)。 */
export function ErrorBanner({
  severity,
  message,
  onRetry,
}: {
  severity: "P0" | "P1" | "P2";
  message: string;
  onRetry?: () => void;
}) {
  const styles = {
    P0: "bg-red-50 border-red-300 text-red-800",
    P1: "bg-amber-50 border-amber-300 text-amber-800",
    P2: "bg-neutral-50 border-neutral-300 text-neutral-600",
  }[severity];
  return (
    <div className={`flex items-center justify-between rounded border px-4 py-2 text-sm ${styles}`} role="alert">
      <span>{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="ml-4 rounded bg-white/60 px-2 py-1 text-xs hover:bg-white">
          重试
        </button>
      )}
    </div>
  );
}

/** 5. 离线/降级态 —— SSE 断线提示，允许只读浏览。 */
export function OfflineBanner({ reconnecting }: { reconnecting: boolean }) {
  if (!reconnecting) return null;
  return (
    <div className="bg-amber-100 px-4 py-1 text-center text-sm text-amber-800" role="status">
      连接中断，正在重连…（可继续只读浏览）
    </div>
  );
}

/** 6. 权限不足态 —— 友好提示申请角色。 */
export function PermissionDenied({ need = "Editor" }: { need?: string }) {
  return (
    <EmptyState
      title="权限不足"
      hint={`当前角色无权访问此操作，请联系项目 Owner 申请 ${need} 权限。`}
    />
  );
}
