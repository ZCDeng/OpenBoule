/**
 * 视图模型派生（U8）。纯函数——把后端状态/成本转成视图所需结构，便于 node:test。
 * 组件只渲染这些派生结果，不在 JSX 里埋逻辑。
 */

import { PHASE_LABELS } from "./phases.ts";

const ORDER = PHASE_LABELS.map((p) => p.id);

export type PhaseRunStatus = "waiting" | "running" | "completed" | "needs_approval" | "rejected";

/** 时间线每 phase 的态：按 phase 顺序与当前 phase/workflow 状态推。 */
export function phaseStatus(phaseId: string, currentPhase: string, workflowStatus: string): PhaseRunStatus {
  const i = ORDER.indexOf(phaseId);
  const c = ORDER.indexOf(currentPhase);
  if (i < 0 || c < 0) return "waiting";
  if (i < c) return "completed";
  if (i > c) return "waiting";
  // i === c：当前 phase
  switch (workflowStatus) {
    case "paused_for_approval":
      return "needs_approval";
    case "approved":
      return "completed";
    case "rejected":
      return "rejected";
    default:
      return "running";
  }
}

// ── Phase 2.5 四态裁决徽章（KTD-21：徽章=代码裁决结果，非 verifier 自报）──

export type Verdict = "confirmed" | "salvage" | "killed" | "undetermined";
export type BadgeTone = "green" | "amber" | "red" | "neutral";

export function verdictBadge(v: Verdict): { label: string; tone: BadgeTone } {
  switch (v) {
    case "confirmed":
      return { label: "确认", tone: "green" };
    case "salvage":
      return { label: "挽救", tone: "amber" };
    case "killed":
      return { label: "驳回", tone: "red" };
    case "undetermined":
      return { label: "未裁定", tone: "neutral" };
  }
}

/** Phase 4 below_threshold 兜底徽章判定。 */
export function isBelowThreshold(artifactStatus: string | null | undefined): boolean {
  return artifactStatus === "below_threshold";
}

// ── 方法论图布局（线性链，确定性手算，不引 ELK.js）──

export interface LaidOutNode {
  id: string;
  x: number;
  y: number;
}

/** 垂直布局：i*gap，确定性、无重叠、保序。 */
export function layoutPhases(ids: string[] = ORDER, gap = 110, x = 0): LaidOutNode[] {
  return ids.map((id, i) => ({ id, x, y: i * gap }));
}

// ── Agent 监控 KPI ──

export interface CostBreakdown {
  runCostUsd: number;
  runTokens: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  byPhase: { phase: string | null; costUsd: number; tokens: { inputTokens: number; outputTokens: number; cacheReadTokens: number } }[];
  byJob: { jobId: string | null; phase: string | null; costUsd: number; tokens: { inputTokens: number; outputTokens: number } }[];
}

export interface Kpis {
  totalTokens: number;
  totalCostUsd: number;
  jobCount: number;
}

export function kpisFromCost(cost: CostBreakdown): Kpis {
  return {
    totalTokens: cost.runTokens.inputTokens + cost.runTokens.outputTokens,
    totalCostUsd: cost.runCostUsd,
    jobCount: cost.byJob.length,
  };
}
