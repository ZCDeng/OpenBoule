/**
 * Checkpoint surface 服务 + run 作用域缓存（U6 / KTD-18，借鉴 OD GenUI）。
 *
 * 核心纪律（KTD-18）：checkpoint 决策是 **run 级事实**（editor 替全队决定），不是 per-user 偏好。
 * - 缓存键按 **run 作用域**（surface_cache:{workflow_id}:{schema_digest}），**不含 user_id**——
 *   否则团队共享 run 几乎不命中，或被迫跨用户复用＝越权。
 * - 越权防线在 **respond 的写授权**（RBAC）：只有 editor+ 能回填，external 禁止，每次写 responded_by 留痕。
 */

import { sql } from "drizzle-orm";
import type { DB } from "../db/client.ts";
import { hasMinRole, type Role } from "./rbac.ts";

/** run 作用域缓存键——刻意不含 user_id（团队共享 run 的 checkpoint 是共享事实）。 */
export function surfaceCacheKey(workflowId: string, schemaDigest: string): string {
  return `surface_cache:${workflowId}:${schemaDigest}`;
}

export interface SurfaceRow {
  id: string;
  workflowId: string;
  phase: string;
  schemaDigest: string;
  status: "pending" | "resolved" | "timeout" | "invalidated";
}

/**
 * 建 surface_request。若同 (run, schema_digest) 已有 pending/resolved，**不重复建**（不重复弹出）。
 * 返回既有或新建行。
 */
export async function requestSurface(
  db: DB,
  args: { workflowId: string; phase: string; schemaDigest: string; persistTier?: string },
): Promise<SurfaceRow> {
  const existing = await db.execute(sql`
    SELECT id, workflow_id AS "workflowId", phase, schema_digest AS "schemaDigest", status
      FROM checkpoint_surfaces
     WHERE workflow_id = ${args.workflowId} AND schema_digest = ${args.schemaDigest}
       AND status IN ('pending','resolved')
     LIMIT 1`);
  const found = (existing as unknown as { rows?: SurfaceRow[] }).rows?.[0];
  if (found) return found;

  const res = await db.execute(sql`
    INSERT INTO checkpoint_surfaces (workflow_id, phase, schema_digest, status, persist_tier)
    VALUES (${args.workflowId}, ${args.phase}, ${args.schemaDigest}, 'pending', ${args.persistTier ?? null})
    RETURNING id, workflow_id AS "workflowId", phase, schema_digest AS "schemaDigest", status`);
  return (res as unknown as { rows: SurfaceRow[] }).rows[0]!;
}

/** 重连时拉仍 pending 的 surface（viewer 也能看到，但不能回填）。 */
export async function listPendingSurfaces(db: DB, workflowId: string): Promise<SurfaceRow[]> {
  const res = await db.execute(sql`
    SELECT id, workflow_id AS "workflowId", phase, schema_digest AS "schemaDigest", status
      FROM checkpoint_surfaces
     WHERE workflow_id = ${workflowId} AND status = 'pending'
     ORDER BY created_at ASC`);
  return (res as unknown as { rows?: SurfaceRow[] }).rows ?? [];
}

/** 同 run 已 resolved 的 schema_digest 集（客户端据此「不重复弹出」，run 作用域）。 */
export async function resolvedDigests(db: DB, workflowId: string): Promise<string[]> {
  const res = await db.execute(sql`
    SELECT DISTINCT schema_digest AS "schemaDigest"
      FROM checkpoint_surfaces WHERE workflow_id = ${workflowId} AND status = 'resolved'`);
  return (res as unknown as { rows?: { schemaDigest: string }[] }).rows?.map((r) => r.schemaDigest) ?? [];
}

export type RespondResult =
  | { ok: true; surfaceId: string }
  | { ok: false; code: "FORBIDDEN"; status: 403 }
  | { ok: false; code: "CONFLICT"; status: 409 };

/**
 * 回填 surface。**写授权门控**：role 必须 editor+（external/viewer 拒 403）。
 * CAS：仅 pending → resolved，并写 responded_by{user_id, role} 留痕；非 pending → 409。
 */
export async function respondSurface(
  db: DB,
  args: { surfaceId: string; userId: string; role: Role },
): Promise<RespondResult> {
  if (!hasMinRole(args.role, "editor")) {
    return { ok: false, code: "FORBIDDEN", status: 403 }; // viewer/external 禁止回填
  }
  const respondedBy = JSON.stringify({ user_id: args.userId, role: args.role });
  const res = await db.execute(sql`
    UPDATE checkpoint_surfaces
       SET status = 'resolved', responded_by = ${respondedBy}::jsonb
     WHERE id = ${args.surfaceId} AND status = 'pending'`);
  const affected = (res as { rowCount?: number | null }).rowCount ?? 0;
  return affected === 1 ? { ok: true, surfaceId: args.surfaceId } : { ok: false, code: "CONFLICT", status: 409 };
}
