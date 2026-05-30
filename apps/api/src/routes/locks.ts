/**
 * 文档锁路由（U9 / KTD-16）。获取/心跳/释放（editor+）/ 查状态（viewer+）。
 * 锁 docId = artifactId（v1：锁具体版本行；逻辑文档级锁待版本聚合需求上来再细化）。
 */

import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.ts";
import { authenticate, requireProjectRole, getUser } from "../middleware/auth.ts";
import { getArtifactContext } from "../services/rbac.ts";
import { acquireLock, heartbeatLock, releaseLock, lockStatus } from "../services/doc-lock.ts";

export function registerLockRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, securityRedis } = deps;
  const artifactProject = async (req: { params: unknown }) => {
    const ctx = await getArtifactContext(db, (req.params as { id: string }).id);
    return ctx?.projectId ?? null;
  };
  const docId = (req: { params: unknown }) => (req.params as { id: string }).id;

  app.post(
    "/api/artifacts/:id/lock",
    { preHandler: [authenticate, requireProjectRole(db, "editor", artifactProject)] },
    async (req, reply) => {
      const user = getUser(req)!;
      const r = await acquireLock(securityRedis, docId(req), user.userId);
      if (!r.ok) return reply.code(409).send({ error: "LOCKED", holder: r.holder, ttlSec: r.ttlSec });
      return reply.send({ ok: true, holder: r.holder });
    },
  );

  app.post(
    "/api/artifacts/:id/lock/heartbeat",
    { preHandler: [authenticate, requireProjectRole(db, "editor", artifactProject)] },
    async (req, reply) => {
      const user = getUser(req)!;
      const ok = await heartbeatLock(securityRedis, docId(req), user.userId);
      if (!ok) return reply.code(409).send({ error: "LOCK_LOST" });
      return reply.send({ ok: true });
    },
  );

  app.delete(
    "/api/artifacts/:id/lock",
    { preHandler: [authenticate, requireProjectRole(db, "editor", artifactProject)] },
    async (req, reply) => {
      const user = getUser(req)!;
      const ok = await releaseLock(securityRedis, docId(req), user.userId);
      return reply.send({ ok });
    },
  );

  app.get(
    "/api/artifacts/:id/lock",
    { preHandler: [authenticate, requireProjectRole(db, "viewer", artifactProject)] },
    async (req, reply) => {
      return reply.send({ lock: await lockStatus(securityRedis, docId(req)) });
    },
  );
}
