/**
 * Phase 运行器（U4）。
 *
 * 「这个 phase 要做什么」的纯逻辑——agent 调用经**注入的 agentRunner**（生产 = U3 runRole + U2 role 加载，
 * 在 U6 组装；测试 = mock）。运行器不碰 DB / 队列，engine 负责落库与编排。
 *
 * 三形态：single（单角色）/ fanout（Phase 2 并发 researcher + aggregator）/ serial（Phase 4 editor-1→2→3 + 放行闸）。
 */

import { evaluateReviewGate, type EditorRound, type GateVerdict } from "../state.ts";

export interface AgentRunSpec {
  workflowId: string;
  phase: string;
  role: string;
  task: string;
  childIndex?: number;
}

export interface AgentRunResult {
  ok: boolean;
  text: string;
  /** Phase 4 editor 自评 / U5 PM 语言闸门评分；缺省按「不可放行」处理。 */
  score?: { composite: number; mustFix: number; languageGateFailed: boolean };
}

export type AgentRunner = (spec: AgentRunSpec) => Promise<AgentRunResult>;

export interface PhaseArtifact {
  type: string;
  body: string;
  status: "draft" | "below_threshold" | "published";
}

// ── single ──

export async function runSinglePhase(
  agentRunner: AgentRunner,
  args: { workflowId: string; phase: string; role?: string; task?: string },
): Promise<{ artifact: PhaseArtifact; ok: boolean }> {
  const r = await agentRunner({
    workflowId: args.workflowId,
    phase: args.phase,
    role: args.role ?? args.phase,
    task: args.task ?? args.phase,
  });
  return { ok: r.ok, artifact: { type: args.phase, body: r.text, status: "draft" } };
}

// ── fanout：child + aggregate ──

/** 一个 researcher 子 job 的工作（返回值进 BullMQ child value）。 */
export async function runResearchChild(
  agentRunner: AgentRunner,
  spec: AgentRunSpec,
): Promise<AgentRunResult> {
  return agentRunner(spec);
}

/**
 * aggregator 合并子 job 结果。失败 / 缺失的子 job 值为 null（ignoreDependencyOnFailure），
 * 记 missing 计数但不阻塞整体（partial result 合法）。
 */
export function aggregateResearch(childValues: (AgentRunResult | null)[]): {
  artifact: PhaseArtifact;
  total: number;
  missing: number;
} {
  const total = childValues.length;
  const ok = childValues.filter((v): v is AgentRunResult => !!v && v.ok);
  const missing = total - ok.length;
  const body = JSON.stringify({
    synthesis: ok.map((v) => v.text),
    coverage: { total, present: ok.length, missing },
  });
  return { artifact: { type: "research-synthesis", body, status: "draft" }, total, missing };
}

// ── serial：Phase 4 editor 串行 + 放行闸 ──

const MISSING_SCORE: EditorRound["composite"] = 0;

/**
 * Editor-1 → 2 → 3 串行（每稿喂前一稿产出），合并三 round 跑放行闸。
 * 未放行 → artifact 标 below_threshold（取最高稿兜底，不丢弃），上报由人决断。
 * 缺评分的 editor 记为不可放行 round（composite=0, mustFix=1），防缺数据误放行。
 */
export async function runSerialReview(
  agentRunner: AgentRunner,
  args: { workflowId: string; phase: string; editorCount?: number },
): Promise<{ artifact: PhaseArtifact; verdict: GateVerdict }> {
  const editorCount = args.editorCount ?? 3;
  const rounds: EditorRound[] = [];
  let prevText = "";
  let bestText = "";
  let bestComposite = -1;

  for (let i = 1; i <= editorCount; i++) {
    const r = await agentRunner({
      workflowId: args.workflowId,
      phase: args.phase,
      role: `editor-${i}`,
      task: prevText, // 串行：前一稿喂下一 editor
      childIndex: i,
    });
    prevText = r.text;
    const round: EditorRound = r.score
      ? { editor: i, ...r.score }
      : { editor: i, composite: MISSING_SCORE, mustFix: 1, languageGateFailed: true };
    rounds.push(round);
    if (round.composite > bestComposite) {
      bestComposite = round.composite;
      bestText = r.text;
    }
  }

  const verdict = evaluateReviewGate(rounds);
  return {
    artifact: {
      type: "final-report",
      body: bestText,
      status: verdict.ship ? "published" : "below_threshold",
    },
    verdict,
  };
}
