/**
 * 项目文档页（新增）。统一管理一个项目下所有工作流的输出交付物：
 * 跨工作流聚合 artifacts → 选中预览（文档 md→html / 交互件 iframe）→ 格式转换下载（md/html/pdf）。
 */
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueries } from "@tanstack/react-query";
import { useAuth } from "../stores/auth.ts";
import { PageHeader, PageShell, Panel, Badge } from "../components/Brutalist.tsx";
import { Skeleton, EmptyState, ErrorBanner } from "../components/States.tsx";
import { ExportBar } from "../views/DocumentWorkspace/ExportBar.tsx";
import { markdownToHtml } from "../lib/export.ts";
import { phaseLabel, statusLabel } from "../lib/labels.ts";
import { relativeTime } from "../lib/time.ts";
import { Icon } from "../components/Icon.tsx";

interface ProjectWorkflow { id: string; currentPhase: string; status: string; mode: string | null; updatedAt: string; createdAt: string; }
interface Artifact { id: string; phase: string; type: string; version: number; status: string; body?: string; }

export function ProjectDocumentsPage() {
  const { id } = useParams();
  const api = useAuth((s) => s.api);
  const [selectedId, setSelectedId] = useState<string | undefined>();

  const wfs = useQuery({ queryKey: ["project-workflows", id], queryFn: () => api.json<{ workflows: ProjectWorkflow[] }>(`/api/projects/${id}/workflows`) });
  const workflows = wfs.data?.workflows ?? [];

  // 跨工作流并行拉 artifacts。
  const artifactQueries = useQueries({
    queries: workflows.map((w) => ({
      queryKey: ["artifacts", w.id],
      queryFn: () => api.json<{ artifacts: Artifact[] }>(`/api/workflows/${w.id}/artifacts`),
      enabled: !!w.id,
    })),
  });

  const selected = useQuery({ queryKey: ["artifact", selectedId], enabled: !!selectedId, queryFn: () => api.json<Artifact>(`/api/artifacts/${selectedId}`) });

  // 组装：每个工作流一组，含其 artifacts。
  const groups = useMemo(() => workflows.map((w, i) => ({ wf: w, artifacts: artifactQueries[i]?.data?.artifacts ?? [] })), [workflows, artifactQueries]);
  const totalArtifacts = groups.reduce((n, g) => n + g.artifacts.length, 0);
  const anyLoading = wfs.isLoading || artifactQueries.some((q) => q.isLoading);

  const docName = (a: Artifact) => `${phaseLabel(a.phase)}${a.type === "interactive" ? "·交互件" : ""}-v${a.version}`;

  return (
    <PageShell wide>
      <PageHeader eyebrow="项目文档" title="输出交付物" action={<Link to={`/projects/${id}`} className="boule-btn boule-btn--secondary">← 返回项目</Link>}>
        一个项目下所有工作流产出的交付物集中在此：预览、按需转换格式（Markdown / HTML / PDF）并下载。
      </PageHeader>

      <div className="mt-8 grid gap-5 lg:grid-cols-[320px_1fr]">
        <Panel>
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--md-outline-variant)" }}>
            <span className="font-[var(--boule-disp)] text-[16px] font-semibold">全部交付物</span>
            <Badge tone="dark">{totalArtifacts}</Badge>
          </div>
          <div className="p-3">
            {wfs.isLoading ? <Skeleton rows={5} /> : wfs.isError ? <ErrorBanner severity="P1" message="加载工作流失败" onRetry={() => void wfs.refetch()} /> : groups.length === 0 ? <EmptyState title="还没有工作流" hint="先在项目里启动一次任务，产出的交付物会出现在这里。" /> : (
              <div className="flex flex-col gap-4">
                {groups.map(({ wf, artifacts }) => (
                  <div key={wf.id}>
                    <div className="mb-1.5 flex items-center gap-2 px-2 text-[12px] text-[var(--md-on-surface-variant)]">
                      <span className="font-medium text-[var(--md-on-surface)]">{wf.mode ?? "未命名任务"}</span>
                      <span>·</span>
                      <span>{relativeTime(wf.updatedAt ?? wf.createdAt)}</span>
                    </div>
                    {artifacts.length === 0 ? (
                      <div className="px-3 py-2 text-[12px] text-[var(--md-on-surface-variant)] opacity-70">暂无交付物</div>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        {artifacts.map((a) => (
                          <button key={a.id} type="button" onClick={() => setSelectedId(a.id)} className="boule-list-row w-full text-left" aria-current={selectedId === a.id}>
                            <Icon name={a.type === "interactive" ? "widgets" : "description"} size={18} className="shrink-0 text-[var(--md-on-surface-variant)]" />
                            <span className="min-w-0 flex-1 truncate text-[14px]">{phaseLabel(a.phase)}{a.type === "interactive" ? " · 交互件" : ""}</span>
                            <span className="shrink-0 text-[11px] text-[var(--md-on-surface-variant)]">v{a.version}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>

        <section className="space-y-3">
          {!selectedId ? (
            <EmptyState title={anyLoading ? "加载中…" : "选择左侧交付物预览与导出"} />
          ) : selected.isLoading ? <Skeleton rows={8} /> : selected.isError || !selected.data ? <ErrorBanner severity="P1" message="加载交付物失败" onRetry={() => void selected.refetch()} /> : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-[var(--boule-disp)] text-[18px] font-semibold">{phaseLabel(selected.data.phase)}</span>
                  <Badge tone="blue">v{selected.data.version}</Badge>
                  <Badge>{statusLabel(selected.data.status)}</Badge>
                </div>
                <ExportBar name={docName(selected.data)} body={selected.data.body ?? ""} isHtml={selected.data.type === "interactive"} />
              </div>
              {selected.data.type === "interactive" ? (
                <iframe title="交互件预览" srcDoc={selected.data.body ?? ""} sandbox="allow-scripts" className="h-[70vh] w-full rounded-[var(--md-shape-md)]" style={{ border: "1px solid var(--md-outline-variant)", background: "#fff" }} />
              ) : (
                <Panel>
                  <div className="boule-prose px-6 py-5" dangerouslySetInnerHTML={{ __html: markdownToHtml(selected.data.body ?? "") }} />
                </Panel>
              )}
            </>
          )}
        </section>
      </div>
    </PageShell>
  );
}
