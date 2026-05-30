/**
 * SSE 鉴权 + 回放服务（U6 / KTD-14, KTD-19）。
 *
 * - 鉴权 ticket（KTD-14）：token 不走 query param（会进访问日志/Referer）。用 Bearer 头换一个
 *   30s TTL **一次性** ticket（存 Redis securityDb），再放 query。consume 即删（防重放）。
 * - 回放（KTD-19）：跨进程真值源是 Postgres workflow_events（产事件的 worker ≠ 持连接的 Fastify 副本，
 *   in-heap Map 重连必丢）。按 Last-Event-ID range-scan id>lastEventId，复用 workflow/events.getEventsSince。
 * - **重连＝一次全新鉴权**：回放前重新查 run 所属 project 的当前成员/角色，被移除/降权 → 403，
 *   绝不回放它已无权接收的 agent-progress。
 */

import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { DB } from "../db/client.ts";
import { getEventsSince, type BufferedEvent } from "../workflow/events.ts";
import { getProjectRole, hasMinRole, getWorkflowProjectId, type Role } from "./rbac.ts";

export const TICKET_TTL_SEC = 30;

/** 签发一次性 SSE ticket（已认证用户换）。返回 ticket id（放 query：?ticket=...）。 */
export async function issueSseTicket(redis: Redis, userId: string): Promise<string> {
  const ticket = randomUUID();
  await redis.set(`sse:ticket:${ticket}`, userId, "EX", TICKET_TTL_SEC);
  return ticket;
}

/** 消费 ticket（一次性：GETDEL，命中即删防重放）。返回 userId 或 null。 */
export async function consumeSseTicket(redis: Redis, ticket: string): Promise<string | null> {
  // GETDEL 原子取删（Redis ≥6.2）
  const userId = await redis.getdel(`sse:ticket:${ticket}`);
  return userId ?? null;
}

export type SseAuthz =
  | { ok: true; role: Role }
  | { ok: false; status: 403 | 404 };

/**
 * 连接/重连鉴权：解析 run→project，查当前角色，需 ≥viewer。
 * 中途被移除/降权的用户重连 → 403（不回放无权事件）。
 */
export async function authorizeSse(db: DB, userId: string, workflowId: string): Promise<SseAuthz> {
  const projectId = await getWorkflowProjectId(db, workflowId);
  if (!projectId) return { ok: false, status: 404 };
  const role = await getProjectRole(db, userId, projectId);
  if (!role || !hasMinRole(role, "viewer")) return { ok: false, status: 403 };
  return { ok: true, role };
}

/** 断点续传：只补 id>lastEventId 的事件（不重投、不漏投）。lastEventId 缺省 0 = 全量。 */
export async function replayEvents(db: DB, workflowId: string, lastEventId: number): Promise<BufferedEvent[]> {
  return getEventsSince(db, workflowId, lastEventId);
}
