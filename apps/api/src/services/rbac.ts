/**
 * 项目 RBAC（U6 / KTD-12）。四级角色 + 成员/项目解析。
 *
 * 角色层级（rank 越大权限越高）：external < viewer < editor < owner。
 * 越权防线一律走「查成员资格 + 比 rank」，不靠前端/Origin（KTD-14：访问控制只走 JWT/token）。
 */

import { sql } from "drizzle-orm";
import type { DB } from "../db/client.ts";

export type Role = "external" | "viewer" | "editor" | "owner";

const RANK: Record<Role, number> = { external: 0, viewer: 1, editor: 2, owner: 3 };

export function hasMinRole(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

/** 查 user 在 project 的角色；非成员返回 null。owner（projects.owner_id）隐式拥有 owner 角色。 */
export async function getProjectRole(db: DB, userId: string, projectId: string): Promise<Role | null> {
  const owner = await db.execute(sql`
    SELECT 1 FROM projects WHERE id = ${projectId} AND owner_id = ${userId}`);
  if (((owner as unknown as { rows?: unknown[] }).rows ?? []).length > 0) return "owner";

  const res = await db.execute(sql`
    SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${userId}`);
  const row = (res as unknown as { rows?: { role: Role }[] }).rows?.[0];
  return row ? row.role : null;
}

/** 由 workflow 反查所属 project（workflow/artifact 路由解析成员资格用）。 */
export async function getWorkflowProjectId(db: DB, workflowId: string): Promise<string | null> {
  const res = await db.execute(sql`SELECT project_id AS "projectId" FROM workflows WHERE id = ${workflowId}`);
  return (res as unknown as { rows?: { projectId: string }[] }).rows?.[0]?.projectId ?? null;
}

/** 由 artifact 反查所属 workflow + project。 */
export async function getArtifactContext(
  db: DB,
  artifactId: string,
): Promise<{ workflowId: string; projectId: string } | null> {
  const res = await db.execute(sql`
    SELECT a.workflow_id AS "workflowId", w.project_id AS "projectId"
      FROM artifacts a JOIN workflows w ON w.id = a.workflow_id
     WHERE a.id = ${artifactId}`);
  return (res as unknown as { rows?: { workflowId: string; projectId: string }[] }).rows?.[0] ?? null;
}
