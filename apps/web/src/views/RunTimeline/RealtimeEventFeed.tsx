import type { SseEvent } from "../../lib/sse.ts";
import { normalizeWorkflowEvents, type WorkflowEventItem } from "../../lib/workflow-events.ts";

const TONE_CLASS: Record<WorkflowEventItem["tone"], string> = {
  neutral: "border-neutral-200 bg-white",
  blue: "border-blue-200 bg-blue-50",
  green: "border-green-200 bg-green-50",
  amber: "border-amber-200 bg-amber-50",
  red: "border-red-200 bg-red-50",
};

export function RealtimeEventFeed({
  events,
  currentPhase,
  offline,
  limit = 30,
  compact = false,
  phaseOnly = false,
}: {
  events: readonly SseEvent[];
  currentPhase?: string;
  offline?: boolean;
  limit?: number;
  compact?: boolean;
  phaseOnly?: boolean;
}) {
  const normalized = normalizeWorkflowEvents(events);
  const items = (phaseOnly && currentPhase ? normalized.filter((item) => item.phase === currentPhase) : normalized).slice(-limit).reverse();

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm text-neutral-500">实时事件流</h3>
        {offline && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">数据暂停更新</span>}
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-200 bg-white p-4 text-sm text-neutral-400">暂无实时事件</p>
      ) : (
        <ol className="space-y-2">
          {items.map((item) => {
            const active = currentPhase && item.phase === currentPhase;
            return (
              <li key={item.id} className={`rounded-lg border p-3 text-sm ${TONE_CLASS[item.tone]} ${active ? "ring-1 ring-amber-300" : ""}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-neutral-800">{item.title}</span>
                  {item.phase && <span className="rounded bg-white/70 px-1.5 py-0.5 text-xs text-neutral-500">{item.phase}</span>}
                  <span className="ml-auto text-xs text-neutral-400">#{item.eventId}</span>
                </div>
                <p className="mt-1 text-xs text-neutral-600">{item.summary}</p>
                {!compact && (
                  <details className="mt-2 text-xs text-neutral-500">
                    <summary className="cursor-pointer">原始事件</summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded bg-white/80 p-2">{JSON.stringify(item.raw, null, 2)}</pre>
                  </details>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
