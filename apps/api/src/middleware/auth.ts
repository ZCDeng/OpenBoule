/**
 * 认证 + RBAC 中间件（U6 / KTD-12, KTD-14）。
 *
 * authenticate：从 Authorization Bearer 或 HttpOnly cookie 取 access token → verifyJwt → req.user。
 * 失败 401。requireProjectRole：解析 projectId（按路由不同）→ 查角色 → 比 rank，不足 403 + 审计。
 * 访问控制只走 JWT/成员资格，绝不信 Origin（CORS 仅预检）。
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyJwt, JwtError } from "../auth/jwt.ts";
import { config } from "../config.ts";
import { getProjectRole, hasMinRole, type Role } from "../services/rbac.ts";
import type { DB } from "../db/client.ts";

export interface AuthUser {
  userId: string;
}

/** 把已认证用户挂到 req（避免全局 module augmentation 的脆弱性）。 */
export function setUser(req: FastifyRequest, user: AuthUser): void {
  (req as FastifyRequest & { user?: AuthUser }).user = user;
}
export function getUser(req: FastifyRequest): AuthUser | undefined {
  return (req as FastifyRequest & { user?: AuthUser }).user;
}

export const ACCESS_COOKIE = "boule_token";

/** 从 Bearer 头或 cookie 取 token。 */
function extractToken(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (h && h.startsWith("Bearer ")) return h.slice(7).trim();
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  return cookies?.[ACCESS_COOKIE] ?? null;
}

/** preHandler：校验 access token，挂 req.user；缺失/无效/过期 → 401。 */
export async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    await reply.code(401).send({ error: "UNAUTHENTICATED", message: "缺少凭证" });
    return;
  }
  try {
    const payload = verifyJwt(token, config.jwt.secret, Math.floor(Date.now() / 1000));
    if (payload.type !== "access") throw new JwtError("非 access token");
    setUser(req, { userId: payload.sub });
  } catch (err) {
    const message = err instanceof JwtError ? err.message : "无效 token";
    await reply.code(401).send({ error: "UNAUTHENTICATED", message });
  }
}

/** projectId 解析器（按路由不同：直接取 param、或经 workflow/artifact 反查）。 */
export type ProjectResolver = (req: FastifyRequest, db: DB) => Promise<string | null>;

/**
 * preHandler 工厂：要求当前用户在目标 project 至少 minRole。
 * 解析不到 project → 404；非成员或角色不足 → 403（审计 log）。
 * 依赖 authenticate 已先跑（req.user 存在）。
 */
export function requireProjectRole(db: DB, minRole: Role, resolve: ProjectResolver) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = getUser(req);
    if (!user) {
      await reply.code(401).send({ error: "UNAUTHENTICATED" });
      return;
    }
    const projectId = await resolve(req, db);
    if (!projectId) {
      await reply.code(404).send({ error: "NOT_FOUND", message: "目标项目/资源不存在" });
      return;
    }
    const role = await getProjectRole(db, user.userId, projectId);
    if (!role || !hasMinRole(role, minRole)) {
      req.log.warn({ userId: user.userId, projectId, role, minRole }, "RBAC 拒绝");
      await reply.code(403).send({ error: "FORBIDDEN", message: `需要 ${minRole} 及以上角色` });
      return;
    }
    // 把解析到的角色/项目挂上，路由内复用（如 surface respond 写 responded_by）
    (req as FastifyRequest & { projectRole?: Role; projectId?: string }).projectRole = role;
    (req as FastifyRequest & { projectRole?: Role; projectId?: string }).projectId = projectId;
  };
}

export function getProjectRoleFromReq(req: FastifyRequest): { role?: Role; projectId?: string } {
  const r = req as FastifyRequest & { projectRole?: Role; projectId?: string };
  return { role: r.projectRole, projectId: r.projectId };
}
