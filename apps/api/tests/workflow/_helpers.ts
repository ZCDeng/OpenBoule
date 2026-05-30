/**
 * U4 测试公用 seed/清理（真 Postgres）。非 .test 文件，不被 node:test 收集。
 */

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../src/db/client.ts";

/** 建 user→project→workflow，返回 ids。truthSnapshot 用最小占位（notNull）。 */
export async function seedWorkflow(opts: { axes?: unknown[] } = {}): Promise<{
  userId: string;
  projectId: string;
  workflowId: string;
}> {
  const email = `u-${randomUUID()}@boule.test`;
  const u = await db.execute(sql`
    INSERT INTO users (email, password_hash, name)
    VALUES (${email}, 'x', 'Test') RETURNING id`);
  const userId = (u as unknown as { rows: { id: string }[] }).rows[0]!.id;

  const p = await db.execute(sql`
    INSERT INTO projects (name, owner_id) VALUES ('T', ${userId}) RETURNING id`);
  const projectId = (p as unknown as { rows: { id: string }[] }).rows[0]!.id;

  const axesJson = opts.axes ? sql`${JSON.stringify(opts.axes)}::jsonb` : sql`NULL`;
  const w = await db.execute(sql`
    INSERT INTO workflows (project_id, axes, truth_snapshot)
    VALUES (${projectId}, ${axesJson}, '{"commit_sha":"test"}'::jsonb) RETURNING id`);
  const workflowId = (w as unknown as { rows: { id: string }[] }).rows[0]!.id;

  return { userId, projectId, workflowId };
}

/** 先删 project（级联 workflow/attempts/artifacts/events/members）再删 user（projects.owner_id 无级联）。 */
export async function cleanup(ids: { userId: string; projectId: string }): Promise<void> {
  await db.execute(sql`DELETE FROM projects WHERE id = ${ids.projectId}`);
  await db.execute(sql`DELETE FROM users WHERE id = ${ids.userId}`);
}

/** 直接把 workflow 置为某状态（测 CAS 用）。 */
export async function setStatus(workflowId: string, status: string, phase?: string): Promise<void> {
  await db.execute(sql`
    UPDATE workflows SET status = ${status}::workflow_status
      ${phase ? sql`, current_phase = ${phase}` : sql``}
     WHERE id = ${workflowId}`);
}

export { db };
