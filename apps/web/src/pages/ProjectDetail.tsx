import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "../stores/auth.ts";
import { ErrorBanner, Skeleton } from "../components/States.tsx";
import { ApiError } from "../lib/api.ts";
import { ProjectReferencesPanel } from "../views/ProjectInputs/ProjectReferencesPanel.tsx";
import { PHASE_LABELS } from "../lib/phases.ts";
import { Badge, Button, PageHeader, PageShell, Panel, PanelHeader, SelectInput, TextInput } from "../components/Brutalist.tsx";
import { statusLabel } from "../lib/labels.ts";
import { useFadeIn } from "../hooks/useFadeIn.ts";
import { useStaggerIn } from "../hooks/useStaggerIn.ts";
import { useCountUp } from "../hooks/useCountUp.ts";

const LINK_MODE_LABELS: Record<string, string> = { gitUrl: "Git 地址", localDir: "本地目录" };

const MODES = [
  { name: "决策", hint: "输出可执行选项、取舍标准与建议" },
  { name: "培训", hint: "输出课程结构、讲义与训练路径" },
  { name: "落地", hint: "输出执行路线、里程碑与风险表" },
  { name: "调研", hint: "输出证据矩阵、趋势与来源索引" },
  { name: "诊断", hint: "输出问题定位、根因与优先级" },
] as const;
type LinkMode = "gitUrl" | "localDir";
interface ProjectWorkflow { id: string; currentPhase: string; status: string; mode: string | null; updatedAt: string; createdAt: string; }

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const api = useAuth((s) => s.api);
  const nav = useNavigate();
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([]);
  const [skippedReferences, setSkippedReferences] = useState<{ id: string; filename: string | null; parseStatus: "parsed" | "failed" | "partial" | "missing" }[]>([]);
  const [createdWorkflowId, setCreatedWorkflowId] = useState<string | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const ioRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<HTMLDivElement>(null);

  const workflows = useQuery({
    queryKey: ["project-workflows", id],
    queryFn: () => api.json<{ workflows: ProjectWorkflow[] }>(`/api/projects/${id}/workflows`),
    enabled: !!id,
    refetchInterval: 5000,
  });

  const start = useMutation({
    mutationFn: (mode: string) => api.json<{ workflowId: string; skippedReferences?: { id: string; filename: string | null; parseStatus: "parsed" | "failed" | "partial" | "missing" }[] }>("/api/workflows", {
      method: "POST",
      body: JSON.stringify({ projectId: id, mode, referenceIds: selectedReferenceIds }),
    }),
    onSuccess: (r) => {
      const skipped = r.skippedReferences ?? [];
      setSkippedReferences(skipped);
      setCreatedWorkflowId(r.workflowId);
      void workflows.refetch();
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
  const latest = workflows.data?.workflows[0];
  useFadeIn(pageRef);
  useStaggerIn(ioRef, ":scope > *");
  useStaggerIn(modeRef, ".mode-card", { dependencies: [start.isPending] });

  return (
    <div ref={pageRef}>
    <PageShell wide>
      <PageHeader eyebrow="Nº 02 — PROJECT BRIEF" title="项目任务">
        先强化输入：材料、仓库、模式；再追踪输出：任务状态、阶段事件、文档与分享。已勾选 <b>{selectedReferenceIds.length}</b> 份材料。
      </PageHeader>

      <ProjectStatusHero loading={workflows.isLoading} error={workflows.isError} latest={latest} workflows={workflows.data?.workflows ?? []} onRefresh={() => void workflows.refetch()} />

      <div ref={ioRef} className="project-io-strip mt-8" aria-label="输入输出流程">
        <IoStep n="01" t="输入材料" d="上传材料，解析后勾选固定" />
        <IoStep n="02" t="启动流水线" d="选择模式，生成一次可追溯任务" />
        <IoStep n="03" t="查询输出" d="进入监控、文档、分享和来源记录" />
      </div>

      <div className="boule-grid boule-grid--2 mt-8 project-detail-grid">
        <Panel>
          <PanelHeader k="A / INPUT REFERENCES" title="项目材料" >上传、解析、勾选要固定进本次任务的材料；输入越明确，输出越可查询。</PanelHeader>
          <div className="boule-panel-body">{id && <ProjectReferencesPanel projectId={id} selectedIds={selectedReferenceIds} onSelectedIdsChange={setSelectedReferenceIds} />}</div>
        </Panel>

        <div className="space-y-6">
          <Panel>
            <PanelHeader k="B / LAUNCH" title="启动模式">每个按钮都是一条输出路径；先选目标产物，再让 AI 跑。</PanelHeader>
            <div className="boule-panel-body space-y-4">
              {start.isError && <ErrorBanner severity="P0" message="启动任务失败（可能权限不足或数据源未配置）" />}
              {skippedReferences.length > 0 && (
                <div className="space-y-3">
                  <ErrorBanner severity="P1" message={`${skippedReferences.length} 份材料因解析失败或不存在未纳入本次任务。`} />
                  {createdWorkflowId && <Button variant="secondary" onClick={() => nav(`/workflows/${createdWorkflowId}`)}>继续查看任务</Button>}
                </div>
              )}
              <div ref={modeRef} className="mode-grid">
                {MODES.map((m, i) => (
                  <button key={m.name} disabled={start.isPending} onClick={() => start.mutate(m.name)} className="mode-card">
                    <div className="mode-card__meta">MODE {String(i + 1).padStart(2, "0")}</div>
                    <div className="mode-card__title">{m.name}</div>
                    <div className="mode-card__hint">{m.hint}</div>
                    <span>启动 →</span>
                  </button>
                ))}
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader k="C / WORKSPACE" title="关联 Git 仓库">让 AI 在真实仓库 / 服务端副本上执行。</PanelHeader>
            <div className="boule-panel-body space-y-3">
              <div className="workspace-link-row">
                <SelectInput value={linkMode} onChange={(e) => setLinkMode(e.target.value as LinkMode)}>
                  <option value="gitUrl">Git 地址（团队/本地）</option>
                  <option value="localDir">本地目录（仅本地模式）</option>
                </SelectInput>
                <TextInput value={value} onChange={(e) => setValue(e.target.value)} placeholder={linkMode === "gitUrl" ? "https://github.com/you/repo.git" : "/Users/you/repo"} />
              </div>
              <Button variant="secondary" disabled={link.isPending || value.trim() === ""} onClick={() => link.mutate()}>关联工作区</Button>
              {linkErr && <ErrorBanner severity="P1" message={linkErr} />}
              {link.isSuccess && <Badge tone="blue">已关联 · {LINK_MODE_LABELS[link.data.linkMode] ?? link.data.linkMode}</Badge>}
            </div>
          </Panel>
        </div>
      </div>
    </PageShell>
    </div>
  );
}

function ProjectStatusHero({ loading, error, latest, workflows, onRefresh }: { loading: boolean; error: boolean; latest?: ProjectWorkflow; workflows: ProjectWorkflow[]; onRefresh: () => void }) {
  const active = workflows.filter((w) => w.status === "running" || w.status === "paused_for_approval").length;
  const phase = latest ? phaseLabel(latest.currentPhase) : "暂无运行";
  return (
    <section className="project-status-hero mt-8">
      <div className="project-status-hero__main">
        <div className="boule-eyebrow">LIVE STATUS / 状态监控</div>
        <h2>{latest ? statusLabel(latest.status) : "等待启动"}</h2>
        <p>{latest ? `最新任务：${latest.mode ?? "未指定模式"} · ${phase}` : "上传材料并选择模式后，这里会成为最显眼的运行监控入口。"}</p>
      </div>
      <div className="project-status-hero__metrics">
        <StatusKpi label="进行中" value={String(active)} />
        <StatusKpi label="任务数" value={String(workflows.length)} />
        <StatusKpi label="阶段" value={latest ? phase : "—"} small />
      </div>
      <div className="project-status-hero__side">
        {loading ? <Skeleton rows={2} /> : error ? <ErrorBanner severity="P1" message="加载状态失败" onRetry={onRefresh} /> : latest ? <Link className="project-status-open" to={`/workflows/${latest.id}`}>打开最新监控 →</Link> : <span className="project-status-open project-status-open--idle">还没有任务</span>}
        <div className="project-run-list">
          {workflows.slice(0, 3).map((w) => <Link key={w.id} to={`/workflows/${w.id}`}><b>{w.mode ?? "—"}</b><span>{phaseLabel(w.currentPhase)} · {statusLabel(w.status)}</span></Link>)}
        </div>
      </div>
    </section>
  );
}

function StatusKpi({ label, value, small = false }: { label: string; value: string; small?: boolean }) {
  const valueRef = useRef<HTMLElement>(null);
  const numeric = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  useCountUp(valueRef, numeric, { dependencies: [value] });
  return <div className="project-status-kpi"><span>{label}</span><b ref={valueRef} className={small ? "project-status-kpi__small" : ""}>{value}</b></div>;
}

function IoStep({ n, t, d }: { n: string; t: string; d: string }) {
  return <div><span>{n}</span><b>{t}</b><small>{d}</small></div>;
}

function phaseLabel(id: string) {
  return PHASE_LABELS.find((p) => p.id === id)?.label ?? id;
}
