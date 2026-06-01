import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../stores/auth.ts";
import { ErrorBanner, Skeleton } from "../../components/States.tsx";

interface FrozenReference {
  id: string;
  referenceId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  bodySnapshot: string;
  createdAt: string;
}

export function FrozenReferences({ workflowId }: { workflowId: string }) {
  const api = useAuth((s) => s.api);
  const [openId, setOpenId] = useState<string | null>(null);
  const refs = useQuery({
    queryKey: ["workflow-references", workflowId],
    queryFn: () => api.json<{ references: FrozenReference[] }>(`/api/workflows/${workflowId}/references`),
  });

  if (refs.isLoading) return <Skeleton rows={2} />;
  if (refs.isError) return <ErrorBanner severity="P1" message="加载冻结 references 失败" onRetry={() => void refs.refetch()} />;
  const references = refs.data?.references ?? [];
  if (references.length === 0) return null;

  return (
    <section className="space-y-2 rounded-lg border border-neutral-200 bg-white p-3">
      <div>
        <h2 className="text-sm font-medium">本次冻结 References</h2>
        <p className="text-xs text-neutral-500">这些材料在 workflow 创建时已固化，只读展示；后续项目 reference 变更不会影响本次运行。</p>
      </div>
      <div className="divide-y divide-neutral-200">
        {references.map((ref) => {
          const open = openId === ref.id;
          return (
            <div key={ref.id} className="py-2">
              <button
                onClick={() => setOpenId(open ? null : ref.id)}
                className="flex w-full items-center justify-between gap-3 text-left"
              >
                <span className="min-w-0 truncate text-sm">{ref.filename}</span>
                <span className="shrink-0 text-xs text-neutral-500">{ref.sizeBytes} bytes</span>
              </button>
              {open && (
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 p-3 text-xs text-neutral-700">
                  {ref.bodySnapshot}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
