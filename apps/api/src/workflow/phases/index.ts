/**
 * Phase 运行器（U4）。
 *
 * 「这个 phase 要做什么」的纯逻辑——agent 调用经**注入的 agentRunner**（生产 = U3 runRole + U2 role 加载，
 * 在 U6 组装；测试 = mock）。运行器不碰 DB / 队列，engine 负责落库与编排。
 *
 * 三形态：single（单角色）/ fanout（Phase 2 并发 researcher + aggregator）/ serial（Phase 4 editor-1→2→3 + 放行闸）。
 */

import {
  evaluateReviewGate,
  evaluateReviewPanel,
  REVIEW_LENSES,
  type EditorRound,
  type GateVerdict,
  type ReviewLens,
  type PanelVerdict,
  type InteractiveKind,
} from "../state.ts";

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
  /** 失败时的归类码（U3 classifyError）；ok=false 时携带，供 engine fail-loud 上报。 */
  errorCode?: string;
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
): Promise<{ artifact: PhaseArtifact; ok: boolean; errorCode?: string }> {
  const r = await agentRunner({
    workflowId: args.workflowId,
    phase: args.phase,
    role: args.role ?? args.phase,
    task: args.task ?? args.phase,
  });
  return { ok: r.ok, errorCode: r.errorCode, artifact: { type: args.phase, body: r.text, status: "draft" } };
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

// ── panel：Phase 3.5 评审合议（N 视角实质评审 + readiness 裁决）──

/**
 * 5 视角实质评审 → 合议裁决（report v1 是否能进 Phase 4）。视角名透传作各 reviewer 的具体评审任务
 * （类比 fanout 的 axis-threading）。缺评分的视角记为有硬伤（mustFix=1, composite=0），防缺数据误 ship。
 * artifact 体是 readiness + 逐视角裁决的 JSON；非 ship 标 below_threshold，engine 据 readiness 走 gate。
 */
export async function runReviewPanel(
  agentRunner: AgentRunner,
  args: { workflowId: string; phase: string; lenses?: readonly string[] },
): Promise<{ artifact: PhaseArtifact; verdict: PanelVerdict }> {
  const lensNames = args.lenses ?? REVIEW_LENSES;
  const results: ReviewLens[] = [];
  for (let i = 0; i < lensNames.length; i++) {
    const lens = lensNames[i]!;
    const r = await agentRunner({
      workflowId: args.workflowId,
      phase: args.phase,
      role: `reviewer-${i + 1}`,
      task: lens, // 视角透传：第 i 个 reviewer 用第 i 个视角审 report v1
      childIndex: i + 1,
    });
    results.push(
      r.score
        ? { lens, composite: r.score.composite, mustFix: r.score.mustFix, debates: 0 }
        : { lens, composite: 0, mustFix: 1, debates: 0 },
    );
  }

  const verdict = evaluateReviewPanel(results);
  return {
    artifact: {
      type: "review-verdict",
      body: JSON.stringify({ readiness: verdict.readiness, reason: verdict.reason, lenses: results }),
      status: verdict.readiness === "ship" ? "draft" : "below_threshold",
    },
    verdict,
  };
}

// ── interactive：Phase 5 第 5 交互交付轨（Step 4.5，可选增量，不动 4 份标准交付底座）──

/** 各 kind 的一句话简报，拼进 task 让 agent 知道这件交互件要让客户「click 哪一件事」。 */
const INTERACTIVE_KIND_BRIEF: Record<InteractiveKind, string> = {
  "html-diagram": "交互架构走查：clickable 节点 + animated flow，让客户点着看系统怎么跑",
  html: "交互工具 / explainer：客户自己切选项、勾维度，实时看不同方案的后果与对比",
  "html-plan": "可展开路线图：里程碑 / 阶段做成可点开的结构页",
};

/**
 * 第 5 交互轨：把定稿内容做成单文件自包含交互件（type:"interactive"）。
 *
 * 关键：Boule 的 designer 是 sandbox reasoning role（无 fs / 技能访问），**不能**真调 effective-html 写文件。
 * 故 role 用 `interactive-<kind>` 前缀——agent-runner 据此在运行时注入「直接吐单文件 HTML，别调技能」覆盖
 * （KTD-5：确定性运行时层裁决，不靠模型忽略 designer.md 的调技能假设）。内容只能来自定稿（reportBody）。
 * 产出 status=draft；自包含 lint 由 engine 跑（lint 失败 → below_threshold，软门不阻断标准交付）。
 */
export async function runInteractiveTrack(
  agentRunner: AgentRunner,
  args: { workflowId: string; phase: string; kind: InteractiveKind; reportBody: string },
): Promise<{ artifact: PhaseArtifact; ok: boolean; errorCode?: string }> {
  const task = [
    `把下面这份定稿内容做成第 5 交付轨「交互件」——一个${INTERACTIVE_KIND_BRIEF[args.kind]}。`,
    `形态：单文件自包含 HTML（CSS / JS 全内联，零外部依赖，发出去能直接双击打开）。`,
    `暗色三件套必备：<head> 里早执行脚本读 localStorage 主题、在 paint 前给 documentElement 切 dark class。`,
    `内容只能来自定稿——不新增方案 / 不改数字 / 删冗余文字（让一件事快速 click，正文留给报告），零流程黑话。`,
    ``,
    `=== 定稿内容 ===`,
    args.reportBody,
  ].join("\n");

  const r = await agentRunner({
    workflowId: args.workflowId,
    phase: args.phase,
    role: `interactive-${args.kind}`,
    task,
  });
  return {
    ok: r.ok,
    errorCode: r.errorCode,
    artifact: { type: "interactive", body: r.text, status: "draft" },
  };
}
