import type { PhaseRunStatus, Verdict } from "../../lib/derive.ts";
import type { Decision } from "../../components/CheckpointCard.tsx";

const STATUS_META: Record<PhaseRunStatus, { label: string; dot: string }> = {
  waiting: { label: "等待中", dot: "bg-neutral-300" },
  running: { label: "进行中", dot: "bg-blue-500" },
  completed: { label: "已完成", dot: "bg-green-500" },
  needs_approval: { label: "需审批", dot: "bg-amber-500" },
  rejected: { label: "已拒绝", dot: "bg-red-500" },
};

export interface PhaseCardProps {
  label: string;
  note: string;
  status: PhaseRunStatus;
  current?: boolean;
  tokens?: number;
  agents?: string[];
  belowThreshold?: boolean;
  canDecide?: boolean;
  busy?: boolean;
  onDecide?: (d: Decision) => void;
}

export function PhaseCard(props: PhaseCardProps) {
  const meta = STATUS_META[props.status];
  return (
    <div className={`relative rounded-lg border bg-white p-4 ${props.current ? "border-amber-400 ring-1 ring-amber-200" : "border-neutral-200"}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
        <h3 className="font-serif text-sm">{props.label}</h3>
        <span className="ml-auto text-xs text-neutral-500">{meta.label}</span>
      </div>
      <p className="mt-1 text-xs text-neutral-500">{props.note}</p>

      <div className="mt-2 flex flex-wrap gap-3 text-xs text-neutral-400">
        {typeof props.tokens === "number" && <span>token {props.tokens.toLocaleString()}</span>}
        {props.agents && props.agents.length > 0 && <span>agent {props.agents.length}</span>}
        {props.belowThreshold && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700" title="三筛子未清必修项，取最高稿兜底">
            ⚠ 未达放行闸
          </span>
        )}
      </div>

      {/* 审批按钮 inline，仅 needs_approval + 有决策权时显示（viewer 隐藏） */}
      {props.status === "needs_approval" && props.canDecide && props.onDecide && (
        <div className="mt-3 flex gap-2">
          {(["approve", "redo", "augment"] as const).map((d) => (
            <button
              key={d}
              disabled={props.busy}
              onClick={() => props.onDecide!(d)}
              className="rounded border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-50 disabled:opacity-50"
            >
              {{ approve: "继续", redo: "重跑", augment: "补研究" }[d]}
            </button>
          ))}
        </div>
      )}
      {props.status === "needs_approval" && !props.canDecide && (
        <p className="mt-3 text-xs text-neutral-400">只读角色不可决策</p>
      )}
    </div>
  );
}

export type { Verdict };
