import { PhaseCard } from "./PhaseCard.tsx";
import { RealtimeEventFeed } from "./RealtimeEventFeed.tsx";
import { PHASE_LABELS } from "../../lib/phases.ts";
import { phaseStatus } from "../../lib/derive.ts";
import { eventsForPhase, normalizeWorkflowEvents } from "../../lib/workflow-events.ts";
import { Skeleton, EmptyState, ErrorBanner } from "../../components/States.tsx";
import type { Decision } from "../../components/CheckpointCard.tsx";
import type { SseEvent } from "../../lib/sse.ts";

export interface TimelineProps { currentPhase?: string; workflowStatus?: string; loading?: boolean; error?: string | null; offline?: boolean; canDecide?: boolean; busy?: boolean; belowThresholdPhases?: Set<string>; events?: SseEvent[]; onDecide?: (d: Decision) => void; onRetry?: () => void; }

export function Timeline(props: TimelineProps) {
  if (props.loading) return <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} rows={2} />)}</div>;
  if (props.error) return <ErrorBanner severity="P0" message={props.error} onRetry={props.onRetry} />;
  if (!props.currentPhase) return <EmptyState title="暂无任务" hint="在项目页选择模式启动一次任务。" />;
  const normalizedEvents = normalizeWorkflowEvents(props.events ?? []);
  const currentPhaseEvents = eventsForPhase(normalizedEvents, props.currentPhase).slice(-5);
  return (
    <div className="space-y-5">
      {props.offline && <ErrorBanner severity="P1" message="连接中断，进度可能延迟" />}
      <ol className="space-y-4 border-l-4 border-black pl-6">
        {PHASE_LABELS.map((p, i) => {
          const status = phaseStatus(p.id, props.currentPhase!, props.workflowStatus ?? "running");
          const current = p.id === props.currentPhase;
          return (
            <li key={p.id} className="relative">
              <span className="absolute -left-[39px] top-4 grid h-7 w-7 place-items-center border-2 border-black bg-[var(--boule-paper)] font-[var(--boule-mono)] text-[10px] font-black">{String(i + 1).padStart(2, "0")}</span>
              <PhaseCard label={p.label} note={p.note} status={status} current={current} belowThreshold={props.belowThresholdPhases?.has(p.id)} canDecide={props.canDecide} busy={props.busy} onDecide={props.onDecide} />
              {current && currentPhaseEvents.length > 0 && <div className="mt-3"><RealtimeEventFeed events={props.events ?? []} currentPhase={props.currentPhase} offline={props.offline} limit={5} compact phaseOnly /></div>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
