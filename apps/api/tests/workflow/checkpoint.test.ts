/**
 * 可靠性 DB 层真跑测试（U4，真 Postgres）。
 * 重点：CAS 单赢家（approve / recovery）、lease/heartbeat、幂等写、事件缓冲补发。
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import {
  idempotencyKey,
  recordAttempt,
  markAttemptRunning,
  heartbeat,
  approveCAS,
  claimCheckpointToRunning,
  nextAttemptNumber,
  findOrphanAttempts,
  recoverCAS,
  writeArtifactIdempotent,
} from "../../src/workflow/checkpoint.ts";
import { EventReplayBuffer, getEventsSince } from "../../src/workflow/events.ts";
import { seedWorkflow, cleanup, setStatus, db } from "./_helpers.ts";

const created: { userId: string; projectId: string }[] = [];
async function fresh(axes?: unknown[]) {
  const ids = await seedWorkflow(axes ? { axes } : {});
  created.push({ userId: ids.userId, projectId: ids.projectId });
  return ids.workflowId;
}

after(async () => {
  for (const ids of created) await cleanup(ids);
  await db.$client.end();
});

test("approveCAS：首个赢（true），二次非 paused → false（409 语义）", async () => {
  const wf = await fresh();
  await setStatus(wf, "paused_for_approval", "phase1_intake");
  assert.equal(await approveCAS(db, wf), true);
  assert.equal(await approveCAS(db, wf), false); // 已是 approved，CAS 落空
});

test("claimCheckpointToRunning：并发只 1 个赢", async () => {
  const wf = await fresh();
  await setStatus(wf, "paused_for_approval", "phase2_research");
  const results = await Promise.all([
    claimCheckpointToRunning(db, wf),
    claimCheckpointToRunning(db, wf),
    claimCheckpointToRunning(db, wf),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
});

test("recordAttempt 幂等：同 idempotency_key 二次 INSERT → null", async () => {
  const wf = await fresh();
  const a = await recordAttempt(db, {
    workflowId: wf, phase: "phase1_intake", attemptNumber: 1, owner: "w1", leaseSeconds: 120,
  });
  assert.ok(a);
  const dup = await recordAttempt(db, {
    workflowId: wf, phase: "phase1_intake", attemptNumber: 1, owner: "w2", leaseSeconds: 120,
  });
  assert.equal(dup, null);
});

test("heartbeat：owner 续租成功；非 owner → false（防脑裂）", async () => {
  const wf = await fresh();
  const a = await recordAttempt(db, {
    workflowId: wf, phase: "phase3_synthesis", attemptNumber: 1, owner: "w1", leaseSeconds: 120,
  });
  await markAttemptRunning(db, a!.id, "w1");
  assert.equal(await heartbeat(db, a!.id, "w1", 120), true);
  assert.equal(await heartbeat(db, a!.id, "intruder", 120), false);
});

test("recovery：过期 leased attempt 被两 worker 并发恢复，只 1 个赢 CAS", async () => {
  const wf = await fresh();
  await setStatus(wf, "running", "phase2_research");
  // 造一个 lease 已过期的 running attempt
  await db.execute(sql`
    INSERT INTO phase_attempts (workflow_id, phase, attempt_number, status, owner, lease_expires_at, idempotency_key)
    VALUES (${wf}, 'phase2_research', 1, 'running', 'dead-worker', now() - interval '1 minute', ${idempotencyKey(wf, "phase2_research", 1)})`);

  const orphans = await findOrphanAttempts(db);
  const mine = orphans.find((o) => o.workflowId === wf);
  assert.ok(mine, "应扫到 orphan");

  const races = await Promise.all([
    recoverCAS(db, { attemptId: mine!.id, reason: "lease_expired" }),
    recoverCAS(db, { attemptId: mine!.id, reason: "lease_expired" }),
  ]);
  assert.equal(races.filter(Boolean).length, 1); // 单赢家

  // 赢家会用 n+1 重排：nextAttemptNumber 应为 2
  assert.equal(await nextAttemptNumber(db, wf, "phase2_research"), 2);
});

test("writeArtifactIdempotent：同 (phase,type,version) 二次写被吞", async () => {
  const wf = await fresh();
  const key = idempotencyKey(wf, "phase4_review", 1);
  const first = await writeArtifactIdempotent(db, {
    workflowId: wf, phase: "phase4_review", type: "final-report", version: 1, body: "v1", idempotencyKey: key,
  });
  const second = await writeArtifactIdempotent(db, {
    workflowId: wf, phase: "phase4_review", type: "final-report", version: 1, body: "v1-again", idempotencyKey: key,
  });
  assert.equal(first, true);
  assert.equal(second, false); // 冲突吞掉
  const rows = await db.execute(sql`SELECT body FROM artifacts WHERE workflow_id = ${wf}`);
  assert.equal((rows as unknown as { rows: { body: string }[] }).rows[0]!.body, "v1"); // 保留首写
});

test("事件缓冲：单调 event_id；replaySince 补发 >lastId；DB range-scan 兜底", async () => {
  const wf = await fresh();
  const buf = new EventReplayBuffer({ capacity: 2000 });
  const e1 = await buf.append(db, wf, "a", { i: 1 });
  const e2 = await buf.append(db, wf, "b", { i: 2 });
  const e3 = await buf.append(db, wf, "c", { i: 3 });
  assert.ok(e2.eventId > e1.eventId && e3.eventId > e2.eventId);

  const replay = buf.replaySince(wf, e1.eventId);
  assert.equal(replay?.length, 2);
  assert.deepEqual(replay?.map((e) => e.event), ["b", "c"]);

  // DB 兜底（模拟进程重启后内存环为空）
  const fromDb = await getEventsSince(db, wf, e1.eventId);
  assert.equal(fromDb.length, 2);
});
