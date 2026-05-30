/**
 * U6 路由测试公用（真 PG + 真 Redis securityDb）。非 .test，不被收集。
 */

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppDeps } from "../../src/app.ts";
import { db } from "../../src/db/client.ts";
import { createSecurityRedis } from "../../src/services/redis.ts";

export { db };
export const securityRedis = createSecurityRedis();

export function makeApp(overrides: Partial<AppDeps> = {}): FastifyInstance {
  return buildApp({ db, securityRedis, ...overrides });
}

/** 注册一个用户，返回 id + access token（经真实 register 路由）。 */
export async function registerUser(app: FastifyInstance): Promise<{ userId: string; token: string; email: string }> {
  const email = `u-${randomUUID()}@boule.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email, password: "pw-123456", name: "T" },
  });
  const body = res.json() as { userId: string; accessToken: string };
  return { userId: body.userId, token: body.accessToken, email };
}

export function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** 直接建 project（owner=userId）。 */
export async function seedProject(ownerId: string): Promise<string> {
  const r = await db.execute(sql`INSERT INTO projects (name, owner_id) VALUES ('T', ${ownerId}) RETURNING id`);
  return (r as unknown as { rows: { id: string }[] }).rows[0]!.id;
}

export async function addMember(projectId: string, userId: string, role: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO project_members (project_id, user_id, role) VALUES (${projectId}, ${userId}, ${role}::member_role)`);
}

/** 建 workflow（最小快照）。 */
export async function seedWorkflow(projectId: string): Promise<string> {
  const r = await db.execute(sql`
    INSERT INTO workflows (project_id, truth_snapshot) VALUES (${projectId}, '{"commit_sha":"t"}'::jsonb) RETURNING id`);
  return (r as unknown as { rows: { id: string }[] }).rows[0]!.id;
}

/** 清理：删一组 user + project（project 级联 workflow/artifacts/surfaces/events）。 */
export async function cleanupAll(userIds: string[], projectIds: string[]): Promise<void> {
  for (const pid of projectIds) await db.execute(sql`DELETE FROM projects WHERE id = ${pid}`);
  for (const uid of userIds) await db.execute(sql`DELETE FROM users WHERE id = ${uid}`);
}
