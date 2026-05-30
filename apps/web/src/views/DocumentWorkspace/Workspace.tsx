/**
 * 文档工作台容器（U9）。左文档树（含 stale ⚠）/ 中编辑器 / 右版本历史。
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../stores/auth.ts";
import { DocumentList, type DocItem } from "./DocumentList.tsx";
import { Editor } from "./Editor.tsx";
import { VersionHistory } from "./VersionHistory.tsx";
import { Skeleton, EmptyState, ErrorBanner } from "../../components/States.tsx";

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

  return (
    <div className="grid grid-cols-[200px_1fr_180px] gap-4">
      <aside className="rounded-lg border border-neutral-200 bg-white">
        <DocumentList docs={arts.data.artifacts} stalePhases={stalePhases} selectedId={selectedId} onSelect={setSelectedId} />
      </aside>
      <section>
        {!selectedId ? (
          <EmptyState title="选择左侧文档开始编辑" />
        ) : selected.isLoading ? (
          <Skeleton rows={6} />
        ) : selected.data ? (
          <Editor artifactId={selected.data.id} initialBody={selected.data.body ?? ""} />
        ) : null}
      </section>
      <aside>
        {selectedId && (
          <>
            <h3 className="mb-2 text-xs text-neutral-500">版本历史</h3>
            <VersionHistory artifactId={selectedId} />
          </>
        )}
      </aside>
    </div>
  );
}
