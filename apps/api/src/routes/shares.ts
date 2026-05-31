/**
 * 签名分享路由（U6 / KTD-13）。签发（editor+）/ 公开访问（无登录，验 token）。
 */

import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.ts";
import { makeAuthenticate, requireProjectRole } from "../middleware/auth.ts";
import { getWorkflowProjectId } from "../services/rbac.ts";
import { createShareToken, validateShareToken, type ShareScope } from "../services/share-token.ts";

export function registerShareRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, securityRedis } = deps;
  const authenticate = makeAuthenticate(db);
  const now = deps.now ?? Date.now;

  app.post(
    "/api/shares",
    {
      preHandler: [
        authenticate,
        requireProjectRole(db, "editor", async (req) => {
          const { workflowId } = (req.body ?? {}) as { workflowId?: string };
          return workflowId ? getWorkflowProjectId(db, workflowId) : null;
        }),
      ],
    },
    async (req, reply) => {
      const user = (req as { user?: { userId: string } }).user!;
      const { workflowId, scope, ttlSec } = (req.body ?? {}) as {
        workflowId?: string;
        scope?: ShareScope;
        ttlSec?: number;
      };
      if (!workflowId || !scope) return reply.code(400).send({ error: "BAD_REQUEST" });
      const created = await createShareToken(db, {
        workflowId,
        scope,
        createdBy: user.userId,
        ttlSec: ttlSec ?? 7 * 24 * 3600,
        nowMs: now(),
      });
      return reply.code(201).send({ token: created.token, url: `/s/${created.token}`, expiry: created.expiry });
    },
  );

  // 公开访问（external，无登录）。验证 token：404/410/429 或 200。
  app.get("/s/:token", async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const ip = req.ip;
    const result = await validateShareToken(db, securityRedis, token, { nowMs: now(), ip });
    if (!result.ok) {
      return reply.code(result.status).send({ error: result.code });
    }
    return reply.send({ workflowId: result.workflowId, scope: result.scope, accessCount: result.accessCount });
  });
}
