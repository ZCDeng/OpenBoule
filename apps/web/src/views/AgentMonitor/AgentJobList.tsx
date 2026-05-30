/**
 * Agent job 列表（U8）。窗口化渲染——大量 job（如 13 个 verifier）只渲染可视区，避免卡顿。
 * 固定行高 + onScroll 切片 + overscan，纯 JS 无虚拟列表库。
 */

import { useState } from "react";

export interface AgentJobRow {
  jobId: string | null;
  phase: string | null;
  costUsd: number;
  tokens: { inputTokens: number; outputTokens: number };
}

const ROW_H = 44;
const VIEWPORT_H = 320;
const OVERSCAN = 3;

export function AgentJobList({ jobs }: { jobs: AgentJobRow[] }) {
  const [scrollTop, setScrollTop] = useState(0);
  if (jobs.length === 0) {
    return <p className="text-sm text-neutral-400">启动一个 run 后在此查看 agent 明细。</p>;
  }
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(jobs.length, Math.ceil((scrollTop + VIEWPORT_H) / ROW_H) + OVERSCAN);
  const visible = jobs.slice(start, end);

  return (
    <div
      className="overflow-auto rounded border border-neutral-200"
      style={{ height: VIEWPORT_H }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: jobs.length * ROW_H, position: "relative" }}>
        {visible.map((j, i) => {
          const idx = start + i;
          return (
            <div
              key={j.jobId ?? idx}
              className="flex items-center gap-3 border-b border-neutral-100 px-3 text-sm"
              style={{ position: "absolute", top: idx * ROW_H, height: ROW_H, left: 0, right: 0 }}
            >
              <span className="w-24 truncate text-neutral-500">{j.phase ?? "—"}</span>
              <span className="flex-1 truncate text-xs text-neutral-400">{j.jobId ?? "—"}</span>
              <span className="text-xs">{(j.tokens.inputTokens + j.tokens.outputTokens).toLocaleString()} tok</span>
              <span className="w-16 text-right text-xs">${j.costUsd.toFixed(3)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
