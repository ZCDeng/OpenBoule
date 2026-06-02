import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "../../stores/auth.ts";
import { DocumentList, type DocItem } from "./DocumentList.tsx";
import { Editor } from "./Editor.tsx";
import { VersionHistory } from "./VersionHistory.tsx";
import { Skeleton, EmptyState, ErrorBanner } from "../../components/States.tsx";
import { PHASE_LABELS } from "../../lib/phases.ts";
import { isHistoryVersion } from "../../lib/document-artifacts.ts";
import { Badge, Banner, Button, Panel, PanelHeader } from "../../components/Brutalist.tsx";

interface ArtifactRow extends DocItem { version: number; status: string; stale: boolean; body?: string; }

export function Workspace({ workflowId }: { workflowId: string }) {
  const api = useAuth((s) => s.api);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const arts = useQuery({ queryKey: ["artifacts", workflowId], queryFn: () => api.json<{ artifacts: ArtifactRow[] }>(`/api/workflows/${workflowId}/artifacts`) });
  const stale = useQuery({ queryKey: ["stale", workflowId], queryFn: () => api.json<{ stalePhases: string[] }>(`/api/workflows/${workflowId}/stale`) });
  const selected = useQuery({ queryKey: ["artifact", selectedId], enabled: !!selectedId, queryFn: () => api.json<ArtifactRow>(`/api/artifacts/${selectedId}`) });
  if (arts.isLoading) return <Skeleton rows={4} />;
  if (arts.isError) return <ErrorBanner severity="P1" message="加载文档失败" onRetry={() => void arts.refetch()} />;
  if (!arts.data || arts.data.artifacts.length === 0) return <EmptyState title="暂无文档" hint="任务产出成果后在此编辑。" />;
  const stalePhases = new Set(stale.data?.stalePhases ?? []);
  const earliestStale = PHASE_LABELS.map((p) => p.id).find((id) => stalePhases.has(id));
  const phaseLabel = (phase: string) => PHASE_LABELS.find((p) => p.id === phase)?.label ?? phase;
  const readOnlyHistory = Boolean(selected.data && isHistoryVersion(arts.data.artifacts, selected.data));
  const handleSaved = (nextId: string) => { setSelectedId(nextId); void arts.refetch(); void stale.refetch(); };
  const rerun = useMutation({ mutationFn: (phase: string) => api.json(`/api/workflows/${workflowId}/rerun`, { method: "POST", body: JSON.stringify({ phase }) }), onSuccess: () => void stale.refetch() });
  return (
    <div className="space-y-5">
      {earliestStale && <Banner tone="warn" action={<Button variant="secondary" onClick={() => rerun.mutate(earliestStale)} disabled={rerun.isPending}>{rerun.isPending ? "重跑中…" : "保存并重跑后续步骤"}</Button>}><span>⚠ {stalePhases.size} 个后续步骤因前序修改已过期。</span>{rerun.isError && <span className="ml-3 font-[var(--boule-mono)] text-xs">重跑失败（需审校权限，且当前无进行中的步骤）</span>}</Banner>}
      <div className="grid gap-5 lg:grid-cols-[240px_1fr] xl:grid-cols-[240px_1fr_260px]">
        <Panel><PanelHeader k="DOC TREE" title="文档树" /><DocumentList docs={arts.data.artifacts} stalePhases={stalePhases} selectedId={selectedId} onSelect={setSelectedId} /></Panel>
        <section>{!selectedId ? <EmptyState title="选择左侧文档开始编辑" /> : selected.isLoading ? <Skeleton rows={6} /> : selected.data ? <Editor key={selected.data.id} artifactId={selected.data.id} initialBody={selected.data.body ?? ""} meta={{ phase: selected.data.phase, phaseLabel: phaseLabel(selected.data.phase), type: selected.data.type, version: selected.data.version, status: selected.data.status, stale: selected.data.stale || stalePhases.has(selected.data.phase) }} readOnly={readOnlyHistory} onSaved={handleSaved} /> : null}</section>
        <aside>{selectedId && <><div className="mb-3"><Badge tone="dark">版本历史</Badge></div><VersionHistory artifactId={selectedId} selectedId={selectedId} onOpen={setSelectedId} /></>}</aside>
      </div>
    </div>
  );
}
