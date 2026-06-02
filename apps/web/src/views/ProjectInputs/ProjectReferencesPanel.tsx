import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../stores/auth.ts";
import { ErrorBanner, Skeleton } from "../../components/States.tsx";
import { Badge, Button } from "../../components/Brutalist.tsx";

export interface ProjectReference { id: string; filename: string; mimeType: string; sizeBytes: number; parseStatus: "parsed" | "failed" | "partial"; parseSource: "local-js" | "anthropic" | null; parseError: string | null; createdAt: string; }

export function ProjectReferencesPanel({ projectId, selectedIds, onSelectedIdsChange }: { projectId: string; selectedIds: string[]; onSelectedIdsChange: (ids: string[]) => void }) {
  const api = useAuth((s) => s.api);
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const refs = useQuery({ queryKey: ["project-references", projectId], queryFn: () => api.json<{ references: ProjectReference[] }>(`/api/projects/${projectId}/references`) });
  const upload = useMutation({ mutationFn: async (file: File) => { const form = new FormData(); form.append("file", file); return api.json<{ reference: ProjectReference }>(`/api/projects/${projectId}/references`, { method: "POST", body: form }); }, onSuccess: (res) => { onSelectedIdsChange([...new Set([...selectedIds, res.reference.id])]); void qc.invalidateQueries({ queryKey: ["project-references", projectId] }); if (inputRef.current) inputRef.current.value = ""; } });
  const remove = useMutation({ mutationFn: (referenceId: string) => api.request(`/api/projects/${projectId}/references/${referenceId}`, { method: "DELETE" }), onSuccess: (_, referenceId) => { onSelectedIdsChange(selectedIds.filter((id) => id !== referenceId)); void qc.invalidateQueries({ queryKey: ["project-references", projectId] }); } });
  const references = refs.data?.references ?? [];
  const selected = new Set(selectedIds);
  function toggle(id: string) { onSelectedIdsChange(selected.has(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]); }

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4 border-b-2 border-black pb-4">
        <div><h2 className="font-[var(--boule-disp)] text-3xl font-black tracking-[-0.04em]">项目 References</h2><p className="mt-2 text-sm text-[#33332e]">上传客户 reference/source 材料。启动 workflow 时只冻结勾选项。</p><p className="mt-1 text-xs text-[var(--boule-orange)]">扫描件或混合扫描文档会发送至 Anthropic/Claude 抽取文本；数字文档优先本地解析。</p></div>
        <label className="boule-btn boule-btn--secondary cursor-pointer">上传 reference<input ref={inputRef} type="file" className="hidden" accept=".txt,.md,.csv,.json,.yaml,.yml,.pdf,.docx,.pptx,.xlsx,text/*,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={upload.isPending} onChange={(e) => { const file = e.currentTarget.files?.[0]; if (file) upload.mutate(file); }} /></label>
      </div>
      {upload.isError && <ErrorBanner severity="P1" message="上传 reference 失败，请确认格式、大小或解析状态" />}
      {remove.isError && <ErrorBanner severity="P1" message="删除 reference 失败" />}
      {refs.isLoading ? <Skeleton rows={3} /> : refs.isError ? <ErrorBanner severity="P1" message="加载 references 失败" onRetry={() => void refs.refetch()} /> : references.length === 0 ? <div className="border-2 border-dashed border-black px-4 py-6 font-[var(--boule-mono)] text-xs uppercase tracking-[0.1em] text-[var(--boule-muted)]">暂无 reference。可先上传客户 brief、访谈纪要、行业材料或数据摘录。</div> : (
        <div className="border-2 border-black shadow-[5px_5px_0_#0B0B0B]">
          {references.map((ref) => <div key={ref.id} className="flex items-center gap-3 border-t-2 border-black px-3 py-3 first:border-t-0"><input type="checkbox" checked={selected.has(ref.id)} onChange={() => toggle(ref.id)} className="h-4 w-4 accent-[var(--boule-blue)]" /><div className="min-w-0 flex-1"><div className="truncate font-[var(--boule-disp)] text-lg font-black tracking-[-0.02em]">{ref.filename}</div><div className="mt-1 font-[var(--boule-mono)] text-[10px] uppercase tracking-[0.08em] text-[var(--boule-muted)]">{ref.mimeType} · {ref.sizeBytes} bytes · {statusLabel(ref.parseStatus, ref.parseSource)}{ref.parseError ? ` · ${parseErrorLabel(ref.parseError)}` : ""}</div></div><Button variant="secondary" disabled={remove.isPending} onClick={() => remove.mutate(ref.id)}>删除</Button></div>)}
        </div>
      )}
      <Badge tone="dark">本次启动将冻结 {selectedIds.length} 个 reference</Badge>
    </section>
  );
}

function parseErrorLabel(parseError: string): string { if (parseError === "CLAUDE_REFERENCE_OCR_DISABLED") return "扫描件需开启 Claude OCR 或改用数字版"; return parseError; }
function statusLabel(status: ProjectReference["parseStatus"], source: ProjectReference["parseSource"]): string { if (status === "failed") return "未解析"; if (status === "partial") return `部分解析${source === "anthropic" ? " · Claude" : ""}`; return `已解析${source === "anthropic" ? " · Claude" : source === "local-js" ? " · 本地" : ""}`; }
