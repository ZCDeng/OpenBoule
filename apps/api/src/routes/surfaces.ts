/**
 * Checkpoint surface 路由（U6 / KTD-18）。
 * 列 pending（viewer+ 可见）/ 回填（写授权在 service：editor+，external/viewer 拒）。
 */

import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { AppDeps } from "../app.ts";
import { makeAuthenticate, requireProjectRole, getUser, getProjectRoleFromReq } from "../middleware/auth.ts";
import { getWorkflowProjectId } from "../services/rbac.ts";
import { listPendingSurfaces, resolvedDigests, respondSurface } from "../services/surface-cache.ts";

export function registerSurfaceRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;
  const authenticate = makeAuthenticate(db);

  // 列 pending surface + 已 resolved 的 schema_digest（run 作用域，客户端据此不重复弹出）
  app.get(
    "/api/workflows/:id/surfaces",
    {
      preHandler: [
        authenticate,
        requireProjectRole(db, "viewer", async (req) => getWorkflowProjectId(db, (req.params as { id: string }).id)),
      ],
    },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const [pending, resolved] = await Promise.all([listPendingSurfaces(db, id), resolvedDigests(db, id)]);
      return reply.send({ pending, resolvedDigests: resolved });
    },
  );

  // 回填：requireProjectRole viewer 先放进来拿到 role，写授权（editor+）由 respondSurface 裁（external/viewer→403）
  app.post(
    "/api/surfaces/:id/respond",
    {
      preHandler: [
        authenticate,
        requireProjectRole(db, "viewer", async (req) => {
          const surfaceId = (req.params as { id: string }).id;
          const res = await db.execute(sql`
            SELECT w.project_id AS "projectId"
              FROM checkpoint_surfaces s JOIN workflows w ON w.id = s.workflow_id
             WHERE s.id = ${surfaceId}`);
          return (res as unknown as { rows?: { projectId: string }[] }).rows?.[0]?.projectId ?? null;
        }),
      ],
    },
    async (req, reply) => {
      const user = getUser(req)!;
      const { role } = getProjectRoleFromReq(req);
      const surfaceId = (req.params as { id: string }).id;
      const result = await respondSurface(db, { surfaceId, userId: user.userId, role: role! });
      if (!result.ok) {
        return reply.code(result.status).send({ error: result.code });
      }
      return reply.send({ ok: true, surfaceId });
    },
  );
}
