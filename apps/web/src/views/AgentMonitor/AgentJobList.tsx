import { useRef, useState } from "react";
import { phaseLabel } from "../../lib/labels.ts";
import { useStaggerIn } from "../../hooks/useStaggerIn.ts";

export interface AgentJobRow { jobId: string | null; phase: string | null; costUsd: number; tokens: { inputTokens: number; outputTokens: number }; }
const ROW_H = 44;
const VIEWPORT_H = 320;
const OVERSCAN = 3;

export function AgentJobList({ jobs }: { jobs: AgentJobRow[] }) {
  const [scrollTop, setScrollTop] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useStaggerIn(listRef, "[data-agent-job-row]", { y: 8, duration: 0.32, stagger: 0.04, dependencies: [jobs.length] });
  if (jobs.length === 0) return <p className="rounded-[var(--md-shape-md)] border border-dashed border-[var(--md-outline-variant)] p-4 text-[12px] text-[var(--md-on-surface-variant)]">启动一个任务后在此查看执行明细。</p>;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(jobs.length, Math.ceil((scrollTop + VIEWPORT_H) / ROW_H) + OVERSCAN);
  const visible = jobs.slice(start, end);
  return (
    <div className="overflow-auto rounded-[var(--md-shape-md)] border border-[var(--md-outline-variant)] bg-[var(--md-surface-container-low)]" style={{ height: VIEWPORT_H }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <div ref={listRef} style={{ height: jobs.length * ROW_H, position: "relative" }}>
        {visible.map((j, i) => {
          const idx = start + i;
          return (
            <div key={j.jobId ?? idx} data-agent-job-row className="flex items-center gap-3 border-b border-[var(--md-outline-variant)] px-3 text-sm text-[var(--md-on-surface)]" style={{ position: "absolute", top: idx * ROW_H, height: ROW_H, left: 0, right: 0 }}>
              <span className="w-28 truncate text-[12px] font-medium text-[var(--md-primary)]">{phaseLabel(j.phase)}</span>
              <span className="flex-1 truncate text-[12px] text-[var(--md-on-surface-variant)]">执行 {j.jobId ? j.jobId.slice(0, 8) : "—"}</span>
              <span className="text-xs">{(j.tokens.inputTokens + j.tokens.outputTokens).toLocaleString()} Token</span>
              <span className="w-16 text-right text-xs font-semibold">${j.costUsd.toFixed(3)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
