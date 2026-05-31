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
import {
  isApiKeyToken,
  isReadOnlyMethod,
  verifyApiKey,
  apiKeyAllowsProject,
  type ApiKeyAuth,
} from "../services/api-keys.ts";
import type { DB } from "../db/client.ts";

export interface AuthUser {
  userId: string;
  /** 经 API key 认证时携带（MCP/CLI，U1/KTD-8）；JWT cookie 认证时缺省。 */
  apiKey?: ApiKeyAuth;
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

/**
 * preHandler 工厂：校验 access token，挂 req.user；缺失/无效/过期 → 401。
 *
 * 双路径（additive，KTD-8）：`bk_` 前缀 → API key（MCP/CLI），否则 → JWT（Web cookie/Bearer）。
 * db 经注入（对齐 requireProjectRole 范式，#5）——不再 import 进程单例，避免测试注入别的 db 时
 * API-key 校验静默打错库。read scope 的 key 拒非只读方法 → 403。
 *
 * 各路由在 register*Routes 顶部 `const authenticate = makeAuthenticate(deps.db)` 复用，调用点不变。
 */
export function makeAuthenticate(db: DB) {
  return async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    // 本地模式（U2）：localModeHook 已在 onRequest 注入 req.user，此处直接放行（免登录）。
    if (getUser(req)) return;
    const token = extractToken(req);
    if (!token) {
      await reply.code(401).send({ error: "UNAUTHENTICATED", message: "缺少凭证" });
      return;
    }
    if (isApiKeyToken(token)) {
      const auth = await verifyApiKey(db, token);
      if (!auth) {
        await reply.code(401).send({ error: "UNAUTHENTICATED", message: "无效或已撤销的 API key" });
        return;
      }
      if (auth.scope === "read" && !isReadOnlyMethod(req.method)) {
        await reply.code(403).send({ error: "FORBIDDEN", message: "只读 API key 不可写" });
        return;
      }
      setUser(req, { userId: auth.userId, apiKey: auth });
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
  };
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
    // API key 项目范围（D 簇）：白名单 key 命中范围外项目即拒，先于角色判定（缩小泄露面）。
    if (user.apiKey && !apiKeyAllowsProject(user.apiKey, projectId)) {
      req.log.warn({ userId: user.userId, projectId }, "API key 项目范围拒绝");
      await reply.code(403).send({ error: "FORBIDDEN", message: "API key 无此项目权限" });
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

/**
 * 拒绝 API-key 认证的请求（key 管理端点专用）。key 只能用 Web 会话管理——否则一个泄露的
 * write key 可 mint 新的全账户 key 逃逸自身 scope（code-review #1 提权）。依赖 authenticate 先跑。
 */
export async function rejectApiKeyAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (getUser(req)?.apiKey) {
    await reply.code(403).send({ error: "FORBIDDEN", message: "API key 不能管理 key，请用 Web 会话" });
  }
}

/**
 * 拒绝 project-scoped key（projectIds 非 null）创建新项目——scoped key 创建白名单外项目会绕过其
 * 自身约束（code-review #1）。全账户 key（projectIds=null）放行。依赖 authenticate 先跑。
 */
export async function rejectScopedApiKey(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const apiKey = getUser(req)?.apiKey;
  if (apiKey && apiKey.projectIds !== null) {
    await reply.code(403).send({ error: "FORBIDDEN", message: "受限 API key 不能创建新项目" });
  }
}

/** Host 头是否指向本机（U2 本地模式 anti-DNS-rebinding，纯函数）。允许任意端口。 */
export function isLocalHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  let host = hostHeader.trim().toLowerCase();
  // 括号 IPv6（[::1]:3100）：取括号内。裸 ::1 直接命中下方判定，不做端口剥离（避免吃掉 :1）。
  const bracket = host.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracket) host = bracket[1]!;
  else if (/^[^:]+:\d+$/.test(host)) host = host.replace(/:\d+$/, ""); // 仅 host:port（单冒号）剥端口
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host.startsWith("127.");
}

/** 回环地址判定（U2 本地模式 loopback-only 守卫，纯函数便于测试）。 */
export function isLoopbackAddress(ip: string | undefined): boolean {
  if (!ip) return false;
  const a = ip.trim().toLowerCase();
  return (
    a === "127.0.0.1" ||
    a === "::1" ||
    a === "::ffff:127.0.0.1" ||
    a === "localhost" ||
    a.startsWith("127.")
  );
}

/**
 * 本地模式 onRequest 钩子（U2）：①拒非回环来源（403，防局域网/容器以 owner 身份访问，F/安全簇）
 * ②注入固定本地用户（免登录，下游 authenticate 见 req.user 已设即放行）。
 */
export function localModeHook(localUserId: string) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!isLoopbackAddress(req.ip)) {
      await reply.code(403).send({ error: "FORBIDDEN", message: "本地模式仅接受本机（loopback）请求" });
      return;
    }
    // anti-DNS-rebinding（code-review #2）：源 IP 是回环不够——恶意站点可 DNS rebind 到 127.0.0.1
    // 让浏览器同源打本地 daemon。校验 Host 头必须指向本机，挡掉重绑定域名。
    if (!isLocalHost(req.headers.host)) {
      await reply.code(403).send({ error: "FORBIDDEN", message: "本地模式 Host 头非本机（防 DNS 重绑定）" });
      return;
    }
    setUser(req, { userId: localUserId });
  };
}
