import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "../../stores/auth.ts";
import { EmptyState, ErrorBanner } from "../../components/States.tsx";
import { Badge, Button, SelectInput } from "../../components/Brutalist.tsx";

interface CreatedShare { token: string; url: string; expiry: string; }

export function SharePanel({ workflowId }: { workflowId: string }) {
  const api = useAuth((s) => s.api);
  const [scope, setScope] = useState<"report" | "methodology">("report");
  const [links, setLinks] = useState<CreatedShare[]>([]);
  const create = useMutation({ mutationFn: () => api.json<CreatedShare>("/api/shares", { method: "POST", body: JSON.stringify({ workflowId, scope }) }), onSuccess: (s) => setLinks((prev) => [s, ...prev]) });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2"><SelectInput value={scope} onChange={(e) => setScope(e.target.value as "report" | "methodology")}><option value="report">报告</option><option value="methodology">方法论</option></SelectInput><Button onClick={() => create.mutate()} disabled={create.isPending}>创建分享链接</Button></div>
      {create.isError && <ErrorBanner severity="P0" message="创建失败（需 Editor 权限）" />}
      {links.length === 0 ? <EmptyState title="暂无分享链接" hint="创建签名链接，免登录只读分享给客户。" /> : (
        <ul className="border-2 border-black text-sm shadow-[5px_5px_0_#0B0B0B]">
          {links.map((l) => <li key={l.token} className="flex items-center gap-3 border-t-2 border-black px-4 py-3 first:border-t-0"><code className="flex-1 truncate font-[var(--boule-mono)] text-xs">{l.url}</code><Badge>过期 {new Date(l.expiry).toLocaleDateString("zh-CN")}</Badge><Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(`${location.origin}${l.url}`)}>复制</Button></li>)}
        </ul>
      )}
    </div>
  );
}
