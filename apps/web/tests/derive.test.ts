/**
 * 视图模型派生测试（U8）。timeline 态 / 四态徽章 / 布局 / KPI。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { phaseStatus, verdictBadge, isBelowThreshold, layoutPhases, kpisFromCost } from "../src/lib/derive.ts";

test("phaseStatus：当前前=completed，后=waiting，当前 paused=needs_approval", () => {
  assert.equal(phaseStatus("phase0_init", "phase2_research", "running"), "completed");
  assert.equal(phaseStatus("phase4_review", "phase2_research", "running"), "waiting");
  assert.equal(phaseStatus("phase2_research", "phase2_research", "paused_for_approval"), "needs_approval");
  assert.equal(phaseStatus("phase2_research", "phase2_research", "running"), "running");
  assert.equal(phaseStatus("phase2_research", "phase2_research", "rejected"), "rejected");
});

test("verdictBadge：四态映射（代码裁决，非自报）", () => {
  assert.deepEqual(verdictBadge("confirmed"), { label: "确认", tone: "green" });
  assert.deepEqual(verdictBadge("salvage"), { label: "挽救", tone: "amber" });
  assert.deepEqual(verdictBadge("killed"), { label: "驳回", tone: "red" });
  assert.deepEqual(verdictBadge("undetermined"), { label: "未裁定", tone: "neutral" });
});

test("isBelowThreshold", () => {
  assert.equal(isBelowThreshold("below_threshold"), true);
  assert.equal(isBelowThreshold("published"), false);
  assert.equal(isBelowThreshold(null), false);
});

test("layoutPhases：保序、无重叠、确定性", () => {
  const nodes = layoutPhases(["a", "b", "c"], 100);
  assert.deepEqual(nodes, [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 0, y: 100 },
    { id: "c", x: 0, y: 200 },
  ]);
  // y 严格递增 → 无重叠
  const ys = nodes.map((n) => n.y);
  assert.deepEqual([...ys].sort((a, b) => a - b), ys);
});

test("kpisFromCost：总 token=input+output，成本与 job 数", () => {
  const k = kpisFromCost({
    runCostUsd: 0.42,
    runTokens: { inputTokens: 1000, outputTokens: 300, cacheReadTokens: 500 },
    byPhase: [],
    byJob: [
      { jobId: "j1", phase: "p", costUsd: 0.2, tokens: { inputTokens: 1, outputTokens: 1 } },
      { jobId: "j2", phase: "p", costUsd: 0.22, tokens: { inputTokens: 1, outputTokens: 1 } },
    ],
  });
  assert.equal(k.totalTokens, 1300);
  assert.equal(k.totalCostUsd, 0.42);
  assert.equal(k.jobCount, 2);
});
