/**
 * Agent 监控 dashboard（U8 / P1）。顶部 KPI + 进度/验证 tab。
 * 6 态：空(未启动)/加载 KPI skeleton/内容/错误 P1(部分数据缺失)/SSE 断线冻结徽章。
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../stores/auth.ts";
import { useWorkflow } from "../../stores/workflow.ts";
import { kpisFromCost, type CostBreakdown } from "../../lib/derive.ts";
import { Skeleton, ErrorBanner } from "../../components/States.tsx";
import { CostChart } from "./CostChart.tsx";
import { AgentJobList } from "./AgentJobList.tsx";
import { VerdictView, type ClaimVerdict } from "./VerdictView.tsx";

export function Dashboard({ workflowId, verdicts = [] }: { workflowId: string; verdicts?: ClaimVerdict[] }) {
  const api = useAuth((s) => s.api);
  const connection = useWorkflow((s) => s.connection);
  const [tab, setTab] = useState<"progress" | "verify">("progress");
  const frozen = connection === "reconnecting";

  const cost = useQuery({
    queryKey: ["cost", workflowId],
    queryFn: () => api.json<CostBreakdown>(`/api/workflows/${workflowId}/cost`),
    refetchInterval: frozen ? false : 5000,
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-neutral-100 p-1 text-sm">
          {(["progress", "verify"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded px-3 py-1 ${tab === t ? "bg-white shadow-sm" : "text-neutral-500"}`}
            >
              {t === "progress" ? "进度" : "验证"}
            </button>
          ))}
        </div>
        {frozen && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">数据暂停更新</span>}
      </div>

      {tab === "progress" ? (
        cost.isLoading ? (
          <Skeleton rows={4} />
        ) : cost.isError ? (
          <ErrorBanner severity="P1" message="部分 agent 数据缺失" onRetry={() => void cost.refetch()} />
        ) : (
          <ProgressTab cost={cost.data!} />
        )
      ) : (
        <VerdictView verdicts={verdicts} />
      )}
    </div>
  );
}

function ProgressTab({ cost }: { cost: CostBreakdown }) {
  const kpis = kpisFromCost(cost);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="总 token" value={kpis.totalTokens.toLocaleString()} />
        <Kpi label="总成本" value={`$${kpis.totalCostUsd.toFixed(2)}`} />
        <Kpi label="agent 数" value={String(kpis.jobCount)} />
      </div>
      <section>
        <h3 className="mb-2 text-sm text-neutral-500">各 phase 成本</h3>
        <CostChart data={cost.byPhase.map((p) => ({ phase: p.phase ?? "—", costUsd: p.costUsd }))} />
      </section>
      <section>
        <h3 className="mb-2 text-sm text-neutral-500">Agent 明细</h3>
        <AgentJobList jobs={cost.byJob} />
      </section>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 font-serif text-2xl">{value}</div>
    </div>
  );
}
