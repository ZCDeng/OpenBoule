import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../stores/auth.ts";
import { useWorkflow } from "../stores/workflow.ts";
import { SseClient, type EventSourceLike } from "../lib/sse.ts";
import { surfaceEventFromSse } from "../lib/workflow-events.ts";
import { Timeline } from "../views/RunTimeline/Timeline.tsx";
import { Dashboard } from "../views/AgentMonitor/Dashboard.tsx";
import { Workspace } from "../views/DocumentWorkspace/Workspace.tsx";
import { FrozenReferences } from "../views/ProjectInputs/FrozenReferences.tsx";
import { SharePanel } from "../views/ReportShare/SharePanel.tsx";
import type { Decision } from "../components/CheckpointCard.tsx";
import { ErrorBanner } from "../components/States.tsx";
import { ApiError } from "../lib/api.ts";

interface WorkflowStatus {
  id: string;
  currentPhase: string;
  status: string;
  mode: string | null;
  myRole?: "external" | "viewer" | "editor" | "owner";
}

const STATUS_REFETCH_EVENTS = new Set([
  "workflow-status-changed",
  "workflow-completed",
  "workflow-recovered",
  "workflow-rerun-requested",
  "surface_request",
  "surface_response",
]);

export function WorkflowPage() {
  const { id } = useParams<{ id: string }>();
  const api = useAuth((s) => s.api);
  const setConnection = useWorkflow((s) => s.setConnection);
  const pushEvent = useWorkflow((s) => s.pushEvent);
  const clearEvents = useWorkflow((s) => s.clearEvents);
  const resetSurfaces = useWorkflow((s) => s.resetSurfaces);
  const applySurface = useWorkflow((s) => s.applySurface);
  const connection = useWorkflow((s) => s.connection);
  const recentEvents = useWorkflow((s) => s.recentEvents);
  const [tab, setTab] = useState<"timeline" | "monitor" | "docs" | "share">("timeline");
  const [busy, setBusy] = useState(false);
  const [decisionError, setDecisionError] = useState<{ severity: "P0" | "P1"; msg: string } | null>(null);

  const status = useQuery({
    queryKey: ["workflow", id],
    queryFn: () => api.json<WorkflowStatus>(`/api/workflows/${id}`),
  });

  useEffect(() => {
    if (!id) return;
    clearEvents();
    resetSurfaces();
    const client = new SseClient({
      baseUrl: `/api/sse/workflows/${id}`,
      ticketProvider: async () => (await api.json<{ ticket: string }>("/api/sse/ticket", { method: "POST" })).ticket,
      eventSourceFactory: (url) => new EventSource(url) as unknown as EventSourceLike,
      onEvent: (e) => {
        pushEvent(e);
        const surface = surfaceEventFromSse(e);
        if (surface) applySurface(surface);
        if (STATUS_REFETCH_EVENTS.has(e.event)) void status.refetch();
      },
      onStateChange: setConnection,
    });
    void client.connect();
    return () => client.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function decide(d: Decision) {
    setBusy(true);
    setDecisionError(null);
    try {
      await api.json(`/api/workflows/${id}/${d}`, { method: "POST" });
      await status.refetch();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setDecisionError({ severity: "P0", msg: "权限不足，无法决策（需 Editor）" });
      else if (err instanceof ApiError && err.status === 409) setDecisionError({ severity: "P1", msg: "该 checkpoint 已被处理，请刷新" });
      else setDecisionError({ severity: "P0", msg: "操作失败，请重试" });
    } finally {
      setBusy(false);
    }
  }

  const wf = status.data;
  const canDecide = wf?.myRole === "editor" || wf?.myRole === "owner";
  const offline = connection === "reconnecting";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl">工作流 · {wf?.mode ?? "—"}</h1>
        <span className="text-xs text-neutral-500">{connection === "open" ? "● 实时" : offline ? "○ 重连中" : "○"}</span>
      </div>

      <div className="flex gap-1 rounded-lg bg-neutral-100 p-1 text-sm">
        {(["timeline", "monitor", "docs", "share"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded px-3 py-1 ${tab === t ? "bg-white shadow-sm" : "text-neutral-500"}`}>
            {{ timeline: "时间线", monitor: "Agent 监控", docs: "文档", share: "分享" }[t]}
          </button>
        ))}
      </div>

      {decisionError && <ErrorBanner severity={decisionError.severity} message={decisionError.msg} />}

      {tab === "timeline" ? (
        <Timeline
          currentPhase={wf?.currentPhase}
          workflowStatus={wf?.status}
          loading={status.isLoading}
          error={status.isError ? "加载工作流失败（引擎可能不可用）" : null}
          offline={offline}
          canDecide={canDecide}
          busy={busy}
          events={recentEvents}
          onDecide={decide}
          onRetry={() => void status.refetch()}
        />
      ) : tab === "monitor" ? (
        id && <Dashboard workflowId={id} currentPhase={wf?.currentPhase} events={recentEvents} />
      ) : tab === "docs" ? (
        id && (
          <div className="space-y-4">
            <FrozenReferences workflowId={id} />
            <Workspace workflowId={id} />
          </div>
        )
      ) : (
        id && <SharePanel workflowId={id} />
      )}
    </div>
  );
}
