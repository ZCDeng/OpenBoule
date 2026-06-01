/**
 * SSE 路由（U6 / KTD-14, KTD-19）。
 * - POST /api/sse/ticket：已认证用户换 30s 一次性 ticket（token 不进 query）。
 * - GET /api/sse/workflows/:id：ticket 或 cookie 鉴权 → 重新校验 run 读权限 → 回放 + keepalive。
 *   鉴权/授权失败正常返回（401/403/404，可测）；成功才 hijack 接管流。
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppDeps } from "../app.ts";
import { makeAuthenticate, getUser } from "../middleware/auth.ts";
import { verifyJwt } from "../auth/jwt.ts";
import { config } from "../config.ts";
import { issueSseTicket, consumeSseTicket, authorizeSse, replayEvents } from "../services/sse.ts";

const KEEPALIVE_MS = 25_000;
const POLL_MS = 1000;

export function registerSseRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, securityRedis } = deps;
  const authenticate = makeAuthenticate(db);
  const now = deps.now ?? Date.now;

  app.post("/api/sse/ticket", { preHandler: authenticate }, async (req, reply) => {
    const user = getUser(req)!;
    const ticket = await issueSseTicket(securityRedis, user.userId);
    return reply.send({ ticket });
  });

  // 解析 userId：优先一次性 ticket（query），否则 cookie/Bearer JWT。
  async function resolveUserId(req: FastifyRequest): Promise<string | null> {
    const ticket = (req.query as { ticket?: string }).ticket;
    if (ticket) return consumeSseTicket(securityRedis, ticket);
    const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
    const token = cookies?.boule_token ?? (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : undefined);
    if (!token) return null;
    try {
      const p = verifyJwt(token, config.jwt.secret, Math.floor(now() / 1000));
      return p.type === "access" ? p.sub : null;
    } catch {
      return null;
    }
  }

  app.get("/api/sse/workflows/:id", async (req, reply) => {
    const userId = await resolveUserId(req);
    if (!userId) return reply.code(401).send({ error: "UNAUTHENTICATED" });

    const workflowId = (req.params as { id: string }).id;
    // 重连＝一次全新鉴权：重新查当前角色，被移除/降权 → 403
    const authz = await authorizeSse(db, userId, workflowId);
    if (!authz.ok) return reply.code(authz.status).send({ error: authz.status === 403 ? "FORBIDDEN" : "NOT_FOUND" });

    const queryLastEventId = Number((req.query as { lastEventId?: string }).lastEventId ?? 0) || 0;
    const headerLastEventId = Number(req.headers["last-event-id"] ?? 0) || 0;
    let lastEventId = Math.max(queryLastEventId, headerLastEventId);
    const backlog = await replayEvents(db, workflowId, lastEventId);

    // 成功：接管原始响应流（hijack，Fastify 不再托管）
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // 关代理缓冲，事件即时下发
    });
    for (const ev of backlog) {
      raw.write(`id: ${ev.eventId}\nevent: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`);
      lastEventId = Math.max(lastEventId, ev.eventId);
    }
    const keepalive = setInterval(() => raw.write(`: keepalive\n\n`), KEEPALIVE_MS);
    keepalive.unref?.();
    let polling = false;
    const poll = setInterval(() => {
      if (polling || raw.destroyed || raw.writableEnded) return;
      polling = true;
      void replayEvents(db, workflowId, lastEventId)
        .then((events) => {
          for (const ev of events) {
            raw.write(`id: ${ev.eventId}\nevent: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`);
            lastEventId = Math.max(lastEventId, ev.eventId);
          }
        })
        .catch(() => {
          raw.write(`: event poll failed\n\n`);
        })
        .finally(() => {
          polling = false;
        });
    }, POLL_MS);
    poll.unref?.();
    req.raw.on("close", () => {
      clearInterval(keepalive);
      clearInterval(poll);
    });
  });
}
