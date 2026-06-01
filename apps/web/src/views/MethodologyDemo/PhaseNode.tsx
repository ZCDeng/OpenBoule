import { Handle, Position } from "@xyflow/react";
import type { PhaseRunStatus } from "../../lib/derive.ts";

export interface PhaseNodeData { label: string; note: string; sampleOutputs?: number; status?: PhaseRunStatus; onOpen?: () => void; [key: string]: unknown; }

const STATUS_COLOR: Record<PhaseRunStatus, string> = {
  waiting: "bg-[var(--boule-paper)]",
  running: "bg-[var(--boule-blue)] text-white",
  completed: "bg-black text-white",
  needs_approval: "bg-[var(--boule-orange)] text-white",
  rejected: "bg-red-600 text-white",
};

export function PhaseNode({ data }: { data: PhaseNodeData }) {
  const color = data.status ? STATUS_COLOR[data.status] : "bg-[var(--boule-paper)]";
  return (
    <button onClick={data.onOpen} className={`w-56 border-2 border-black px-4 py-3 text-left shadow-[4px_4px_0_#0B0B0B] ${color}`}>
      <Handle type="target" position={Position.Top} className="!border-2 !border-black !bg-[var(--boule-blue)]" />
      <div className="font-[var(--boule-disp)] text-lg font-black tracking-[-0.03em]">{data.label}</div>
      <div className="mt-1 text-xs opacity-75">{data.note}</div>
      {typeof data.sampleOutputs === "number" && <div className="mt-2 font-[var(--boule-mono)] text-[10px] uppercase tracking-[0.1em] opacity-60">示例产出 · {data.sampleOutputs}</div>}
      <Handle type="source" position={Position.Bottom} className="!border-2 !border-black !bg-[var(--boule-blue)]" />
    </button>
  );
}
