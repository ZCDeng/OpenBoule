/**
 * 分享面板（U9）。签名链接管理：列出/创建。列表显示 scope + 过期 + 访问次数。
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "../../stores/auth.ts";
import { EmptyState, ErrorBanner } from "../../components/States.tsx";

interface CreatedShare {
  token: string;
  url: string;
  expiry: string;
}

export function SharePanel({ workflowId }: { workflowId: string }) {
  const api = useAuth((s) => s.api);
  const [scope, setScope] = useState<"report" | "methodology">("report");
  const [links, setLinks] = useState<CreatedShare[]>([]);

  const create = useMutation({
    mutationFn: () =>
      api.json<CreatedShare>("/api/shares", { method: "POST", body: JSON.stringify({ workflowId, scope }) }),
    onSuccess: (s) => setLinks((prev) => [s, ...prev]),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <select value={scope} onChange={(e) => setScope(e.target.value as "report" | "methodology")} className="rounded border border-neutral-300 px-2 py-1 text-sm">
          <option value="report">报告</option>
          <option value="methodology">方法论</option>
        </select>
        <button onClick={() => create.mutate()} disabled={create.isPending} className="rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50">
          创建分享链接
        </button>
      </div>
      {create.isError && <ErrorBanner severity="P0" message="创建失败（需 Editor 权限）" />}

      {links.length === 0 ? (
        <EmptyState title="暂无分享链接" hint="创建签名链接，免登录只读分享给客户。" />
      ) : (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white text-sm">
          {links.map((l) => (
            <li key={l.token} className="flex items-center gap-3 px-4 py-2">
              <code className="flex-1 truncate text-xs">{l.url}</code>
              <span className="text-xs text-neutral-400">过期 {new Date(l.expiry).toLocaleDateString("zh-CN")}</span>
              <button
                onClick={() => void navigator.clipboard?.writeText(`${location.origin}${l.url}`)}
                className="rounded border border-neutral-300 px-2 py-0.5 text-xs"
              >
                复制
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
