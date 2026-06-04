import { Handle, Position } from "@xyflow/react";
import type { PhaseRunStatus } from "../../lib/derive.ts";

export interface PhaseNodeData { label: string; note: string; status?: PhaseRunStatus; onOpen?: () => void; [key: string]: unknown; }

const STATUS_COLOR: Record<PhaseRunStatus, string> = {
  waiting: "bg-[var(--boule-paper)]",
  running: "bg-[var(--boule-blue)] text-white",
  completed: "bg-[var(--panel-dark-bg)] text-white",
  needs_approval: "bg-[var(--boule-orange)] text-white",
  rejected: "bg-[var(--boule-red)] text-white",
};

export function PhaseNode({ data }: { data: PhaseNodeData }) {
  const color = data.status ? STATUS_COLOR[data.status] : "bg-[var(--boule-paper)]";
  return (
    <button onClick={data.onOpen} className={`w-56 border-2 border-[var(--app-fg)] px-4 py-3 text-left shadow-[4px_4px_0_var(--app-fg)] ${color}`}>
      <Handle type="target" position={Position.Top} className="!border-2 !border-[var(--app-fg)] !bg-[var(--boule-blue)]" />
      <div className="font-[var(--boule-disp)] text-lg font-black tracking-[-0.03em]">{data.label}</div>
      <div className="mt-1 text-xs opacity-75">{data.note}</div>
      <Handle type="source" position={Position.Bottom} className="!border-2 !border-[var(--app-fg)] !bg-[var(--boule-blue)]" />
    </button>
  );
}
