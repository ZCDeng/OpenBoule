import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "../stores/auth.ts";
import { ErrorBanner } from "../components/States.tsx";
import { ApiError } from "../lib/api.ts";
import { ProjectReferencesPanel } from "../views/ProjectInputs/ProjectReferencesPanel.tsx";

const MODES = ["决策", "培训", "落地", "调研", "诊断"] as const;
type LinkMode = "gitUrl" | "localDir";

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const api = useAuth((s) => s.api);
  const nav = useNavigate();
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([]);
  const [skippedReferences, setSkippedReferences] = useState<{ id: string; filename: string | null; parseStatus: string }[]>([]);
  const [createdWorkflowId, setCreatedWorkflowId] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: (mode: string) =>
      api.json<{ workflowId: string; skippedReferences?: { id: string; filename: string | null; parseStatus: string }[] }>("/api/workflows", {
        method: "POST",
        body: JSON.stringify({ projectId: id, mode, referenceIds: selectedReferenceIds }),
      }),
    onSuccess: (r) => {
      const skipped = r.skippedReferences ?? [];
      setSkippedReferences(skipped);
      setCreatedWorkflowId(r.workflowId);
      if (skipped.length === 0) nav(`/workflows/${r.workflowId}`);
    },
  });

  // U4 Git-linked 配置（thin 表单：写入即用 PATCH 回显，无单项目 GET）。
  const [linkMode, setLinkMode] = useState<LinkMode>("gitUrl");
  const [value, setValue] = useState("");
  const link = useMutation({
    mutationFn: () =>
      api.json<{ linkMode: LinkMode }>(`/api/projects/${id}/git-link`, {
        method: "PATCH",
        body: JSON.stringify(
          linkMode === "gitUrl" ? { linkMode, gitUrl: value } : { linkMode, localBaseDir: value },
        ),
      }),
  });
  const linkErr = link.error instanceof ApiError ? link.error.message : link.isError ? "链接失败" : null;

  return (
    <div className="space-y-8">
      {id && (
        <ProjectReferencesPanel
          projectId={id}
          selectedIds={selectedReferenceIds}
          onSelectedIdsChange={setSelectedReferenceIds}
        />
      )}

      <section className="space-y-3">
        <h1 className="text-xl">项目工作流</h1>
        <p className="text-sm text-neutral-500">
          选择 mode 启动一次新的咨询工作流（仅 Owner 可启动）。已勾选 {selectedReferenceIds.length} 个 reference。
        </p>
        {start.isError && <ErrorBanner severity="P0" message="启动工作流失败（可能权限不足或真值源未配置）" />}
        {skippedReferences.length > 0 && (
          <div className="space-y-2">
            <ErrorBanner severity="P1" message={`${skippedReferences.length} 个 reference 因解析失败或不存在未纳入本次 workflow。`} />
            {createdWorkflowId && (
              <button
                onClick={() => nav(`/workflows/${createdWorkflowId}`)}
                className="rounded border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50"
              >
                继续查看已创建 workflow
              </button>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <button
              key={m}
              disabled={start.isPending}
              onClick={() => start.mutate(m)}
              className="rounded border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
            >
              {m}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3 border-t border-neutral-200 pt-6">
        <h2 className="text-lg">关联 Git 仓库</h2>
        <p className="text-sm text-neutral-500">
          仅 Owner 可设置。<code>gitUrl</code> 团队/本地皆可（clone 到服务端）；
          <code>localBaseDir</code> 仅本地模式（agent 在你本地真实 repo 执行）。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={linkMode}
            onChange={(e) => setLinkMode(e.target.value as LinkMode)}
            className="rounded border border-neutral-300 px-3 py-2 text-sm"
          >
            <option value="gitUrl">gitUrl（团队/本地）</option>
            <option value="localDir">localBaseDir（仅本地模式）</option>
          </select>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={linkMode === "gitUrl" ? "https://github.com/you/repo.git" : "/Users/you/repo"}
            className="min-w-[20rem] flex-1 rounded border border-neutral-300 px-3 py-2 text-sm"
          />
          <button
            disabled={link.isPending || value.trim() === ""}
            onClick={() => link.mutate()}
            className="rounded border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
          >
            链接
          </button>
        </div>
        {linkErr && <ErrorBanner severity="P1" message={linkErr} />}
        {link.isSuccess && (
          <p className="text-sm text-green-700">已关联（{link.data.linkMode}）。下次 workflow 的 agent 将使用该 workspace。</p>
        )}
      </section>
    </div>
  );
}
