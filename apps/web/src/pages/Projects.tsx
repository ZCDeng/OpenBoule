import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../stores/auth.ts";
import { Skeleton, EmptyState, ErrorBanner } from "../components/States.tsx";
import { Badge, Button, PageHeader, PageShell, Panel, TextInput } from "../components/Brutalist.tsx";
import { useFadeIn } from "../hooks/useFadeIn.ts";
import { useStaggerIn } from "../hooks/useStaggerIn.ts";
import { projectStatusTone } from "../lib/derive.ts";
import { relativeTime } from "../lib/time.ts";
import { phaseLabel, statusLabel } from "../lib/labels.ts";

interface Project {
  id: string;
  name: string;
  status?: string | null;
  currentPhase?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
}

export function ProjectsPage() {
  const api = useAuth((s) => s.api);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const pageRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["projects"], queryFn: () => api.json<{ projects: Project[] }>("/api/projects") });
  const create = useMutation({
    mutationFn: (n: string) => api.json<{ projectId: string }>("/api/projects", { method: "POST", body: JSON.stringify({ name: n }) }),
    onSuccess: () => { setName(""); void qc.invalidateQueries({ queryKey: ["projects"] }); },
  });
  const projects = data?.projects ?? [];
  useFadeIn(pageRef);
  useStaggerIn(listRef, ".boule-list-row", { dependencies: [data?.projects.length ?? 0, query] });

  const filtered = useMemo(() => projects.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase())), [projects, query]);

  return (
    <div ref={pageRef}>
    <PageShell>
      <PageHeader eyebrow="Nº 01 — PROJECTS" title="项目控制台" action={
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(name.trim()); }} className="project-create-form">
          <TextInput placeholder="输入新项目名：客户 / 主题 / 输出目标" value={name} onChange={(e) => setName(e.target.value)} />
          <Button disabled={create.isPending || name.trim() === ""}>创建生产线 →</Button>
        </form>
      }>
        项目不是文件夹，是一条从用户输入到输出查询的生产线：材料、任务、审批、文档与分享都从这里进入。
      </PageHeader>

      <Panel className="mt-8">
        <div className="project-console-bar boule-panel-body">
          <div>
            <div><Badge tone="blue">输入</Badge></div>
            <b>先定义要解决的问题</b>
            <small>项目名建议包含客户、场景和交付物，例如“物业 AI 战略报告”。</small>
          </div>
          <div>
            <div><Badge tone="orange">检索</Badge></div>
            <b>再检索已有输出</b>
            <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索项目 / 输出主题" />
          </div>
        </div>
      </Panel>

      <div className="mt-8">
        {isLoading && <Skeleton rows={4} />}
        {isError && <ErrorBanner severity="P0" message="加载项目失败" onRetry={() => void refetch()} />}
        {data && projects.length === 0 && <EmptyState title="还没有项目" hint="创建第一个项目，开始一次咨询任务。" />}
        {data && projects.length > 0 && filtered.length === 0 && <EmptyState title="没有匹配项目" hint="换个关键词，或创建一条新的咨询生产线。" />}
        {filtered.length > 0 && (
          <div ref={listRef} className="boule-list project-list">
            {filtered.map((p, i) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="boule-list-row" aria-label={`打开项目 ${p.name}`}>
                <span className="w-8 shrink-0 font-[var(--boule-mono)] text-[11px] tracking-[0.04em] text-[var(--boule-muted)]">N{String(i + 1).padStart(2, "0")}</span>
                <span className={`boule-dot boule-dot--${projectStatusTone(p.status)}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold">{p.name}</div>
                  <div className="mt-0.5 flex items-center gap-2 truncate font-[var(--boule-mono)] text-[11px] tracking-[0.04em] text-[var(--boule-muted)]">
                    <span>{p.status ? statusLabel(p.status) : "草稿"}</span>
                    {p.currentPhase && (<><span className="text-[var(--text-on-dark-dim)]">·</span><span className="truncate">{phaseLabel(p.currentPhase)}</span></>)}
                  </div>
                </div>
                <span className="shrink-0 font-[var(--boule-mono)] text-[11px] tabular-nums text-[var(--boule-muted)]">{relativeTime(p.updatedAt ?? p.createdAt)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
      {create.isError && <div className="mt-5"><ErrorBanner severity="P1" message="创建项目失败" /></div>}
      <Panel className="mt-10">
        <div className="boule-panel-body project-entry-help">
          <Badge tone="dark">任务入口</Badge>
          <p>创建项目后进入详情页：上传材料、关联 Git 仓库、选择决策 / 培训 / 落地 / 调研 / 诊断模式，然后在顶部监控区查询状态与输出。</p>
        </div>
      </Panel>
    </PageShell>
    </div>
  );
}
