/**
 * Phase 状态机（U4）——纯函数，无 I/O。
 *
 * 真值源是 Postgres `workflows.status` + `current_phase`；本模块只描述**合法转换**与
 * **放行闸评分**，不碰 DB / 队列。这样状态机逻辑可被纯单测穷举，bug 不藏在 I/O 后面。
 *
 * 相关：plan §5.2 状态图、U4 Approach（fan-out / serial / 放行闸 / checkpoint 转换）。
 */

/** 10 个 phase，按 §5.2 顺序（v2.5：phase3_5_review 评审合议插在综合与审校之间）。 */
export const PHASE_IDS = [
  "phase0_init",
  "phase1_intake",
  "phase1_5_axis",
  "phase2_research",
  "phase2_5_verify",
  "phase3_synthesis",
  "phase3_5_review",
  "phase4_review",
  "phase5_delivery",
  "phase6_enrichment",
] as const;

export type PhaseId = (typeof PHASE_IDS)[number];

/**
 * phase 执行形态：
 * - scaffold：确定性脚手架，引擎内算产物，**不调 agent**（phase0「骨架生成、目录创建」）
 * - single：单角色 agent
 * - fanout：并发 researcher fan-out
 * - serial：editor-1→2→3 串行
 * - panel：phase3.5 评审合议——一个 job 内跑 N 视角实质评审，合议出 readiness 裁决
 */
export type PhaseKind = "scaffold" | "single" | "fanout" | "serial" | "panel";

export interface PhaseDescriptor {
  id: PhaseId;
  /** `continue` 时的下一 phase；null = 终点。 */
  next: PhaseId | null;
  kind: PhaseKind;
}

/** 非 single 形态的 phase 覆盖表（其余 phase 默认 single）。 */
const KIND_OVERRIDE: Partial<Record<PhaseId, PhaseKind>> = {
  phase0_init: "scaffold",
  phase2_research: "fanout",
  phase3_5_review: "panel",
  phase4_review: "serial",
};

export const PHASES: Record<PhaseId, PhaseDescriptor> = Object.fromEntries(
  PHASE_IDS.map((id, i) => [
    id,
    {
      id,
      next: (PHASE_IDS[i + 1] ?? null) as PhaseId | null,
      kind: KIND_OVERRIDE[id] ?? "single",
    },
  ]),
) as Record<PhaseId, PhaseDescriptor>;

export function isPhaseId(x: string): x is PhaseId {
  return (PHASE_IDS as readonly string[]).includes(x);
}

/** checkpoint 上人能做的决断（§5.2；v2.5 加 rework 评审返工）。 */
export type CheckpointDecision = "continue" | "redo" | "augment" | "skip" | "rework";

/** augment 固定回到 Phase 2（补研究）。 */
const AUGMENT_TARGET: PhaseId = "phase2_research";

/** rework 固定从 Phase 3.5 评审退回 Phase 3 重写（方案级返工）。 */
const REWORK_TARGET: PhaseId = "phase3_synthesis";

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
    case "rework":
      // 评审合议判 rework → 退回 Phase 3 strategy 重写。仅 phase3.5 合法；人确认才走，不自动循环。
      if (current !== "phase3_5_review") {
        throw new Error(`rework 仅允许在 phase3_5_review（当前 ${current}）`);
      }
      return REWORK_TARGET;
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

// ── Phase 3.5 评审合议：5 视角实质评审 → readiness 三分支裁决（对齐 consulting-team v2.5）──

export const PANEL_SHIP_THRESHOLD = 0.8;
/** 全视角必修硬伤合计 ≥ 此值 → 方案级返工（退回 Phase 3 重写），而非轻量改稿。 */
export const REWORK_MUSTFIX_LIMIT = 3;
/** 均分低于此值视为方案不成立 → 直接 rework。 */
export const REWORK_COMPOSITE_FLOOR = 0.5;

/** 5 视角实质评审：逻辑一致 / 可行性 / 战略二阶 / 客户说服力 / 事实数据。 */
export const REVIEW_LENSES = ["逻辑一致", "可行性", "战略二阶", "客户说服力", "事实数据"] as const;

/** 单个评审视角的产出（5 视角之一）。 */
export interface ReviewLens {
  /** 视角名（REVIEW_LENSES 之一）。 */
  lens: string;
  /** 该视角综合分 [0,1]。 */
  composite: number;
  /** 方案级必修硬伤数（>0 影响 readiness）。 */
  mustFix: number;
  /** 需用户拍板的争议点数（rework 前逐条抛 checkpoint）。 */
  debates: number;
}

/** 评审就绪度：直接发 / 轻量改稿 / 方案级返工。 */
export type Readiness = "ship" | "revise" | "rework";

export interface PanelVerdict {
  /** ship → 进 Phase 4；revise → 轻量改稿后进 Phase 4；rework → 退回 Phase 3 重写。 */
  readiness: Readiness;
  /** 全视角 mustFix 合计。 */
  totalMustFix: number;
  /** 全视角 debates 合计。 */
  totalDebates: number;
  /** 全视角综合分均值。 */
  meanComposite: number;
  reason: string;
}

/**
 * 合并 N 视角评审 → readiness 裁决（报告级方案审查，对齐 consulting-team 三分支 gate）。
 *
 * - ship：无必修硬伤 且 均分 ≥ PANEL_SHIP_THRESHOLD
 * - rework：必修硬伤 ≥ REWORK_MUSTFIX_LIMIT 或 均分 < REWORK_COMPOSITE_FLOOR（方案级返工）
 * - revise：其余（有少量硬伤，轻量改稿后进 Phase 4）
 *
 * 空视角抛错（fail loud：phase3.5 没产出不该走到这）。路由让代码答（KTD-5），不交给模型自评。
 */
export function evaluateReviewPanel(lenses: ReviewLens[]): PanelVerdict {
  if (lenses.length === 0) {
    throw new Error("evaluateReviewPanel: 无评审视角，phase3.5 无产出");
  }
  const totalMustFix = lenses.reduce((s, l) => s + l.mustFix, 0);
  const totalDebates = lenses.reduce((s, l) => s + l.debates, 0);
  const meanComposite = lenses.reduce((s, l) => s + l.composite, 0) / lenses.length;

  let readiness: Readiness;
  let reason: string;
  if (totalMustFix === 0 && meanComposite >= PANEL_SHIP_THRESHOLD) {
    readiness = "ship";
    reason = `ship: meanComposite=${meanComposite.toFixed(3)} ≥ ${PANEL_SHIP_THRESHOLD}, mustFix=0`;
  } else if (totalMustFix >= REWORK_MUSTFIX_LIMIT || meanComposite < REWORK_COMPOSITE_FLOOR) {
    readiness = "rework";
    reason = `rework（退回 Phase 3 重写）: mustFix=${totalMustFix}, meanComposite=${meanComposite.toFixed(3)}`;
  } else {
    readiness = "revise";
    reason = `revise（轻量改稿后进 Phase 4）: mustFix=${totalMustFix}, debates=${totalDebates}`;
  }
  return { readiness, totalMustFix, totalDebates, meanComposite, reason };
}

// ── Phase 5 第 5 交互交付轨（Step 4.5，对齐 consulting-team effective-html）──

/** 交互件引擎类型（effective-html 三件）。 */
export type InteractiveKind = "html" | "html-diagram" | "html-plan";

/**
 * mode → 默认交互件类型（确定性路由，KTD-5：让代码答，不交模型自评）。人可在 checkpoint 覆盖。
 * - 诊断 / 落地 → html-diagram（clickable 节点 + animated flow 架构走查）
 * - 决策 / 调研 / 培训 → html（切选项 / 单概念 explainer）
 * - 其余 / 缺失 → html-plan（可展开路线图，兜底）
 */
export function defaultInteractiveKind(mode: string | null): InteractiveKind {
  if (mode === "诊断" || mode === "落地") return "html-diagram";
  if (mode === "决策" || mode === "调研" || mode === "培训") return "html";
  return "html-plan";
}

/** 自包含 lint 放行的外链域（svg 命名空间 + Google Fonts，非网络请求 / deck 原有字体）。 */
const SELF_CONTAINED_URL_ALLOW = [
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xhtml",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
];

export interface SelfContainedLint {
  ok: boolean;
  issues: string[];
}

/**
 * 交互件自包含 lint（纯函数，KTD-5：代码裁决，不靠模型自评）。
 * 校验：ⓐ 有 `<html` ⓑ 无白名单外的 `http(s)://` 外链 ⓒ 暗色三件套（早执行脚本 + localStorage + dark class）。
 * 收集所有问题，不抛错。ok = 零问题。engine 据此标 below_threshold（软门，不阻断标准交付）。
 */
export function lintSelfContained(html: string): SelfContainedLint {
  const issues: string[] = [];

  if (!/<html[\s>]/i.test(html)) issues.push("缺 <html> 根（非完整单文件）");

  // 外链：剔除白名单后仍有 http(s):// 即不自包含
  const urls = html.match(/https?:\/\/[^\s"'<>)]+/gi) ?? [];
  const external = urls.filter((u) => !SELF_CONTAINED_URL_ALLOW.some((ok) => u.startsWith(ok)));
  if (external.length > 0) {
    issues.push(`外链未内联（${external.length} 处，如 ${external[0]}）`);
  }

  // 暗色三件套：apply-before-paint（<body> 前出现 <script>）+ localStorage + dark class 切换
  const bodyIdx = html.search(/<body[\s>]/i);
  const firstScriptIdx = html.search(/<script[\s>]/i);
  const hasEarlyScript = firstScriptIdx >= 0 && (bodyIdx < 0 || firstScriptIdx < bodyIdx);
  if (!hasEarlyScript) issues.push("缺 apply-before-paint（<body> 前无早执行脚本）");
  if (!/localStorage/.test(html)) issues.push("缺 localStorage 主题持久化");
  if (!/classList[\s\S]{0,60}['"`]dark|documentElement\.classList/.test(html)) {
    issues.push("缺 dark class 切换");
  }

  return { ok: issues.length === 0, issues };
}
