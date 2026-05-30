/**
 * 工作流路由（U6）。创建（owner，固化真值源快照 + 启引擎）/ 查状态（viewer+）。
 */

import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { AppDeps } from "../app.ts";
import { authenticate, requireProjectRole } from "../middleware/auth.ts";
import { getWorkflowProjectId } from "../services/rbac.ts";

export function registerWorkflowRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  app.post(
    "/api/workflows",
    {
      preHandler: [
        authenticate,
        requireProjectRole(db, "owner", async (req) => {
          const { projectId } = (req.body ?? {}) as { projectId?: string };
          return projectId ?? null;
        }),
      ],
    },
    async (req, reply) => {
      const { projectId, mode, axes } = (req.body ?? {}) as { projectId?: string; mode?: string; axes?: unknown[] };
      // 创建时固化真值源快照（不可变，所有 phase/retry 只读它）。
      // 值必须源自 truth/sync.ts#createFrozenSnapshot（经注入的 snapshotProvider）——
      // 缺 provider 即 503，绝不在此**伪造** snapshot（KTD-20 写入收口，见 write-funnel.guard）。
      if (!deps.snapshotProvider) {
        return reply.code(503).send({ error: "TRUTH_SOURCE_UNCONFIGURED", message: "未配置真值源快照提供者" });
      }
      const snapshot = await deps.snapshotProvider();
      const res = await db.execute(sql`
        INSERT INTO workflows (project_id, mode, axes, truth_snapshot)
        VALUES (${projectId}, ${mode ?? null}, ${axes ? sql`${JSON.stringify(axes)}::jsonb` : sql`NULL`},
                ${JSON.stringify(snapshot)}::jsonb)
        RETURNING id`);
      const workflowId = (res as unknown as { rows: { id: string }[] }).rows[0]!.id;

      if (deps.engine) await deps.engine.startWorkflow(workflowId);
      return reply.code(201).send({ workflowId, started: !!deps.engine });
    },
  );

  app.get(
    "/api/workflows/:id",
    {
      preHandler: [
        authenticate,
        requireProjectRole(db, "viewer", async (req) => getWorkflowProjectId(db, (req.params as { id: string }).id)),
      ],
    },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const res = await db.execute(sql`
        SELECT id, project_id AS "projectId", current_phase AS "currentPhase", status, mode, axes
          FROM workflows WHERE id = ${id}`);
      const row = (res as unknown as { rows?: unknown[] }).rows?.[0];
      if (!row) return reply.code(404).send({ error: "NOT_FOUND" });
      return reply.send(row);
    },
  );
}
