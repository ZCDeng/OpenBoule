/**
 * 签名访问校验（U10）。在 share-token 的 404/410/429 流程上叠加 **scope 匹配（403）**。
 * 撤销（nonce 撤销集→410）与限流/过期/计数在 share-token.validateShareToken 内统一处理。
 */

import type { Redis } from "ioredis";
import type { DB } from "../db/client.ts";
import { validateShareToken, type ShareScope } from "../services/share-token.ts";

export type ScopedAccess =
  | { ok: true; workflowId: string; scope: ShareScope }
  | { ok: false; status: 404 | 410 | 429 | 403; code: string };

/** 校验 token 且 scope 必须匹配请求资源（不匹配 → 403）。 */
export async function validateForScope(
  db: DB,
  redis: Redis,
  token: string,
  requiredScope: ShareScope,
  ctx: { nowMs: number; ip?: string },
): Promise<ScopedAccess> {
  const v = await validateShareToken(db, redis, token, ctx);
  if (!v.ok) return { ok: false, status: v.status, code: v.code };
  if (v.scope !== requiredScope) {
    return { ok: false, status: 403, code: "SCOPE_MISMATCH" };
  }
  return { ok: true, workflowId: v.workflowId, scope: v.scope };
}
