/**
 * Checkpoint + 可靠性 DB 层（U4）。
 *
 * 所有「裁定类」写都用**原子 SQL**（CAS），不先读后写——多 worker 并发恢复 / 双击 approve
 * 时靠 DB 单点裁赢家（plan U4：OD 是单恢复者，Boule 多 worker 必须靠 DB 写裁定）。
 * 纯 DB，不碰 BullMQ；engine 负责把它和队列对账。
 *
 * 约定：lease 用秒粒度 SQL interval；rowCount===1 表示「本调用赢了 CAS」。
 */

import { sql } from "drizzle-orm";
import type { DB } from "../db/client.ts";

/** idempotency_key = workflow_id:phase:attempt_number（plan U4）。 */
export function idempotencyKey(workflowId: string, phase: string, attemptNumber: number): string {
  return `${workflowId}:${phase}:${attemptNumber}`;
}

function rowCount(res: unknown): number {
  // drizzle node-postgres：db.execute 返回 pg QueryResult，含 rowCount
  return (res as { rowCount?: number | null })?.rowCount ?? 0;
}

// ── workflows 状态 CAS ──

/** phase 完成 → 挂起等审批。current_phase 同时落定（前端 SSE 读）。 */
export async function pauseForApproval(
  db: DB,
  workflowId: string,
  phase: string,
  checkpointData?: unknown,
): Promise<void> {
  await db.execute(sql`
    UPDATE workflows
       SET status = 'paused_for_approval',
           current_phase = ${phase},
           checkpoint_data = ${checkpointData === undefined ? sql`checkpoint_data` : sql`${JSON.stringify(checkpointData)}::jsonb`}
     WHERE id = ${workflowId}
  `);
}

/**
 * 审批 CAS：仅当当前确为 paused_for_approval 才翻 approved。
 * 返回是否赢得本次审批（rowCount===1）。调用方 false → HTTP 409（防双击 / 重试重复 enqueue 下一 phase）。
 */
export async function approveCAS(db: DB, workflowId: string): Promise<boolean> {
  const res = await db.execute(sql`
    UPDATE workflows SET status = 'approved'
     WHERE id = ${workflowId} AND status = 'paused_for_approval'
  `);
  return rowCount(res) === 1;
}

/** 拒绝 CAS（同形态）。 */
export async function rejectCAS(db: DB, workflowId: string): Promise<boolean> {
  const res = await db.execute(sql`
    UPDATE workflows SET status = 'rejected'
     WHERE id = ${workflowId} AND status = 'paused_for_approval'
  `);
  return rowCount(res) === 1;
}

/**
 * 占用 checkpoint 转 running（redo / augment 用）。
 * 同 approveCAS 的原子性——只有一个调用赢得 paused→running，防双决断 / 重复 enqueue。
 */
export async function claimCheckpointToRunning(db: DB, workflowId: string): Promise<boolean> {
  const res = await db.execute(sql`
    UPDATE workflows SET status = 'running'
     WHERE id = ${workflowId} AND status = 'paused_for_approval'
  `);
  return rowCount(res) === 1;
}

/** 某 (workflow, phase) 的下一个 attempt 号（redo / recovery 用）。无既往 attempt 返回 1。 */
export async function nextAttemptNumber(db: DB, workflowId: string, phase: string): Promise<number> {
  const res = await db.execute(sql`
    SELECT COALESCE(MAX(attempt_number), 0) + 1 AS "n"
      FROM phase_attempts
     WHERE workflow_id = ${workflowId} AND phase = ${phase}
  `);
  return Number((res as unknown as { rows?: { n: number }[] }).rows?.[0]?.n ?? 1);
}

/** 审批通过后，下一 phase 开跑：状态回 running。 */
export async function resumeRunning(db: DB, workflowId: string, nextPhase: string): Promise<void> {
  await db.execute(sql`
    UPDATE workflows SET status = 'running', current_phase = ${nextPhase}
     WHERE id = ${workflowId}
  `);
}

// ── phase_attempts：lease / heartbeat / 幂等 / recovery ──

export interface AttemptRow {
  id: string;
  workflowId: string;
  phase: string;
  attemptNumber: number;
  status: string;
  owner: string | null;
}

/**
 * 起一次 phase attempt：INSERT phase_attempts（leased + lease 到期点）。
 * idempotency_key 冲突 → DO NOTHING（重复 enqueue 不会建第二个 attempt）。
 * 返回新建行；冲突（已存在）返回 null。
 */
export async function recordAttempt(
  db: DB,
  args: {
    workflowId: string;
    phase: string;
    attemptNumber: number;
    owner: string;
    bullmqJobId?: string;
    leaseSeconds: number;
  },
): Promise<AttemptRow | null> {
  const key = idempotencyKey(args.workflowId, args.phase, args.attemptNumber);
  const res = await db.execute(sql`
    INSERT INTO phase_attempts
      (workflow_id, phase, attempt_number, status, owner, lease_expires_at, heartbeat_at, bullmq_job_id, idempotency_key)
    VALUES
      (${args.workflowId}, ${args.phase}, ${args.attemptNumber}, 'leased', ${args.owner},
       now() + make_interval(secs => ${args.leaseSeconds}), now(), ${args.bullmqJobId ?? null}, ${key})
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id, workflow_id AS "workflowId", phase, attempt_number AS "attemptNumber", status, owner
  `);
  const rows = (res as unknown as { rows?: AttemptRow[] }).rows ?? [];
  return rows[0] ?? null;
}

/** attempt 真正开跑：leased → running（仅 owner 可推进）。 */
export async function markAttemptRunning(db: DB, attemptId: string, owner: string): Promise<boolean> {
  const res = await db.execute(sql`
    UPDATE phase_attempts SET status = 'running'
     WHERE id = ${attemptId} AND owner = ${owner} AND status = 'leased'
  `);
  return rowCount(res) === 1;
}

/**
 * 续租 heartbeat：仅 owner 且仍 leased/running 才续。
 * 返回 false = 租约已被别人接管（owner 变了或状态变了）——调用方应停止该 attempt（防脑裂）。
 */
export async function heartbeat(
  db: DB,
  attemptId: string,
  owner: string,
  leaseSeconds: number,
): Promise<boolean> {
  const res = await db.execute(sql`
    UPDATE phase_attempts
       SET lease_expires_at = now() + make_interval(secs => ${leaseSeconds}),
           heartbeat_at = now()
     WHERE id = ${attemptId} AND owner = ${owner} AND status IN ('leased','running')
  `);
  return rowCount(res) === 1;
}

export async function completeAttempt(db: DB, attemptId: string, owner: string): Promise<boolean> {
  const res = await db.execute(sql`
    UPDATE phase_attempts SET status = 'completed'
     WHERE id = ${attemptId} AND owner = ${owner}
  `);
  return rowCount(res) === 1;
}

export async function failAttempt(db: DB, attemptId: string, owner: string): Promise<boolean> {
  const res = await db.execute(sql`
    UPDATE phase_attempts SET status = 'failed'
     WHERE id = ${attemptId} AND owner = ${owner}
  `);
  return rowCount(res) === 1;
}

/** 扫描失联 attempt：workflow 仍 running，attempt 仍 leased/running，但 lease 已过期。 */
export async function findOrphanAttempts(db: DB): Promise<AttemptRow[]> {
  const res = await db.execute(sql`
    SELECT a.id, a.workflow_id AS "workflowId", a.phase,
           a.attempt_number AS "attemptNumber", a.status, a.owner
      FROM phase_attempts a
      JOIN workflows w ON w.id = a.workflow_id
     WHERE w.status = 'running'
       AND a.status IN ('leased','running')
       AND a.lease_expires_at < now()
  `);
  return (res as unknown as { rows?: AttemptRow[] }).rows ?? [];
}

/**
 * 恢复 CAS（多 worker 并发裁定单赢家）。
 *
 * 落地偏离 plan 说明：plan 草拟的是「同行 in-place 推进 attempt_number 当判别字段」。实现改为
 * **原子作废旧 attempt（leased/running → failed，guard lease 已过）**当判别——`UPDATE ... WHERE
 * status IN(leased,running) AND lease_expires_at<now()` 只命中一次，赢家拿到接管权。赢家随后用
 * **新 attempt 号（n+1）重新 enqueue**，由 worker 侧幂等 `recordAttempt` 建新行。
 * 这样与 worker 的「recordAttempt 建行」模型干净组合（无需 owner 跨 worker 交接），同时保留 plan 要的
 * 全部性质：DB 写裁单赢家、不重复 enqueue、attempt 号推进、recovery_reason 留痕。
 * 返回 true = 本 worker 赢得对该 orphan 的接管权（应负责 re-enqueue n+1）。
 */
export async function recoverCAS(
  db: DB,
  args: {
    attemptId: string;
    reason: "lease_expired" | "heartbeat_timeout" | "daemon_restart";
  },
): Promise<boolean> {
  const res = await db.execute(sql`
    UPDATE phase_attempts
       SET status = 'failed', recovery_reason = ${args.reason}
     WHERE id = ${args.attemptId}
       AND status IN ('leased','running')
       AND lease_expires_at < now()
  `);
  return rowCount(res) === 1;
}

// ── 幂等 artifact 写 ──

/**
 * 幂等写 artifact：冲突边界 = 既有唯一索引 (workflow_id, phase, type, version)。
 * 同一 attempt 重试写同一 (phase,type,version) → ON CONFLICT DO NOTHING 忽略。
 * idempotency_key 仅作 provenance 留痕（哪个 attempt 写的）。redo 产新 version 是合法新行，不被吞。
 */
export async function writeArtifactIdempotent(
  db: DB,
  args: {
    workflowId: string;
    phase: string;
    type: string;
    version: number;
    body: string;
    status?: "draft" | "below_threshold" | "published";
    idempotencyKey: string;
  },
): Promise<boolean> {
  const res = await db.execute(sql`
    INSERT INTO artifacts (workflow_id, phase, type, version, body, status, idempotency_key)
    VALUES (${args.workflowId}, ${args.phase}, ${args.type}, ${args.version}, ${args.body},
            ${args.status ?? "draft"}, ${args.idempotencyKey})
    ON CONFLICT (workflow_id, phase, type, version) DO NOTHING
  `);
  return rowCount(res) === 1;
}
