/**
 * Phase 状态机纯单测（U4）。穷举转换 + 放行闸评分，bug 不藏在 I/O 后。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PHASE_IDS,
  PHASES,
  resolveNextPhase,
  evaluateReviewGate,
  evaluateReviewPanel,
  defaultInteractiveKind,
  lintSelfContained,
  SHIP_THRESHOLD,
  PANEL_SHIP_THRESHOLD,
  type EditorRound,
  type ReviewLens,
} from "../../src/workflow/state.ts";

test("phase 图：顺序衔接，末 phase next=null", () => {
  assert.equal(PHASES.phase0_init.next, "phase1_intake");
  assert.equal(PHASES.phase0_init.kind, "scaffold"); // U1：phase0 去 agent 化
  assert.equal(PHASES.phase2_research.kind, "fanout");
  assert.equal(PHASES.phase3_synthesis.next, "phase3_5_review"); // v2.5：综合 → 评审合议
  assert.equal(PHASES.phase3_5_review.kind, "panel"); // v2.5：评审合议形态
  assert.equal(PHASES.phase3_5_review.next, "phase4_review"); // 评审 → 审校
  assert.equal(PHASES.phase4_review.kind, "serial");
  assert.equal(PHASES.phase6_enrichment.next, null);
  // 除 scaffold/fanout/serial/panel 外均 single
  assert.equal(PHASES.phase1_intake.kind, "single");
  assert.equal(PHASES.phase1_5_axis.kind, "single"); // 只动 phase0，phase1.5 仍 agent
});

test("continue → 下一 phase；末 phase continue → null", () => {
  assert.equal(resolveNextPhase("phase0_init", "continue"), "phase1_intake");
  assert.equal(resolveNextPhase("phase6_enrichment", "continue"), null);
});

test("redo → 当前 phase；augment → phase2_research", () => {
  assert.equal(resolveNextPhase("phase3_synthesis", "redo"), "phase3_synthesis");
  assert.equal(resolveNextPhase("phase5_delivery", "augment"), "phase2_research");
});

test("skip 仅 phase6 合法，其余抛错（fail loud）", () => {
  assert.equal(resolveNextPhase("phase6_enrichment", "skip"), null);
  assert.throws(() => resolveNextPhase("phase3_synthesis", "skip"), /skip 仅允许/);
});

test("rework 仅 phase3.5 合法 → 退回 phase3；其余抛错（fail loud）", () => {
  assert.equal(resolveNextPhase("phase3_5_review", "rework"), "phase3_synthesis");
  assert.throws(() => resolveNextPhase("phase4_review", "rework"), /rework 仅允许/);
});

test("10 个 phase 全连通到终点（无死链）", () => {
  let cur: string | null = PHASE_IDS[0];
  const seen = new Set<string>();
  while (cur) {
    assert.ok(!seen.has(cur), `环路: ${cur}`);
    seen.add(cur);
    cur = PHASES[cur as keyof typeof PHASES].next;
  }
  assert.equal(seen.size, PHASE_IDS.length);
});

// ── 放行闸 ──

const round = (editor: number, composite: number, mustFix = 0, lang = false): EditorRound => ({
  editor,
  composite,
  mustFix,
  languageGateFailed: lang,
});

test("达标即放行：取达标稿里 composite 最高", () => {
  const v = evaluateReviewGate([round(1, 0.82), round(2, 0.91), round(3, 0.85)]);
  assert.equal(v.ship, true);
  assert.equal(v.belowThreshold, false);
  assert.equal(v.selected.editor, 2);
});

test("硬闸门 mustFix>0：即便分高也不放行，取最高稿标 below_threshold", () => {
  const v = evaluateReviewGate([round(1, 0.95, 2), round(2, 0.6)]);
  assert.equal(v.ship, false);
  assert.equal(v.belowThreshold, true);
  assert.equal(v.selected.editor, 1); // 兜底取 composite 最高（不丢弃）
  assert.match(v.reason, /mustFix/);
});

test("语言闸门未过：硬闸门拦截", () => {
  const v = evaluateReviewGate([round(1, 0.99, 0, true)]);
  assert.equal(v.ship, false);
  assert.match(v.reason, /languageGate/);
});

test("全部低于阈值：below_threshold 兜底", () => {
  const v = evaluateReviewGate([round(1, 0.5), round(2, 0.7)]);
  assert.equal(v.ship, false);
  assert.ok(SHIP_THRESHOLD > 0.7);
  assert.equal(v.selected.editor, 2);
});

test("空 round 抛错（phase4 无产出不该走到这）", () => {
  assert.throws(() => evaluateReviewGate([]), /无 editor round/);
});

// ── Phase 3.5 评审合议 ──

const lens = (composite: number, mustFix = 0, debates = 0): ReviewLens => ({
  lens: "测试视角",
  composite,
  mustFix,
  debates,
});

test("评审 ship：无硬伤 且 均分达标", () => {
  const v = evaluateReviewPanel([lens(0.85), lens(0.9), lens(0.82)]);
  assert.equal(v.readiness, "ship");
  assert.equal(v.totalMustFix, 0);
  assert.ok(v.meanComposite >= PANEL_SHIP_THRESHOLD);
});

test("评审 revise：少量硬伤 → 轻量改稿", () => {
  const v = evaluateReviewPanel([lens(0.85, 1), lens(0.8), lens(0.82, 1, 2)]);
  assert.equal(v.readiness, "revise");
  assert.equal(v.totalMustFix, 2);
  assert.equal(v.totalDebates, 2);
});

test("评审 rework：硬伤超限 → 方案级返工退回 Phase 3", () => {
  const v = evaluateReviewPanel([lens(0.7, 2), lens(0.6, 1)]);
  assert.equal(v.readiness, "rework");
  assert.match(v.reason, /rework/);
});

test("评审 rework：均分过低也直接返工", () => {
  const v = evaluateReviewPanel([lens(0.4), lens(0.3)]);
  assert.equal(v.readiness, "rework");
});

test("评审空视角抛错（phase3.5 无产出不该走到这）", () => {
  assert.throws(() => evaluateReviewPanel([]), /无评审视角/);
});

// ── Phase 5 第 5 交互交付轨 ──

test("交互件 mode→kind 确定性路由", () => {
  assert.equal(defaultInteractiveKind("诊断"), "html-diagram");
  assert.equal(defaultInteractiveKind("落地"), "html-diagram");
  assert.equal(defaultInteractiveKind("决策"), "html");
  assert.equal(defaultInteractiveKind("调研"), "html");
  assert.equal(defaultInteractiveKind("培训"), "html");
  assert.equal(defaultInteractiveKind("路线图"), "html-plan"); // 未列 mode 兜底
  assert.equal(defaultInteractiveKind(null), "html-plan"); // mode 缺失兜底
});

const GOOD_HTML = `<!doctype html><html><head>
<script>const t=localStorage.getItem('theme');if(t==='dark')document.documentElement.classList.add('dark')</script>
</head><body><svg xmlns="http://www.w3.org/2000/svg"></svg></body></html>`;

test("自包含 lint：合规单文件零问题", () => {
  const r = lintSelfContained(GOOD_HTML);
  assert.equal(r.ok, true);
  assert.deepEqual(r.issues, []);
});

test("自包含 lint：外链 CDN 命中（svg/字体白名单不算）", () => {
  const r = lintSelfContained(GOOD_HTML.replace("</body>", '<script src="https://cdn.example.com/x.js"></script></body>'));
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.includes("外链未内联")));
});

test("自包含 lint：缺暗色三件套 + 缺 <html> 各记一条", () => {
  const r = lintSelfContained("<div>纯片段，无主题脚本</div>");
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.includes("<html>")));
  assert.ok(r.issues.some((i) => i.includes("apply-before-paint")));
  assert.ok(r.issues.some((i) => i.includes("localStorage")));
});
