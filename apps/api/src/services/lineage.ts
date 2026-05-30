/**
 * Artifact lineage / stale 传播（U9）。
 *
 * 依赖链 = PHASE_IDS 顺序：编辑 Phase N 产出 → Phase N+1 及之后所有下游标 stale=true。
 * v1 不自动级联——只标记 + 上报受影响下游，用户确认后才重跑（与 OD「refresh 是显式 action」同哲学）。
 * 纯传播函数可穷举测；DB 标记/查询分开。
 */

import { sql, type SQL } from "drizzle-orm";
import type { DB } from "../db/client.ts";
import { PHASE_IDS, type PhaseId } from "../workflow/state.ts";

/** 编辑 phase 的所有下游 phase（严格在其后者）。未知 phase → 空。 */
export function downstreamPhases(editedPhase: string): PhaseId[] {
  const i = (PHASE_IDS as readonly string[]).indexOf(editedPhase);
  if (i < 0) return [];
  return PHASE_IDS.slice(i + 1) as unknown as PhaseId[];
}

/** 把下游 phase 的 artifact 标 stale=true，返回受影响的 phase 列表（有 artifact 的才算）。 */
export async function markDownstreamStale(db: DB, workflowId: string, editedPhase: string): Promise<string[]> {
  const downstream = downstreamPhases(editedPhase);
  if (downstream.length === 0) return [];
  const inList: SQL = sql.join(downstream.map((p) => sql`${p}`), sql`, `);
  const res = await db.execute(sql`
    UPDATE artifacts SET stale = true
     WHERE workflow_id = ${workflowId} AND phase IN (${inList})
    RETURNING phase`);
  const phases = (res as unknown as { rows?: { phase: string }[] }).rows?.map((r) => r.phase) ?? [];
  return [...new Set(phases)];
}

/** 列出 workflow 内当前 stale 的下游 phase。 */
export async function listStalePhases(db: DB, workflowId: string): Promise<string[]> {
  const res = await db.execute(sql`
    SELECT DISTINCT phase FROM artifacts WHERE workflow_id = ${workflowId} AND stale = true`);
  return (res as unknown as { rows?: { phase: string }[] }).rows?.map((r) => r.phase) ?? [];
}

/** 重跑某 phase 后清其 stale 旗标。 */
export async function clearStale(db: DB, workflowId: string, phase: string): Promise<void> {
  await db.execute(sql`
    UPDATE artifacts SET stale = false WHERE workflow_id = ${workflowId} AND phase = ${phase}`);
}

/** 重跑审计（借鉴 OD refreshes.jsonl + provenance）。落 workflow_events，外部可 tail。 */
export async function logRerun(
  db: DB,
  workflowId: string,
  entry: { phase: string; status: string; readArtifactVersions?: unknown; error?: string },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO workflow_events (run_id, event, data)
    VALUES (${workflowId}, 'rerun-audit', ${JSON.stringify(entry)}::jsonb)`);
}
