import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "../stores/auth.ts";
import { ErrorBanner } from "../components/States.tsx";
import { ApiError } from "../lib/api.ts";
import { ProjectReferencesPanel } from "../views/ProjectInputs/ProjectReferencesPanel.tsx";
import { Badge, Button, PageHeader, PageShell, Panel, PanelHeader, SelectInput, TextInput } from "../components/Brutalist.tsx";

const MODES = ["决策", "培训", "落地", "调研", "诊断"] as const;
type LinkMode = "gitUrl" | "localDir";

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const api = useAuth((s) => s.api);
  const nav = useNavigate();
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([]);
  const [skippedReferences, setSkippedReferences] = useState<{ id: string; filename: string | null; parseStatus: "parsed" | "failed" | "partial" | "missing" }[]>([]);
  const [createdWorkflowId, setCreatedWorkflowId] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: (mode: string) => api.json<{ workflowId: string; skippedReferences?: { id: string; filename: string | null; parseStatus: "parsed" | "failed" | "partial" | "missing" }[] }>("/api/workflows", {
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

  const [linkMode, setLinkMode] = useState<LinkMode>("gitUrl");
  const [value, setValue] = useState("");
  const link = useMutation({
    mutationFn: () => api.json<{ linkMode: LinkMode }>(`/api/projects/${id}/git-link`, {
      method: "PATCH",
      body: JSON.stringify(linkMode === "gitUrl" ? { linkMode, gitUrl: value } : { linkMode, localBaseDir: value }),
    }),
  });
  const linkErr = link.error instanceof ApiError ? link.error.message : link.isError ? "链接失败" : null;

  return (
    <PageShell wide>
      <PageHeader eyebrow="Nº 02 — PROJECT BRIEF" title="项目工作流">
        选择 mode 启动一次新的咨询工作流。已勾选 <b>{selectedReferenceIds.length}</b> 个 reference；所有输入都会进入后续可追溯 lineage。
      </PageHeader>

      <div className="boule-grid boule-grid--2 mt-8">
        <Panel>
          <PanelHeader k="A / REFERENCES" title="项目材料" >上传、解析、勾选要冻结进 workflow 的 reference。</PanelHeader>
          <div className="boule-panel-body">{id && <ProjectReferencesPanel projectId={id} selectedIds={selectedReferenceIds} onSelectedIdsChange={setSelectedReferenceIds} />}</div>
        </Panel>

        <div className="space-y-6">
          <Panel>
            <PanelHeader k="B / LAUNCH" title="启动模式">同一项目可多次启动不同类型的咨询流水线。</PanelHeader>
            <div className="boule-panel-body space-y-4">
              {start.isError && <ErrorBanner severity="P0" message="启动工作流失败（可能权限不足或真值源未配置）" />}
              {skippedReferences.length > 0 && (
                <div className="space-y-3">
                  <ErrorBanner severity="P1" message={`${skippedReferences.length} 个 reference 因解析失败或不存在未纳入本次 workflow。`} />
                  {createdWorkflowId && <Button variant="secondary" onClick={() => nav(`/workflows/${createdWorkflowId}`)}>继续查看 workflow</Button>}
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {MODES.map((m, i) => (
                  <button key={m} disabled={start.isPending} onClick={() => start.mutate(m)} className="group border-2 border-black p-4 text-left hover:bg-black hover:text-white disabled:opacity-50">
                    <div className="font-[var(--boule-mono)] text-[11px] uppercase tracking-[0.14em] text-[var(--boule-blue)] group-hover:text-white">MODE {String(i + 1).padStart(2, "0")}</div>
                    <div className="mt-2 font-[var(--boule-disp)] text-2xl font-black tracking-[-0.03em]">{m}</div>
                  </button>
                ))}
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader k="C / WORKSPACE" title="关联 Git 仓库">让 agent 在真实 repo / 服务端 clone 上执行。</PanelHeader>
            <div className="boule-panel-body space-y-3">
              <div className="flex flex-wrap gap-2">
                <SelectInput value={linkMode} onChange={(e) => setLinkMode(e.target.value as LinkMode)}>
                  <option value="gitUrl">gitUrl（团队/本地）</option>
                  <option value="localDir">localBaseDir（仅本地模式）</option>
                </SelectInput>
                <TextInput value={value} onChange={(e) => setValue(e.target.value)} placeholder={linkMode === "gitUrl" ? "https://github.com/you/repo.git" : "/Users/you/repo"} />
              </div>
              <Button variant="secondary" disabled={link.isPending || value.trim() === ""} onClick={() => link.mutate()}>链接 workspace</Button>
              {linkErr && <ErrorBanner severity="P1" message={linkErr} />}
              {link.isSuccess && <Badge tone="blue">已关联 · {link.data.linkMode}</Badge>}
            </div>
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
