/**
 * Active Context 路由（U1 / KTD-3）。Web 前端心跳写、MCP server 读。
 * 键按已认证 userId 命名空间——你只能写/读自己的 active context（F 簇防越权）。
 */

import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.ts";
import { authenticate, getUser } from "../middleware/auth.ts";
import { readActiveContext, writeActiveContext } from "../mcp/active-context.ts";

export function registerActiveContextRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { securityRedis } = deps;

  // 心跳写：Web 前端每 ~30s 调一次，附当前打开的 project/workflow/phase。
  app.post("/api/active-context", { preHandler: authenticate }, async (req, reply) => {
    const user = getUser(req)!;
    const { projectId, workflowId, phase, document, sessionId } = (req.body ?? {}) as {
      projectId?: string;
      workflowId?: string;
      phase?: string;
      document?: string;
      sessionId?: string;
    };
    await writeActiveContext(securityRedis, user.userId, { projectId, workflowId, phase, document, sessionId });
    return reply.code(204).send();
  });

  // 读：MCP server 用它把缺省的 project/workflow 补全。
  app.get("/api/active-context", { preHandler: authenticate }, async (req, reply) => {
    const user = getUser(req)!;
    const ctx = await readActiveContext(securityRedis, user.userId);
    return reply.send({ activeContext: ctx });
  });
}
