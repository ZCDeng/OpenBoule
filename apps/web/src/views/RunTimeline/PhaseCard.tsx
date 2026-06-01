import type { PhaseRunStatus, Verdict } from "../../lib/derive.ts";
import type { Decision } from "../../components/CheckpointCard.tsx";
import { Badge, Button } from "../../components/Brutalist.tsx";

const STATUS_META: Record<PhaseRunStatus, { label: string; tone: "plain" | "blue" | "orange" | "dark" }> = {
  waiting: { label: "等待中", tone: "plain" },
  running: { label: "进行中", tone: "blue" },
  completed: { label: "已完成", tone: "dark" },
  needs_approval: { label: "需审批", tone: "orange" },
  rejected: { label: "已拒绝", tone: "orange" },
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
    <div className={`relative border-2 border-black bg-[var(--boule-paper)] p-4 ${props.current ? "shadow-[6px_6px_0_#1A18EE]" : "shadow-[4px_4px_0_#0B0B0B]"}`}>
      <div className="flex items-start gap-3">
        <div className="mt-1 h-3 w-3 shrink-0 border-2 border-black bg-[var(--boule-blue)]" />
        <div className="min-w-0 flex-1">
          <h3 className="font-[var(--boule-disp)] text-xl font-black tracking-[-0.03em]">{props.label}</h3>
          <p className="mt-1 text-xs text-[#33332e]">{props.note}</p>
        </div>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 font-[var(--boule-mono)] text-[11px] uppercase tracking-[0.08em] text-[var(--boule-muted)]">
        {typeof props.tokens === "number" && <span>token {props.tokens.toLocaleString()}</span>}
        {props.agents && props.agents.length > 0 && <span>agent {props.agents.length}</span>}
        {props.belowThreshold && <Badge tone="orange">⚠ 未达放行闸</Badge>}
      </div>
      {props.status === "needs_approval" && props.canDecide && props.onDecide && (
        <div className="mt-4 flex flex-wrap gap-2">
          {(["approve", "redo", "augment"] as const).map((d) => <Button key={d} disabled={props.busy} variant={d === "approve" ? "primary" : "secondary"} onClick={() => props.onDecide!(d)}>{{ approve: "继续", redo: "重跑", augment: "补研究" }[d]}</Button>)}
        </div>
      )}
      {props.status === "needs_approval" && !props.canDecide && <p className="mt-3 font-[var(--boule-mono)] text-xs uppercase tracking-[0.1em] text-[var(--boule-muted)]">只读角色不可决策</p>}
    </div>
  );
}

export type { Verdict };
