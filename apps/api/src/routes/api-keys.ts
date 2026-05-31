/**
 * API Key 管理路由（U1 / KTD-8）。用户管自己的 key：创建（明文回显一次）/ 列出 / 撤销。
 * 走 authenticate（Web 会话或已有 key）；明文绝不二次返回。
 */

import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.ts";
import { authenticate, getUser } from "../middleware/auth.ts";
import { createApiKey, listApiKeys, revokeApiKey, type ApiKeyScope } from "../services/api-keys.ts";

export function registerApiKeyRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  app.post("/api/api-keys", { preHandler: authenticate }, async (req, reply) => {
    const user = getUser(req)!;
    const { name, scope, projectIds } = (req.body ?? {}) as {
      name?: string;
      scope?: ApiKeyScope;
      projectIds?: string[] | null;
    };
    if (!name) return reply.code(400).send({ error: "BAD_REQUEST", message: "name 必填" });
    if (scope && scope !== "read" && scope !== "write") {
      return reply.code(400).send({ error: "BAD_REQUEST", message: "scope 仅 read|write" });
    }
    if (projectIds !== undefined && projectIds !== null && !Array.isArray(projectIds)) {
      return reply.code(400).send({ error: "BAD_REQUEST", message: "projectIds 需为数组或 null" });
    }
    const created = await createApiKey(db, {
      userId: user.userId,
      name,
      scope: scope ?? "write",
      projectIds: projectIds ?? null,
    });
    // 明文仅此一次回显——客户端须立即保存。
    return reply.code(201).send({ id: created.id, prefix: created.prefix, apiKey: created.plaintext });
  });

  app.get("/api/api-keys", { preHandler: authenticate }, async (req, reply) => {
    const user = getUser(req)!;
    return reply.send({ keys: await listApiKeys(db, user.userId) });
  });

  app.delete("/api/api-keys/:id", { preHandler: authenticate }, async (req, reply) => {
    const user = getUser(req)!;
    const id = (req.params as { id: string }).id;
    const ok = await revokeApiKey(db, user.userId, id);
    if (!ok) return reply.code(404).send({ error: "NOT_FOUND", message: "key 不存在或已撤销" });
    return reply.code(200).send({ revoked: id });
  });
}
