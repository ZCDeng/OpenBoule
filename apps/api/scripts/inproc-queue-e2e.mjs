/**
 * P1.3 验证：真 WorkflowEngine 在 pglite + inproc 队列下跑到 Phase2 fan-out。
 * 强制 researcher-2 失败 → 验证 parent-child + ignoreDependencyOnFailure + 并发 + 重试。
 * 跑：DB_DRIVER=pglite QUEUE_DRIVER=inproc PGLITE_DATA_DIR=<已迁移目录> MODE=local node scripts/inproc-queue-e2e.mjs
 */
import { sql } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { WorkflowEngine } from "../src/workflow/engine.ts";
import { seedWorkflow } from "../tests/workflow/_helpers.ts";

const fail = new Set(); // `${wf}:researcher-2`
const events = [];

const runner = async (spec) => {
  if (fail.has(`${spec.workflowId}:${spec.role}`)) return { ok: false, text: "" };
  return { ok: true, text: `${spec.role}-output` };
};

async function waitStatus(wf, status, timeoutMs = 15000) {
  const start = Date.now();
  for (;;) {
    const r = await db.execute(sql`SELECT status AS s FROM workflows WHERE id = ${wf}`);
    const s = r.rows[0].s;
    if (s === status) return;
    if (Date.now() - start > timeoutMs) throw new Error(`等 ${status} 超时（当前 ${s}）`);
    await new Promise((res) => setTimeout(res, 50));
  }
}

const engine = new WorkflowEngine(db, {
  agentRunner: runner,
  workerId: "test-inproc",
  sink: (_runId, ev) => { events.push(ev); },
});
engine.start();

const { workflowId, userId, projectId } = await seedWorkflow({ axes: ["轴甲", "轴乙", "轴丙"] });
fail.add(`${workflowId}:researcher-2`);

// phase0 → 审批链 → phase2 fan-out
await engine.startWorkflow(workflowId);
const order = ["phase0_init", "phase1_intake", "phase1_5_axis", "phase2_research"];
for (const phase of order) {
  await waitStatus(workflowId, "paused_for_approval");
  const cur = (await db.execute(sql`SELECT current_phase AS p FROM workflows WHERE id=${workflowId}`)).rows[0].p;
  if (cur !== phase) throw new Error(`期望停在 ${phase}，实际 ${cur}`);
  console.log(`✅ checkpoint @ ${phase}`);
  if (phase !== "phase2_research") await engine.approve(workflowId);
}

// 验 aggregate artifact + 事件（3 子，1 失败 → 2 present + 1 missing）
const art = (await db.execute(
  sql`SELECT type, status FROM artifacts WHERE workflow_id=${workflowId} AND phase='phase2_research'`,
)).rows;
const agg = events.find((e) => e.event === "phase-aggregated");
console.log("aggregate artifact:", JSON.stringify(art));
console.log("phase-aggregated event:", JSON.stringify(agg?.data));

// total=childCount(3 attempted)，missing=1（researcher-2 重试耗尽后失败，ignoreDependencyOnFailure 放行 parent）。
const ok = art.length === 1 && agg && agg.data.total === 3 && agg.data.missing === 1;
await engine.close();
await db.execute(sql`DELETE FROM projects WHERE id=${projectId}`);
await db.execute(sql`DELETE FROM users WHERE id=${userId}`);

if (!ok) { console.error("❌ fan-out 语义不符预期"); process.exit(1); }
console.log("✅ P1.3 inproc 队列 fan-out + 重试 + ignoreDependencyOnFailure 全部验证通过");
process.exit(0);
