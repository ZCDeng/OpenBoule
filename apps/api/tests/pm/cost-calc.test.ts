/**
 * 成本计算测试（U5，真 Postgres）。覆盖 plan：汇总多 phase 的 token 和金额正确，run/phase/job 分层。
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { computeCost } from "../../src/pm/cost-calc.ts";
import { seedWorkflow, cleanup, db } from "../workflow/_helpers.ts";

const created: { userId: string; projectId: string }[] = [];

after(async () => {
  for (const ids of created) await cleanup(ids);
  await db.$client.end();
});

test("汇总 7 phase 的 token 与金额，run/phase/job 三层一致", async () => {
  const { userId, projectId, workflowId } = await seedWorkflow();
  created.push({ userId, projectId });

  const phases = ["phase0_init", "phase1_intake", "phase1_5_axis", "phase2_research", "phase2_5_verify", "phase3_synthesis", "phase4_review"];
  let expectedCost = 0;
  let expectedIn = 0;
  for (let i = 0; i < phases.length; i++) {
    const cost = (i + 1) * 0.01;
    const inp = (i + 1) * 100;
    expectedCost += cost;
    expectedIn += inp;
    await db.execute(sql`
      INSERT INTO workflow_costs (workflow_id, phase, job_id, model, input_tokens, output_tokens, cache_read_tokens, cost_usd)
      VALUES (${workflowId}, ${phases[i]}, ${`job-${i}`}, 'claude-opus', ${inp}, 50, 0, ${cost.toFixed(6)})`);
  }
  // phase2 多一个 job（fan-out 子 job）——验 job 分层与 phase 聚合
  await db.execute(sql`
    INSERT INTO workflow_costs (workflow_id, phase, job_id, model, input_tokens, output_tokens, cache_read_tokens, cost_usd)
    VALUES (${workflowId}, 'phase2_research', 'job-3b', 'claude-opus', 200, 50, 0, '0.020000')`);
  expectedCost += 0.02;
  expectedIn += 200;

  const c = await computeCost(db, workflowId);
  assert.ok(Math.abs(c.runCostUsd - expectedCost) < 1e-6, `runCost ${c.runCostUsd} vs ${expectedCost}`);
  assert.equal(c.runTokens.inputTokens, expectedIn);
  assert.equal(c.byPhase.length, 7); // 7 个不同 phase
  assert.equal(c.byJob.length, 8); // 7 + phase2 的第二个 job

  // phase2_research 聚合 = 两个 job 之和
  const p2 = c.byPhase.find((p) => p.phase === "phase2_research")!;
  assert.ok(Math.abs(p2.costUsd - (0.04 + 0.02)) < 1e-6); // phase 索引 3 → 0.04，加 0.02
  assert.equal(p2.tokens.inputTokens, 400 + 200);
});
