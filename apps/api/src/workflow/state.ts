/**
 * Phase 状态机（U4）——纯函数，无 I/O。
 *
 * 真值源是 Postgres `workflows.status` + `current_phase`；本模块只描述**合法转换**与
 * **放行闸评分**，不碰 DB / 队列。这样状态机逻辑可被纯单测穷举，bug 不藏在 I/O 后面。
 *
 * 相关：plan §5.2 状态图、U4 Approach（fan-out / serial / 放行闸 / checkpoint 转换）。
 */

/** 9 个 phase，按 §5.2 顺序。 */
export const PHASE_IDS = [
  "phase0_init",
  "phase1_intake",
  "phase1_5_axis",
  "phase2_research",
  "phase2_5_verify",
  "phase3_synthesis",
  "phase4_review",
  "phase5_delivery",
  "phase6_enrichment",
] as const;

export type PhaseId = (typeof PHASE_IDS)[number];

/** phase 执行形态：单角色 / fan-out 并发 / serial 串行（editor-1→2→3）。 */
export type PhaseKind = "single" | "fanout" | "serial";

export interface PhaseDescriptor {
  id: PhaseId;
  /** `continue` 时的下一 phase；null = 终点。 */
  next: PhaseId | null;
  kind: PhaseKind;
}

const FANOUT: Set<PhaseId> = new Set(["phase2_research"]);
const SERIAL: Set<PhaseId> = new Set(["phase4_review"]);

export const PHASES: Record<PhaseId, PhaseDescriptor> = Object.fromEntries(
  PHASE_IDS.map((id, i) => [
    id,
    {
      id,
      next: (PHASE_IDS[i + 1] ?? null) as PhaseId | null,
      kind: FANOUT.has(id) ? "fanout" : SERIAL.has(id) ? "serial" : "single",
    },
  ]),
) as Record<PhaseId, PhaseDescriptor>;

export function isPhaseId(x: string): x is PhaseId {
  return (PHASE_IDS as readonly string[]).includes(x);
}

/** checkpoint 上人能做的决断（§5.2）。 */
export type CheckpointDecision = "continue" | "redo" | "augment" | "skip";

/** augment 固定回到 Phase 2（补研究）。 */
const AUGMENT_TARGET: PhaseId = "phase2_research";

/**
 * 给定当前 phase + 人的决断，算出下一个该跑的 phase；null = workflow 结束。
 * 非法组合（如非 phase6 用 skip）抛错——fail loud，不静默降级成 continue。
 */
export function resolveNextPhase(current: PhaseId, decision: CheckpointDecision): PhaseId | null {
  const desc = PHASES[current];
  switch (decision) {
    case "continue":
      return desc.next;
    case "redo":
      return current; // 重跑当前 phase（新 attempt）
    case "augment":
      return AUGMENT_TARGET;
    case "skip":
      if (current !== "phase6_enrichment") {
        throw new Error(`skip 仅允许在 phase6_enrichment（当前 ${current}）`);
      }
      return null;
  }
}

// ── Phase 4 放行闸：硬闸门 + 软评分（借鉴 OD ship-iff-composite≥阈值 且 mustFix===0）──

export const SHIP_THRESHOLD = 0.8;

/** 单个 editor round 的评审产出。 */
export interface EditorRound {
  /** editor 序号（1/2/3），用于留痕。 */
  editor: number;
  /** 综合质量分 [0,1]。 */
  composite: number;
  /** 必修项数量（硬闸门：>0 不可放行）。 */
  mustFix: number;
  /** 语言闸门未过 flag（硬闸门）。 */
  languageGateFailed: boolean;
}

export interface GateVerdict {
  /** 是否放行（硬闸门全清 且 软评分达标）。 */
  ship: boolean;
  /** 选中的 round（放行=达标稿；否则=兜底质量最高稿）。 */
  selected: EditorRound;
  /** 未放行时为 true——artifact 标 below_threshold，上报 checkpoint 由人决断。 */
  belowThreshold: boolean;
  reason: string;
}

/**
 * 合并三个 editor round → 放行裁决。
 *
 * 硬闸门：mustFix===0 且 !languageGateFailed。软评分：composite ≥ SHIP_THRESHOLD。
 * 两者皆满足才 ship。否则**不丢弃**——取 composite 最高一稿（borrow OD selectFallbackRound）
 * 标 belowThreshold 兜底。空数组抛错（fail loud：phase4 没产出不该走到这）。
 */
export function evaluateReviewGate(rounds: EditorRound[]): GateVerdict {
  if (rounds.length === 0) {
    throw new Error("evaluateReviewGate: 无 editor round，phase4 无产出");
  }
  const passing = rounds.filter(
    (r) => r.mustFix === 0 && !r.languageGateFailed && r.composite >= SHIP_THRESHOLD,
  );
  if (passing.length > 0) {
    // 达标稿里取分最高
    const selected = passing.reduce((a, b) => (b.composite > a.composite ? b : a));
    return {
      ship: true,
      selected,
      belowThreshold: false,
      reason: `ship: composite=${selected.composite.toFixed(3)} ≥ ${SHIP_THRESHOLD}, mustFix=0`,
    };
  }
  // 兜底：质量最高一稿（即便闸门没清）
  const selected = rounds.reduce((a, b) => (b.composite > a.composite ? b : a));
  const why =
    selected.mustFix > 0
      ? `mustFix=${selected.mustFix}`
      : selected.languageGateFailed
        ? "languageGate 未过"
        : `composite=${selected.composite.toFixed(3)} < ${SHIP_THRESHOLD}`;
  return {
    ship: false,
    selected,
    belowThreshold: true,
    reason: `below_threshold（取最高稿兜底）: ${why}`,
  };
}
