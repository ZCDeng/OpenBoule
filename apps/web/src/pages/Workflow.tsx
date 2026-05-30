import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../stores/auth.ts";
import { useWorkflow } from "../stores/workflow.ts";
import { SseClient, type EventSourceLike } from "../lib/sse.ts";
import { CheckpointCard, type Decision } from "../components/CheckpointCard.tsx";
import { Skeleton, ErrorBanner, PermissionDenied } from "../components/States.tsx";
import { ApiError } from "../lib/api.ts";

interface WorkflowStatus {
  id: string;
  currentPhase: string;
  status: string;
  mode: string | null;
}

export function WorkflowPage() {
  const { id } = useParams<{ id: string }>();
  const api = useAuth((s) => s.api);
  const setConnection = useWorkflow((s) => s.setConnection);
  const pushEvent = useWorkflow((s) => s.pushEvent);
  const connection = useWorkflow((s) => s.connection);
  const [busy, setBusy] = useState(false);
  const [decisionError, setDecisionError] = useState<{ severity: "P0" | "P1"; msg: string } | null>(null);
  const [denied, setDenied] = useState(false);

  const status = useQuery({
    queryKey: ["workflow", id],
    queryFn: () => api.json<WorkflowStatus>(`/api/workflows/${id}`),
  });

  // SSE：每次（重）连取新一次性 ticket，断点续传由 SseClient 带 lastEventId
  useEffect(() => {
    if (!id) return;
    const client = new SseClient({
      baseUrl: `/api/sse/workflows/${id}`,
      ticketProvider: async () => (await api.json<{ ticket: string }>("/api/sse/ticket", { method: "POST" })).ticket,
      eventSourceFactory: (url) => new EventSource(url) as unknown as EventSourceLike,
      onEvent: (e) => {
        pushEvent(e);
        void status.refetch(); // 状态变更 → 刷新 workflow 状态
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
      if (err instanceof ApiError && err.status === 403) setDenied(true);
      else if (err instanceof ApiError && err.status === 409) setDecisionError({ severity: "P1", msg: "该 checkpoint 已被他人处理（请刷新）" });
      else setDecisionError({ severity: "P0", msg: "操作失败，请重试" });
    } finally {
      setBusy(false);
    }
  }

  if (status.isLoading) return <Skeleton rows={5} />;
  if (status.isError) return <ErrorBanner severity="P0" message="加载工作流失败" onRetry={() => void status.refetch()} />;
  const wf = status.data!;
  const paused = wf.status === "paused_for_approval";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl">工作流 · {wf.mode ?? "—"}</h1>
        <span className="text-xs text-neutral-500">{connection === "open" ? "● 实时" : connection === "reconnecting" ? "○ 重连中" : "○"}</span>
      </div>
      <div className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm">
        当前阶段：<span className="font-medium">{wf.currentPhase}</span> · 状态：{wf.status}
      </div>

      {decisionError && <ErrorBanner severity={decisionError.severity} message={decisionError.msg} />}
      {denied && <PermissionDenied need="Editor" />}

      {paused && !denied && (
        <CheckpointCard
          surface={{ id: wf.currentPhase, phase: wf.currentPhase, schemaDigest: wf.currentPhase, status: "pending" }}
          canDecide
          busy={busy}
          onDecide={decide}
        />
      )}
      {!paused && <p className="text-sm text-neutral-500">运行中，等待下一个 checkpoint…</p>}
    </div>
  );
}
