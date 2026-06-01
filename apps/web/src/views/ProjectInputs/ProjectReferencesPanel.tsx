import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../stores/auth.ts";
import { ErrorBanner, Skeleton } from "../../components/States.tsx";

export interface ProjectReference {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  parseStatus: "parsed" | "failed" | "partial";
  parseSource: "local-js" | "anthropic" | null;
  parseError: string | null;
  createdAt: string;
}

export function ProjectReferencesPanel({
  projectId,
  selectedIds,
  onSelectedIdsChange,
}: {
  projectId: string;
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
}) {
  const api = useAuth((s) => s.api);
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const refs = useQuery({
    queryKey: ["project-references", projectId],
    queryFn: () => api.json<{ references: ProjectReference[] }>(`/api/projects/${projectId}/references`),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.json<{ reference: ProjectReference }>(`/api/projects/${projectId}/references`, {
        method: "POST",
        body: form,
      });
    },
    onSuccess: (res) => {
      onSelectedIdsChange([...new Set([...selectedIds, res.reference.id])]);
      void qc.invalidateQueries({ queryKey: ["project-references", projectId] });
      if (inputRef.current) inputRef.current.value = "";
    },
  });

  const remove = useMutation({
    mutationFn: (referenceId: string) =>
      api.request(`/api/projects/${projectId}/references/${referenceId}`, { method: "DELETE" }),
    onSuccess: (_, referenceId) => {
      onSelectedIdsChange(selectedIds.filter((id) => id !== referenceId));
      void qc.invalidateQueries({ queryKey: ["project-references", projectId] });
    },
  });

  const references = refs.data?.references ?? [];
  const selected = new Set(selectedIds);

  function toggle(id: string) {
    onSelectedIdsChange(selected.has(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  return (
    <section className="space-y-3 border-t border-neutral-200 pt-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg">项目 References</h2>
          <p className="text-sm text-neutral-500">
            上传客户提供的 reference/source 材料。支持文本、PDF、DOCX、PPTX、XLSX；启动 workflow 时只冻结勾选项，映射到 Skill 的 sources/reference 语义。
          </p>
          <p className="mt-1 text-xs text-amber-700">扫描件或混合扫描文档会发送至 Anthropic/Claude 抽取文本；数字文档优先本地解析。</p>
        </div>
        <label className="cursor-pointer rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50">
上传 reference
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".txt,.md,.csv,.json,.yaml,.yml,.pdf,.docx,.pptx,.xlsx,text/*,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={upload.isPending}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) upload.mutate(file);
            }}
          />
        </label>
      </div>

      {upload.isError && <ErrorBanner severity="P1" message="上传 reference 失败，请确认格式、大小或解析状态" />}
      {remove.isError && <ErrorBanner severity="P1" message="删除 reference 失败" />}
      {refs.isLoading ? (
        <Skeleton rows={3} />
      ) : refs.isError ? (
        <ErrorBanner severity="P1" message="加载 references 失败" onRetry={() => void refs.refetch()} />
      ) : references.length === 0 ? (
        <div className="rounded border border-dashed border-neutral-300 px-4 py-5 text-sm text-neutral-500">
          暂无 reference。可先上传客户 brief、访谈纪要、行业材料或数据摘录。
        </div>
      ) : (
        <div className="divide-y divide-neutral-200 rounded border border-neutral-200 bg-white">
          {references.map((ref) => (
            <div key={ref.id} className="flex items-center gap-3 px-3 py-2">
              <input type="checkbox" checked={selected.has(ref.id)} onChange={() => toggle(ref.id)} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{ref.filename}</div>
                <div className="text-xs text-neutral-500">
                  {ref.mimeType} · {ref.sizeBytes} bytes · {statusLabel(ref.parseStatus, ref.parseSource)}
                  {ref.parseError ? ` · ${ref.parseError}` : ""}
                </div>
              </div>
              <button
                disabled={remove.isPending}
                onClick={() => remove.mutate(ref.id)}
                className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 disabled:opacity-50"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="text-xs text-neutral-500">本次启动将冻结 {selectedIds.length} 个 reference。</div>
    </section>
  );
}

function statusLabel(status: ProjectReference["parseStatus"], source: ProjectReference["parseSource"]): string {
  if (status === "failed") return "未解析";
  if (status === "partial") return `部分解析${source === "anthropic" ? " · Claude" : ""}`;
  return `已解析${source === "anthropic" ? " · Claude" : source === "local-js" ? " · 本地" : ""}`;
}
