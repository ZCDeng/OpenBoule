import { Handle, Position } from "@xyflow/react";
import type { PhaseRunStatus } from "../../lib/derive.ts";

export interface PhaseNodeData {
  label: string;
  note: string;
  sampleOutputs?: number;
  status?: PhaseRunStatus;
  onOpen?: () => void;
  [key: string]: unknown;
}

const STATUS_COLOR: Record<PhaseRunStatus, string> = {
  waiting: "bg-neutral-100 border-neutral-300",
  running: "bg-blue-50 border-blue-400",
  completed: "bg-green-50 border-green-400",
  needs_approval: "bg-amber-50 border-amber-400",
  rejected: "bg-red-50 border-red-400",
};

/** React Flow 自定义节点：状态色块 + phase 名 + 示例产出数，点击展开详情。 */
export function PhaseNode({ data }: { data: PhaseNodeData }) {
  const color = data.status ? STATUS_COLOR[data.status] : "bg-white border-neutral-300";
  return (
    <button onClick={data.onOpen} className={`w-56 rounded-lg border px-4 py-3 text-left shadow-sm ${color}`}>
      <Handle type="target" position={Position.Top} className="!bg-neutral-400" />
      <div className="font-serif text-sm">{data.label}</div>
      <div className="mt-1 text-xs text-neutral-500">{data.note}</div>
      {typeof data.sampleOutputs === "number" && (
        <div className="mt-2 text-xs text-neutral-400">示例产出 · {data.sampleOutputs}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-neutral-400" />
    </button>
  );
}
