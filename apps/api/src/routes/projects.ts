/**
 * 项目路由（U6）。创建（创建者即 owner）/ 列出我的 / 加成员（owner）。
 */

import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { AppDeps } from "../app.ts";
import { authenticate, getUser, requireProjectRole } from "../middleware/auth.ts";
import type { Role } from "../services/rbac.ts";

export function registerProjectRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  app.post("/api/projects", { preHandler: authenticate }, async (req, reply) => {
    const user = getUser(req)!;
    const { name } = (req.body ?? {}) as { name?: string };
    if (!name) return reply.code(400).send({ error: "BAD_REQUEST", message: "name 必填" });
    const res = await db.execute(sql`
      INSERT INTO projects (name, owner_id) VALUES (${name}, ${user.userId}) RETURNING id`);
    const projectId = (res as unknown as { rows: { id: string }[] }).rows[0]!.id;
    return reply.code(201).send({ projectId, name });
  });

  app.get("/api/projects", { preHandler: authenticate }, async (req, reply) => {
    const user = getUser(req)!;
    const res = await db.execute(sql`
      SELECT DISTINCT p.id, p.name
        FROM projects p
        LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ${user.userId}
       WHERE p.owner_id = ${user.userId} OR m.user_id IS NOT NULL
       ORDER BY p.id`);
    return reply.send({ projects: (res as unknown as { rows: unknown[] }).rows });
  });

  app.post(
    "/api/projects/:id/members",
    {
      preHandler: [
        authenticate,
        requireProjectRole(db, "owner", async (req) => (req.params as { id: string }).id),
      ],
    },
    async (req, reply) => {
      const projectId = (req.params as { id: string }).id;
      const { userId, role } = (req.body ?? {}) as { userId?: string; role?: Role };
      if (!userId || !role) return reply.code(400).send({ error: "BAD_REQUEST" });
      try {
        await db.execute(sql`
          INSERT INTO project_members (project_id, user_id, role) VALUES (${projectId}, ${userId}, ${role}::member_role)`);
      } catch {
        return reply.code(409).send({ error: "ALREADY_MEMBER" });
      }
      return reply.code(201).send({ projectId, userId, role });
    },
  );
}
