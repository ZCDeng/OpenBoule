/**
 * 签名分享链接（U6 / KTD-13）——Opaque random token + 服务端持久化记录。
 *
 * token = crypto.randomUUID()（不可推断、无内含信息）。验证流程：查 DB → expiry → revocation →
 * 限流（单 token 10 次/分钟，Redis）→ access_count++ / last_accessed / ip 落库。
 * scope 分 methodology / report，external 角色仅经此访问（无登录）。
 */

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { DB } from "../db/client.ts";

export type ShareScope = "methodology" | "report";
export const RATE_LIMIT_PER_MIN = 10;

export interface CreatedShare {
  token: string;
  workflowId: string;
  scope: ShareScope;
  expiry: Date;
}

export async function createShareToken(
  db: DB,
  args: { workflowId: string; scope: ShareScope; createdBy: string; ttlSec: number; nowMs: number },
): Promise<CreatedShare> {
  const token = randomUUID();
  const nonce = randomUUID();
  const expiry = new Date(args.nowMs + args.ttlSec * 1000);
  await db.execute(sql`
    INSERT INTO share_links (token, workflow_id, scope, expiry, nonce, created_by)
    VALUES (${token}, ${args.workflowId}, ${args.scope}, ${expiry.toISOString()}, ${nonce}, ${args.createdBy})`);
  return { token, workflowId: args.workflowId, scope: args.scope, expiry };
}

export type ShareValidationError =
  | { ok: false; code: "NOT_FOUND"; status: 404 }
  | { ok: false; code: "EXPIRED"; status: 410 }
  | { ok: false; code: "RATE_LIMITED"; status: 429 };

export type ShareValidation =
  | { ok: true; workflowId: string; scope: ShareScope; accessCount: number }
  | ShareValidationError;

interface ShareRow {
  workflowId: string;
  scope: ShareScope;
  expiry: string;
}

/**
 * 验证并计数。撤销 = 记录已删 → NOT_FOUND（schema 无 revoked 列，删行即撤销）。
 * 限流先于计数：超额直接 429，不污染 access_count。
 */
export async function validateShareToken(
  db: DB,
  redis: Redis,
  token: string,
  ctx: { nowMs: number; ip?: string },
): Promise<ShareValidation> {
  const res = await db.execute(sql`
    SELECT workflow_id AS "workflowId", scope, expiry FROM share_links WHERE token = ${token}`);
  const row = (res as unknown as { rows?: ShareRow[] }).rows?.[0];
  if (!row) return { ok: false, code: "NOT_FOUND", status: 404 };

  if (new Date(row.expiry).getTime() <= ctx.nowMs) {
    return { ok: false, code: "EXPIRED", status: 410 };
  }

  // 单 token 限流：固定 60s 窗口 INCR
  const rlKey = `share:rl:${token}`;
  const count = await redis.incr(rlKey);
  if (count === 1) await redis.expire(rlKey, 60);
  if (count > RATE_LIMIT_PER_MIN) {
    return { ok: false, code: "RATE_LIMITED", status: 429 };
  }

  const upd = await db.execute(sql`
    UPDATE share_links
       SET access_count = access_count + 1, last_accessed_at = now(), ip_address = ${ctx.ip ?? null}
     WHERE token = ${token}
    RETURNING access_count AS "accessCount"`);
  const accessCount = Number((upd as unknown as { rows?: { accessCount: number }[] }).rows?.[0]?.accessCount ?? 0);
  return { ok: true, workflowId: row.workflowId, scope: row.scope, accessCount };
}
