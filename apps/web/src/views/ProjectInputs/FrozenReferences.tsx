import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../stores/auth.ts";
import { ErrorBanner, Skeleton } from "../../components/States.tsx";
import { Badge, Panel, PanelHeader } from "../../components/Brutalist.tsx";
import { humanBytes } from "../../lib/labels.ts";

interface FrozenReference { id: string; referenceId: string | null; filename: string; mimeType: string; sizeBytes: number; bodySnapshot: string; createdAt: string; }

export function FrozenReferences({ workflowId }: { workflowId: string }) {
  const api = useAuth((s) => s.api);
  const [openId, setOpenId] = useState<string | null>(null);
  const refs = useQuery({ queryKey: ["workflow-references", workflowId], queryFn: () => api.json<{ references: FrozenReference[] }>(`/api/workflows/${workflowId}/references`) });
  if (refs.isLoading) return <Skeleton rows={2} />;
  if (refs.isError) return <ErrorBanner severity="P1" message="加载本次存档的参考材料失败" onRetry={() => void refs.refetch()} />;
  const references = refs.data?.references ?? [];
  if (references.length === 0) return null;
  return (
    <Panel>
      <PanelHeader k="存档材料" title="本次任务的存档材料">这些材料在任务创建时已存档；之后修改项目材料不会影响本次任务。</PanelHeader>
      <div className="boule-panel-body">
        <div className="border-2 border-[var(--app-fg)]">
          {references.map((ref) => { const open = openId === ref.id; return <div key={ref.id} className="border-t-2 border-[var(--app-fg)] first:border-t-0"><button onClick={() => setOpenId(open ? null : ref.id)} className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left"><span className="min-w-0 truncate font-[var(--boule-disp)] font-black tracking-[-0.02em]">{ref.filename}</span><Badge>{humanBytes(ref.sizeBytes)}</Badge></button>{open && <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t-2 border-[var(--app-fg)] p-3 font-[var(--boule-mono)] text-xs">{ref.bodySnapshot}</pre>}</div>; })}
        </div>
      </div>
    </Panel>
  );
}
