/**
 * 文档工作台容器（U9）。左文档树（含 stale ⚠）/ 中编辑器 / 右版本历史。
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "../../stores/auth.ts";
import { DocumentList, type DocItem } from "./DocumentList.tsx";
import { Editor } from "./Editor.tsx";
import { VersionHistory } from "./VersionHistory.tsx";
import { Skeleton, EmptyState, ErrorBanner } from "../../components/States.tsx";
import { PHASE_LABELS } from "../../lib/phases.ts";
import { isHistoryVersion } from "../../lib/document-artifacts.ts";

interface ArtifactRow extends DocItem {
  version: number;
  status: string;
  stale: boolean;
  body?: string;
}

export function Workspace({ workflowId }: { workflowId: string }) {
  const api = useAuth((s) => s.api);
  const [selectedId, setSelectedId] = useState<string | undefined>();

  const arts = useQuery({
    queryKey: ["artifacts", workflowId],
    queryFn: () => api.json<{ artifacts: ArtifactRow[] }>(`/api/workflows/${workflowId}/artifacts`),
  });
  const stale = useQuery({
    queryKey: ["stale", workflowId],
    queryFn: () => api.json<{ stalePhases: string[] }>(`/api/workflows/${workflowId}/stale`),
  });
  const selected = useQuery({
    queryKey: ["artifact", selectedId],
    enabled: !!selectedId,
    queryFn: () => api.json<ArtifactRow>(`/api/artifacts/${selectedId}`),
  });

  if (arts.isLoading) return <Skeleton rows={4} />;
  if (arts.isError) return <ErrorBanner severity="P1" message="加载文档失败" onRetry={() => void arts.refetch()} />;
  if (!arts.data || arts.data.artifacts.length === 0) {
    return <EmptyState title="暂无文档" hint="工作流跑出 artifact 后在此编辑。" />;
  }

  const stalePhases = new Set(stale.data?.stalePhases ?? []);
  // 最早的 stale phase（按 phase 顺序）——重跑从它起，下游随审批前进自然重跑
  const earliestStale = PHASE_LABELS.map((p) => p.id).find((id) => stalePhases.has(id));
  const phaseLabel = (phase: string) => PHASE_LABELS.find((p) => p.id === phase)?.label ?? phase;
  const readOnlyHistory = Boolean(selected.data && isHistoryVersion(arts.data.artifacts, selected.data));
  const handleSaved = (nextId: string) => {
    setSelectedId(nextId);
    void arts.refetch();
    void stale.refetch();
  };

  const rerun = useMutation({
    mutationFn: (phase: string) =>
      api.json(`/api/workflows/${workflowId}/rerun`, { method: "POST", body: JSON.stringify({ phase }) }),
    onSuccess: () => void stale.refetch(),
  });

  return (
    <div className="space-y-4">
      {earliestStale && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <span>⚠ {stalePhases.size} 个下游阶段因上游编辑已过期。</span>
          <button
            onClick={() => rerun.mutate(earliestStale)}
            disabled={rerun.isPending}
            className="rounded bg-amber-600 px-2.5 py-1 text-xs text-white disabled:opacity-50"
          >
            {rerun.isPending ? "重跑中…" : "保存并重跑下游"}
          </button>
          {rerun.isError && <span className="text-xs text-red-600">重跑失败（需 Editor 且当前无运行中阶段）</span>}
        </div>
      )}
      <div className="grid grid-cols-[220px_1fr_220px] gap-4">
        <aside className="rounded-lg border border-neutral-200 bg-white">
          <DocumentList docs={arts.data.artifacts} stalePhases={stalePhases} selectedId={selectedId} onSelect={setSelectedId} />
        </aside>
        <section>
          {!selectedId ? (
            <EmptyState title="选择左侧文档开始编辑" />
          ) : selected.isLoading ? (
            <Skeleton rows={6} />
          ) : selected.data ? (
            <Editor
              key={selected.data.id}
              artifactId={selected.data.id}
              initialBody={selected.data.body ?? ""}
              meta={{
                phase: selected.data.phase,
                phaseLabel: phaseLabel(selected.data.phase),
                type: selected.data.type,
                version: selected.data.version,
                status: selected.data.status,
                stale: selected.data.stale || stalePhases.has(selected.data.phase),
              }}
              readOnly={readOnlyHistory}
              onSaved={handleSaved}
            />
          ) : null}
        </section>
        <aside>
          {selectedId && (
            <>
              <h3 className="mb-2 text-xs text-neutral-500">版本历史</h3>
              <VersionHistory artifactId={selectedId} selectedId={selectedId} onOpen={setSelectedId} />
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
