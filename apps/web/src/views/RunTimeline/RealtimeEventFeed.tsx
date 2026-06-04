import { useEffect, useRef } from "react";
import type { SseEvent } from "../../lib/sse.ts";
import { normalizeWorkflowEvents, type WorkflowEventItem } from "../../lib/workflow-events.ts";
import { phaseLabel } from "../../lib/labels.ts";
import { Badge } from "../../components/Brutalist.tsx";
import { gsap, shouldAnimate } from "../../lib/gsap.ts";

const TONE_CLASS: Record<WorkflowEventItem["tone"], string> = {
  neutral: "bg-[var(--boule-paper)]",
  blue: "bg-[var(--boule-blue)] text-white",
  green: "bg-[var(--panel-dark-bg)] text-white",
  amber: "bg-[var(--boule-orange)] text-white",
  red: "bg-[var(--boule-red)] text-white",
};

export function RealtimeEventFeed({ events, currentPhase, offline, limit = 30, compact = false, phaseOnly = false }: { events: readonly SseEvent[]; currentPhase?: string; offline?: boolean; limit?: number; compact?: boolean; phaseOnly?: boolean }) {
  const normalized = normalizeWorkflowEvents(events);
  const items = (phaseOnly && currentPhase ? normalized.filter((item) => item.phase === currentPhase) : normalized).slice(-limit).reverse();
  const listRef = useRef<HTMLOListElement>(null);
  const previousIdsRef = useRef<Set<string>>(new Set(items.map((item) => item.id)));

  useEffect(() => {
    const previousIds = previousIdsRef.current;
    const nextIds = new Set(items.map((item) => item.id));
    const newIds = items.filter((item) => !previousIds.has(item.id)).map((item) => item.id);
    previousIdsRef.current = nextIds;
    if (newIds.length === 0 || !listRef.current || !shouldAnimate()) return;
    const targets = newIds
      .map((id) => listRef.current?.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(id)}"]`))
      .filter((el): el is HTMLElement => Boolean(el));
    if (targets.length === 0) return;
    gsap.from(targets, {
      opacity: 0,
      y: newIds.length > 5 ? 0 : -8,
      duration: newIds.length > 5 ? 0.2 : 0.25,
      stagger: newIds.length > 5 ? 0 : 0.035,
      clearProps: "opacity,transform",
    });
  }, [items]);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 border-b-2 border-[var(--app-fg)] pb-2">
        <h3 className="font-[var(--boule-disp)] text-2xl font-black tracking-[-0.03em]">实时事件流</h3>
        {offline && <Badge tone="orange">数据暂停更新</Badge>}
      </div>
      {items.length === 0 ? <p className="border-2 border-dashed border-[var(--app-fg)] p-4 font-[var(--boule-mono)] text-xs uppercase tracking-[0.1em] text-[var(--boule-muted)]">暂无实时事件</p> : (
        <ol ref={listRef} className="space-y-2">
          {items.map((item) => {
            const active = currentPhase && item.phase === currentPhase;
            return (
              <li key={item.id} data-event-id={item.id} className={`border-2 border-[var(--app-fg)] p-3 text-sm shadow-[3px_3px_0_var(--app-fg)] ${TONE_CLASS[item.tone]} ${active ? "outline outline-2 outline-[var(--boule-blue)]" : ""}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-[var(--boule-disp)] font-black tracking-[-0.02em]">{item.title}</span>
                  {item.phase && <span className="border border-current px-1.5 py-0.5 font-[var(--boule-mono)] text-[10px] uppercase tracking-[0.08em]">{phaseLabel(item.phase)}</span>}
                  <span className="ml-auto font-[var(--boule-mono)] text-[10px] opacity-65">#{item.eventId}</span>
                </div>
                <p className="mt-1 text-xs opacity-80">{item.summary}</p>
                {!compact && <details className="mt-2 text-xs"><summary className="cursor-pointer font-[var(--boule-mono)] uppercase tracking-[0.08em]">技术详情</summary><pre className="mt-2 max-h-48 overflow-auto border-2 border-current bg-transparent p-2">{JSON.stringify(item.raw, null, 2)}</pre></details>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
