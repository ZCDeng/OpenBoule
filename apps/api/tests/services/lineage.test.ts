/**
 * Lineage / stale 传播测试（U9，真 PG）。传播序 + DB 标记 + 清除。
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { downstreamPhases, markDownstreamStale, listStalePhases, clearStale } from "../../src/services/lineage.ts";
import { seedWorkflow, cleanup, db } from "../workflow/_helpers.ts";

const created: { userId: string; projectId: string }[] = [];
after(async () => {
  for (const ids of created) await cleanup(ids);
  await db.$client.end();
});

test("downstreamPhases：编辑 phase 的严格下游（保序），末 phase 无下游", () => {
  assert.deepEqual(downstreamPhases("phase3_synthesis"), ["phase4_review", "phase5_delivery", "phase6_enrichment"]);
  assert.deepEqual(downstreamPhases("phase6_enrichment"), []);
  assert.deepEqual(downstreamPhases("unknown"), []);
});

test("markDownstreamStale：只标下游有 artifact 的 phase，不动上游/自身", async () => {
  const ids = await seedWorkflow();
  created.push({ userId: ids.userId, projectId: ids.projectId });
  const wf = ids.workflowId;
  // 造各 phase 的 artifact
  for (const phase of ["phase1_intake", "phase1_5_axis", "phase3_synthesis", "phase4_review", "phase5_delivery"]) {
    await db.execute(sql`
      INSERT INTO artifacts (workflow_id, phase, type, version, body) VALUES (${wf}, ${phase}, 't', 1, 'x')`);
  }
  // 编辑 phase1_5_axis → 下游是 phase2..phase6；有 artifact 的下游 = phase3/phase4/phase5
  const affected = await markDownstreamStale(db, wf, "phase1_5_axis");
  assert.deepEqual(affected.sort(), ["phase3_synthesis", "phase4_review", "phase5_delivery"]);

  const stale = await listStalePhases(db, wf);
  assert.deepEqual(stale.sort(), ["phase3_synthesis", "phase4_review", "phase5_delivery"]);

  // 上游 phase1_intake / 自身 phase1_5_axis 不被标
  const up = await db.execute(sql`SELECT stale FROM artifacts WHERE workflow_id = ${wf} AND phase = 'phase1_intake'`);
  assert.equal((up as unknown as { rows: { stale: boolean }[] }).rows[0]!.stale, false);

  // 重跑 phase3 → 清其 stale
  await clearStale(db, wf, "phase3_synthesis");
  const after2 = await listStalePhases(db, wf);
  assert.deepEqual(after2.sort(), ["phase4_review", "phase5_delivery"]);
});
