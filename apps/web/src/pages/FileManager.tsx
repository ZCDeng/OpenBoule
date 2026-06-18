/**
 * 文件管理页（全局交付物）。跨所有项目 / 工作流统一聚合输出交付物：
 * 按项目分组浏览 → 选中预览（文档 md→html / 交互件 iframe）→ 格式转换下载（md/html/pdf）。
 */
import { useMemo, useState } from "react";
import { useQuery, useQueries } from "@tanstack/react-query";
import { useAuth } from "../stores/auth.ts";
import { PageHeader, PageShell, Panel, Badge } from "../components/Brutalist.tsx";
import { Skeleton, EmptyState, ErrorBanner } from "../components/States.tsx";
import { ExportBar } from "../views/DocumentWorkspace/ExportBar.tsx";
import { markdownToHtml } from "../lib/export.ts";
import { phaseLabel, statusLabel } from "../lib/labels.ts";
import { Icon } from "../components/Icon.tsx";

interface Project { id: string; name: string; }
interface ProjectWorkflow { id: string; mode: string | null; updatedAt: string; createdAt: string; }
interface Artifact { id: string; phase: string; type: string; version: number; status: string; body?: string; }

export function FileManagerPage() {
  const api = useAuth((s) => s.api);
  const [selectedId, setSelectedId] = useState<string | undefined>();

  const projectsQ = useQuery({ queryKey: ["projects"], queryFn: () => api.json<{ projects: Project[] }>("/api/projects") });
  const projects = projectsQ.data?.projects ?? [];

  // 每个项目的工作流。
  const wfQueries = useQueries({
    queries: projects.map((p) => ({ queryKey: ["project-workflows", p.id], queryFn: () => api.json<{ workflows: ProjectWorkflow[] }>(`/api/projects/${p.id}/workflows`), enabled: !!p.id })),
  });
  const projWorkflows = useMemo(
    () => projects.map((p, i) => ({ project: p, workflows: wfQueries[i]?.data?.workflows ?? [] })),
    [projects, wfQueries],
  );

  // 所有工作流的 artifacts（拍平后并行拉）。
  const allWf = useMemo(() => projWorkflows.flatMap((g) => g.workflows.map((w) => ({ ...w, projectId: g.project.id }))), [projWorkflows]);
  const artQueries = useQueries({
    queries: allWf.map((w) => ({ queryKey: ["artifacts", w.id], queryFn: () => api.json<{ artifacts: Artifact[] }>(`/api/workflows/${w.id}/artifacts`), enabled: !!w.id })),
  });
  const artByWorkflow = useMemo(() => {
    const m = new Map<string, Artifact[]>();
    allWf.forEach((w, i) => m.set(w.id, artQueries[i]?.data?.artifacts ?? []));
    return m;
  }, [allWf, artQueries]);

  const selected = useQuery({ queryKey: ["artifact", selectedId], enabled: !!selectedId, queryFn: () => api.json<Artifact>(`/api/artifacts/${selectedId}`) });

  // 按项目分组：项目 → 其全部 artifacts（带 workflow mode）。
  const groups = useMemo(() => projWorkflows.map((g) => ({
    project: g.project,
    items: g.workflows.flatMap((w) => (artByWorkflow.get(w.id) ?? []).map((a) => ({ artifact: a, mode: w.mode }))),
  })).filter((g) => g.items.length > 0), [projWorkflows, artByWorkflow]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const docName = (a: Artifact) => `${phaseLabel(a.phase)}${a.type === "interactive" ? "·交互件" : ""}-v${a.version}`;
  const anyLoading = projectsQ.isLoading || wfQueries.some((q) => q.isLoading) || artQueries.some((q) => q.isLoading);

  return (
    <PageShell wide>
      <PageHeader eyebrow="文件管理" title="交付物总库">
        所有项目产出的交付物集中在此统一管理：预览、按需转换格式（Markdown / HTML / PDF）并下载。
      </PageHeader>

      <div className="mt-8 grid gap-5 lg:grid-cols-[340px_1fr]">
        <Panel>
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--md-outline-variant)" }}>
            <span className="font-[var(--boule-disp)] text-[16px] font-semibold">全部交付物</span>
            <Badge tone="dark">{total}</Badge>
          </div>
          <div className="p-3">
            {projectsQ.isLoading ? <Skeleton rows={6} /> : projectsQ.isError ? <ErrorBanner severity="P1" message="加载项目失败" onRetry={() => void projectsQ.refetch()} /> : groups.length === 0 ? <EmptyState title={anyLoading ? "加载中…" : "暂无交付物"} hint="项目跑出成果后，所有交付物会汇总到这里。" /> : (
              <div className="flex flex-col gap-4">
                {groups.map(({ project, items }) => (
                  <div key={project.id}>
                    <div className="mb-1.5 flex items-center gap-2 px-2 text-[13px]">
                      <Icon name="folder" size={16} className="text-[var(--md-on-surface-variant)]" />
                      <span className="truncate font-medium text-[var(--md-on-surface)]">{project.name}</span>
                      <span className="text-[12px] text-[var(--md-on-surface-variant)]">· {items.length}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {items.map(({ artifact: a, mode }) => (
                        <button key={a.id} type="button" onClick={() => setSelectedId(a.id)} className="boule-list-row w-full text-left" aria-current={selectedId === a.id}>
                          <Icon name={a.type === "interactive" ? "widgets" : "description"} size={18} className="shrink-0 text-[var(--md-on-surface-variant)]" />
                          <span className="min-w-0 flex-1 truncate text-[14px]">{phaseLabel(a.phase)}{a.type === "interactive" ? " · 交互件" : ""}{mode ? <span className="text-[var(--md-on-surface-variant)]"> · {mode}</span> : null}</span>
                          <span className="shrink-0 text-[11px] text-[var(--md-on-surface-variant)]">v{a.version}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>

        <section className="space-y-3">
          {!selectedId ? (
            <EmptyState title={anyLoading ? "加载中…" : "选择左侧交付物预览与下载"} />
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
