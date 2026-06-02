import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../stores/auth.ts";
import { Skeleton, EmptyState, ErrorBanner } from "../components/States.tsx";
import { Badge, Button, PageHeader, PageShell, Panel, TextInput } from "../components/Brutalist.tsx";

interface Project { id: string; name: string; }

export function ProjectsPage() {
  const api = useAuth((s) => s.api);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["projects"], queryFn: () => api.json<{ projects: Project[] }>("/api/projects") });
  const create = useMutation({
    mutationFn: (n: string) => api.json<{ projectId: string }>("/api/projects", { method: "POST", body: JSON.stringify({ name: n }) }),
    onSuccess: () => { setName(""); void qc.invalidateQueries({ queryKey: ["projects"] }); },
  });

  return (
    <PageShell>
      <PageHeader eyebrow="Nº 01 — PROJECTS" title="项目控制台" action={
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(name.trim()); }} className="flex min-w-[min(100%,430px)] gap-2">
          <TextInput placeholder="新项目名" value={name} onChange={(e) => setName(e.target.value)} />
          <Button disabled={create.isPending || name.trim() === ""}>创建</Button>
        </form>
      }>
        每个项目是一条咨询生产线：reference、工作流、审批、文档与分享都从这里进入。
      </PageHeader>

      <div className="mt-8">
        {isLoading && <Skeleton rows={4} />}
        {isError && <ErrorBanner severity="P0" message="加载项目失败" onRetry={() => void refetch()} />}
        {data && data.projects.length === 0 && <EmptyState title="还没有项目" hint="创建第一个项目，开始一次咨询工作流。" />}
        {data && data.projects.length > 0 && (
          <div className="boule-list">
            {data.projects.map((p, i) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="boule-list-row">
                <div>
                  <div className="font-[var(--boule-disp)] text-2xl font-black tracking-[-0.03em]">{p.name}</div>
                  <div className="mt-1 font-[var(--boule-mono)] text-[11px] uppercase tracking-[0.12em] opacity-60">PROJECT · {String(i + 1).padStart(2, "0")}</div>
                </div>
                <Badge tone="blue">打开 →</Badge>
              </Link>
            ))}
          </div>
        )}
      </div>
      {create.isError && <div className="mt-5"><ErrorBanner severity="P1" message="创建项目失败" /></div>}
      <Panel className="mt-10">
        <div className="boule-panel-body flex flex-wrap items-center gap-3">
          <Badge tone="dark">工作流入口</Badge>
          <p className="text-sm text-[#33332e]">创建项目后进入详情页上传材料、关联 Git 仓库，并选择决策 / 培训 / 落地 / 调研 / 诊断模式启动。</p>
        </div>
      </Panel>
    </PageShell>
  );
}
