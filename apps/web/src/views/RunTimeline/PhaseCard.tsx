import type { PhaseRunStatus, Verdict } from "../../lib/derive.ts";
import type { Decision } from "../../components/CheckpointCard.tsx";
import { Badge, Button } from "../../components/Brutalist.tsx";

const STATUS_META: Record<PhaseRunStatus, { label: string; tone: "plain" | "blue" | "orange" | "dark" }> = {
  waiting: { label: "等待中", tone: "plain" },
  running: { label: "进行中", tone: "blue" },
  completed: { label: "已完成", tone: "dark" },
  needs_approval: { label: "待确认", tone: "orange" },
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
    <div className={`relative rounded-[var(--md-shape-md)] border p-4 ${props.current ? "border-[var(--md-primary)] bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)] shadow-[var(--md-elevation-2)]" : "border-[var(--md-outline-variant)] bg-[var(--md-surface)] shadow-[var(--md-elevation-1)]"}`}>
      <div className="flex items-start gap-3">
        <div className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--md-primary)]" />
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold tracking-[-0.01em] text-[var(--md-on-surface)]">{props.label}</h3>
          <p className="mt-1 text-xs text-[var(--md-on-surface-variant)]">{props.note}</p>
        </div>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[12px] text-[var(--md-on-surface-variant)]">
        {typeof props.tokens === "number" && <span>Token 用量 {props.tokens.toLocaleString()}</span>}
        {props.agents && props.agents.length > 0 && <span>调研单元 {props.agents.length}</span>}
        {props.belowThreshold && <Badge tone="orange">⚠ 未通过质量校验</Badge>}
      </div>
      {props.status === "needs_approval" && props.canDecide && props.onDecide && (
        <div className="mt-4 flex flex-wrap gap-2">
          {(["approve", "redo", "augment"] as const).map((d) => <Button key={d} disabled={props.busy} variant={d === "approve" ? "primary" : "secondary"} onClick={() => props.onDecide!(d)}>{{ approve: "继续", redo: "重跑", augment: "补充调研" }[d]}</Button>)}
        </div>
      )}
      {props.status === "needs_approval" && !props.canDecide && <p className="mt-3 text-[12px] text-[var(--md-on-surface-variant)]">只读角色不可决策</p>}
    </div>
  );
}

export type { Verdict };
