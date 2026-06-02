import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../stores/auth.ts";
import { useWorkflow } from "../../stores/workflow.ts";
import { kpisFromCost, type CostBreakdown } from "../../lib/derive.ts";
import { Skeleton, ErrorBanner } from "../../components/States.tsx";
import { Badge, Panel, PanelHeader } from "../../components/Brutalist.tsx";
import { CostChart } from "./CostChart.tsx";
import { AgentJobList } from "./AgentJobList.tsx";
import { VerdictView, type ClaimVerdict } from "./VerdictView.tsx";
import { RealtimeEventFeed } from "../RunTimeline/RealtimeEventFeed.tsx";
import type { SseEvent } from "../../lib/sse.ts";

export function Dashboard({ workflowId, currentPhase, events = [], verdicts = [] }: { workflowId: string; currentPhase?: string; events?: SseEvent[]; verdicts?: ClaimVerdict[] }) {
  const api = useAuth((s) => s.api);
  const connection = useWorkflow((s) => s.connection);
  const [tab, setTab] = useState<"progress" | "events" | "verify">("progress");
  const frozen = connection === "reconnecting";
  const cost = useQuery({ queryKey: ["cost", workflowId], queryFn: () => api.json<CostBreakdown>(`/api/workflows/${workflowId}/cost`), refetchInterval: frozen ? false : 5000 });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="boule-tabbar">{(["progress", "events", "verify"] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`boule-tab ${tab === t ? "boule-tab--active" : ""}`}>{{ progress: "进度", events: "事件", verify: "验证" }[t]}</button>)}</div>
        {frozen && <Badge tone="orange">数据暂停更新</Badge>}
      </div>
      {tab === "events" ? <RealtimeEventFeed events={events} currentPhase={currentPhase} offline={frozen} /> : tab === "progress" ? cost.isLoading ? <Skeleton rows={4} /> : cost.isError ? <ErrorBanner severity="P1" message="部分 agent 数据缺失" onRetry={() => void cost.refetch()} /> : <ProgressTab cost={cost.data!} /> : <VerdictView verdicts={verdicts} />}
    </div>
  );
}

function ProgressTab({ cost }: { cost: CostBreakdown }) {
  const kpis = kpisFromCost(cost);
  return (
    <div className="space-y-5">
      <div className="boule-grid boule-grid--3"><Kpi label="总 token" value={kpis.totalTokens.toLocaleString()} /><Kpi label="总成本" value={`$${kpis.totalCostUsd.toFixed(2)}`} /><Kpi label="agent 数" value={String(kpis.jobCount)} /></div>
      <Panel><PanelHeader k="COST" title="各 phase 成本" /><div className="boule-panel-body"><CostChart data={cost.byPhase.map((p) => ({ phase: p.phase ?? "—", costUsd: p.costUsd }))} /></div></Panel>
      <Panel><PanelHeader k="JOBS" title="Agent 明细" /><div className="boule-panel-body"><AgentJobList jobs={cost.byJob} /></div></Panel>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <div className="border-2 border-black bg-[var(--boule-paper)] p-4 shadow-[4px_4px_0_#0B0B0B]"><div className="font-[var(--boule-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--boule-muted)]">{label}</div><div className="mt-1 font-[var(--boule-disp)] text-4xl font-black tracking-[-0.05em]">{value}</div></div>;
}
