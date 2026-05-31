/**
 * API Key 服务（U1 / KTD-8）。MCP server 和 Thin CLI 走 `Authorization: Bearer bk_…`，不便用 cookie。
 *
 * 安全（D/G 簇）：只存 sha256(hash) 不存明文；明文仅创建时回显一次。scope=read 的 key 拒写（由
 * 中间件按 HTTP 方法把关）；project_ids=null 即全账户（需显式授权），否则仅限白名单项目。
 */

import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DB } from "../db/client.ts";
import type { Role } from "./rbac.ts";

export type ApiKeyScope = "read" | "write";

export interface ApiKeyAuth {
  userId: string;
  scope: ApiKeyScope;
  /** null = 全账户；否则白名单 project id 数组。 */
  projectIds: string[] | null;
}

/** 完整 key 的 sha256 十六进制摘要（查表 + 比对都用它，明文绝不落库）。 */
export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** 生成新 key：`bk_` + 16 随机字节 hex。返回明文（仅此一次）+ prefix + hash。 */
export function generateApiKey(): { plaintext: string; prefix: string; keyHash: string } {
  const plaintext = `bk_${randomBytes(16).toString("hex")}`;
  return { plaintext, prefix: plaintext.slice(0, 12), keyHash: hashApiKey(plaintext) };
}

/** Bearer token 是否是 API key（vs JWT）。 */
export function isApiKeyToken(token: string): boolean {
  return token.startsWith("bk_");
}

/**
 * 校验明文 key：命中未撤销行则返回身份 + scope + 项目范围，并刷新 last_used_at；否则 null。
 * 比对走 hash 等值（唯一索引），不做明文比较。
 */
export async function verifyApiKey(db: DB, plaintext: string): Promise<ApiKeyAuth | null> {
  const keyHash = hashApiKey(plaintext);
  // 单条 UPDATE…RETURNING 原子化（code-review #8）：命中即刷 last_used_at 并返身份；0 行 = 无效/已撤销。
  // 省一次往返，消除 SELECT 与 UPDATE 间的竞态。
  const res = await db.execute(sql`
    UPDATE api_keys SET last_used_at = now()
     WHERE key_hash = ${keyHash} AND revoked_at IS NULL
    RETURNING user_id AS "userId", scope, project_ids AS "projectIds"`);
  const row = (res as unknown as { rows?: { userId: string; scope: ApiKeyScope; projectIds: string[] | null }[] })
    .rows?.[0];
  return row ? { userId: row.userId, scope: row.scope, projectIds: row.projectIds } : null;
}

/** 创建一行 api_key（明文不落库；调用方负责把 generateApiKey 的明文回显给用户一次）。 */
export async function createApiKey(
  db: DB,
  args: { userId: string; name: string; scope: ApiKeyScope; projectIds: string[] | null },
): Promise<{ id: string; plaintext: string; prefix: string }> {
  const { plaintext, prefix, keyHash } = generateApiKey();
  const projectIdsJson = args.projectIds === null ? null : JSON.stringify(args.projectIds);
  const res = await db.execute(sql`
    INSERT INTO api_keys (user_id, name, prefix, key_hash, scope, project_ids)
    VALUES (${args.userId}, ${args.name}, ${prefix}, ${keyHash}, ${args.scope}::api_key_scope, ${projectIdsJson}::jsonb)
    RETURNING id`);
  const id = (res as unknown as { rows: { id: string }[] }).rows[0]!.id;
  return { id, plaintext, prefix };
}

/** 列出某用户的 key（不含 hash/明文）。 */
export async function listApiKeys(db: DB, userId: string): Promise<unknown[]> {
  const res = await db.execute(sql`
    SELECT id, name, prefix, scope, project_ids AS "projectIds", revoked_at AS "revokedAt",
           last_used_at AS "lastUsedAt", created_at AS "createdAt"
      FROM api_keys WHERE user_id = ${userId} ORDER BY created_at DESC`);
  return (res as unknown as { rows: unknown[] }).rows;
}

/** 撤销 key（软删：置 revoked_at）。仅本人可撤销自己的 key。返回是否命中。 */
export async function revokeApiKey(db: DB, userId: string, keyId: string): Promise<boolean> {
  const res = await db.execute(sql`
    UPDATE api_keys SET revoked_at = now()
     WHERE id = ${keyId} AND user_id = ${userId} AND revoked_at IS NULL
    RETURNING id`);
  return ((res as unknown as { rows?: unknown[] }).rows ?? []).length > 0;
}

/** 项目范围校验：全账户 key 放行；白名单 key 仅当目标项目在列表内放行。 */
export function apiKeyAllowsProject(auth: ApiKeyAuth, projectId: string): boolean {
  return auth.projectIds === null || auth.projectIds.includes(projectId);
}

/** scope=read 的 key 仅允许只读 HTTP 方法。 */
export function isReadOnlyMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

/** RBAC 角色是否满足 API key scope（write key 不放大角色，仅与角色取交集）。 */
export function scopeSatisfiesRole(_scope: ApiKeyScope, _role: Role): boolean {
  return true; // 角色由 requireProjectRole 独立把关；scope 只在方法层（见中间件）做读写门
}
