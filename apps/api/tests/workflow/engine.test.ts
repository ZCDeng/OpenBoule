/**
 * 工作流引擎整合测试（U4，真 BullMQ + 真 Postgres，mock agent 不真调 API）。
 *
 * 覆盖 plan U4 Test scenarios：happy 9-phase 全跑通且每 checkpoint 暂停、审批后继续、
 * Phase 2 fan-out partial（researcher 失败不阻塞 aggregator）、redo 重排当前 phase、
 * 并发双 approve → 409（CAS 防重复 enqueue）。
 *
 * 单引擎单队列：所有 test 共用一个 WorkflowEngine（生产即如此——多 worker 共享同一 agentRunner）。
 * 失败注入按 workflowId 作用域，避免跨 test 的 job 被无注入 worker 抢跑。
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { Queue } from "bullmq";
import { WorkflowEngine, CheckpointConflictError } from "../../src/workflow/engine.ts";
import { createConnection, PHASE_QUEUE } from "../../src/workflow/queues.ts";
import { PHASE_IDS } from "../../src/workflow/state.ts";
import type { AgentRunner } from "../../src/workflow/phases/index.ts";
import { seedWorkflow, cleanup, db } from "./_helpers.ts";

const createdIds: { userId: string; projectId: string }[] = [];
/** `${workflowId}:${role}` → 该角色在该 run 内强制失败。 */
const failKeys = new Set<string>();

const runner: AgentRunner = async (spec) => {
  if (failKeys.has(`${spec.workflowId}:${spec.role}`)) return { ok: false, text: "" };
  if (spec.role.startsWith("editor-")) {
    return { ok: true, text: `edited-by-${spec.role}`, score: { composite: 0.9, mustFix: 0, languageGateFailed: false } };
  }
  return { ok: true, text: `${spec.role}-output` };
};

let engine: WorkflowEngine;

async function seed(axes?: unknown[]): Promise<string> {
  const ids = await seedWorkflow(axes ? { axes } : {});
  createdIds.push({ userId: ids.userId, projectId: ids.projectId });
  return ids.workflowId;
}

async function currentPhase(wf: string): Promise<string> {
  const r = await db.execute(sql`SELECT current_phase AS "p" FROM workflows WHERE id = ${wf}`);
  return (r as unknown as { rows: { p: string }[] }).rows[0]!.p;
}

async function waitForStatus(wf: string, status: string, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const r = await db.execute(sql`SELECT status AS "s" FROM workflows WHERE id = ${wf}`);
    const s = (r as unknown as { rows: { s: string }[] }).rows[0]!.s;
    if (s === status) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`等 ${status} 超时（当前 ${s} @ phase ${await currentPhase(wf)}）`);
    }
    await new Promise((res) => setTimeout(res, 80));
  }
}

before(async () => {
  const conn = createConnection();
  const q = new Queue(PHASE_QUEUE, { connection: conn as never });
  await q.obliterate({ force: true }); // 清残留 job
  await q.close();
  await conn.quit();

  engine = new WorkflowEngine(db, {
    agentRunner: runner,
    workerId: "w-test",
    leaseSeconds: 30,
    heartbeatSeconds: 5,
    editorCount: 3,
  });
  engine.start();
});

after(async () => {
  await engine.close();
  for (const ids of createdIds) await cleanup(ids);
  await db.$client.end();
});

test("happy path：9 phase 顺序跑通，每 phase checkpoint 暂停，审批后继续", async () => {
  const wf = await seed();
  await engine.startWorkflow(wf);

  const visited: string[] = [];
  let done = false;
  for (let i = 0; i < PHASE_IDS.length + 2 && !done; i++) {
    await waitForStatus(wf, "paused_for_approval");
    visited.push(await currentPhase(wf));
    ({ done } = await engine.approve(wf));
  }

  assert.equal(done, true);
  assert.deepEqual(visited, [...PHASE_IDS]); // 9 phase 全部按序经过且各自暂停
});

test("并发双 approve：只 1 个赢，另一个 → 409（CAS 防重复 enqueue）", async () => {
  const wf = await seed();
  await engine.startWorkflow(wf);
  await waitForStatus(wf, "paused_for_approval");

  const [a, b] = await Promise.allSettled([engine.approve(wf), engine.approve(wf)]);
  const fulfilled = [a, b].filter((o) => o.status === "fulfilled");
  const conflicts = [a, b].filter(
    (o) => o.status === "rejected" && (o as PromiseRejectedResult).reason instanceof CheckpointConflictError,
  );
  assert.equal(fulfilled.length, 1);
  assert.equal(conflicts.length, 1);
});

test("Phase 2 fan-out partial：1 个 researcher 失败不阻塞 aggregator", { timeout: 30000 }, async () => {
  const wf = await seed(["a", "b", "c"]);
  failKeys.add(`${wf}:researcher-2`);
  await engine.startWorkflow(wf);

  for (const expected of ["phase0_init", "phase1_intake", "phase1_5_axis"]) {
    await waitForStatus(wf, "paused_for_approval");
    assert.equal(await currentPhase(wf), expected);
    await engine.approve(wf);
  }
  await waitForStatus(wf, "paused_for_approval");
  assert.equal(await currentPhase(wf), "phase2_research");

  const r = await db.execute(
    sql`SELECT body FROM artifacts WHERE workflow_id = ${wf} AND type = 'research-synthesis'`,
  );
  const body = JSON.parse((r as unknown as { rows: { body: string }[] }).rows[0]!.body);
  assert.equal(body.coverage.total, 3);
  assert.equal(body.coverage.present, 2);
  assert.equal(body.coverage.missing, 1); // researcher-2 失败，partial 合法
});

test("redo：在 checkpoint 重排当前 phase（新 attempt）", { timeout: 30000 }, async () => {
  const wf = await seed();
  await engine.startWorkflow(wf);
  await waitForStatus(wf, "paused_for_approval");
  assert.equal(await currentPhase(wf), "phase0_init");

  await engine.redo(wf);
  await waitForStatus(wf, "paused_for_approval"); // 重排后再次暂停

  const attempts = await db.execute(
    sql`SELECT attempt_number FROM phase_attempts WHERE workflow_id = ${wf} AND phase = 'phase0_init' ORDER BY attempt_number`,
  );
  const nums = (attempts as unknown as { rows: { attempt_number: number }[] }).rows.map((x) => x.attempt_number);
  assert.deepEqual(nums, [1, 2]); // 两次 attempt
});
