/**
 * 认证路由（U6）。注册 / 登录 / 登出 / 刷新。
 */

import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { AppDeps } from "../app.ts";
import { hashPassword, verifyPassword } from "../auth/password.ts";
import { issueTokens, setAccessCookie } from "../auth/tokens.ts";
import { verifyJwt, JwtError } from "../auth/jwt.ts";
import { config } from "../config.ts";
import { ACCESS_COOKIE } from "../middleware/auth.ts";

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  const now = deps.now ?? Date.now;

  app.post("/api/auth/register", async (req, reply) => {
    const { email, password, name } = (req.body ?? {}) as { email?: string; password?: string; name?: string };
    if (!email || !password || !name) {
      return reply.code(400).send({ error: "BAD_REQUEST", message: "email/password/name 必填" });
    }
    const passwordHash = await hashPassword(password);
    let userId: string;
    try {
      const res = await deps.db.execute(sql`
        INSERT INTO users (email, password_hash, name) VALUES (${email}, ${passwordHash}, ${name})
        RETURNING id`);
      userId = (res as unknown as { rows: { id: string }[] }).rows[0]!.id;
    } catch {
      return reply.code(409).send({ error: "EMAIL_TAKEN", message: "邮箱已注册" });
    }
    const tokens = issueTokens(userId, now());
    setAccessCookie(reply, tokens.accessToken);
    return reply.code(201).send({ userId, ...tokens });
  });

  app.post("/api/auth/login", async (req, reply) => {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    if (!email || !password) return reply.code(400).send({ error: "BAD_REQUEST" });
    const res = await deps.db.execute(sql`
      SELECT id, password_hash AS "passwordHash" FROM users WHERE email = ${email}`);
    const row = (res as unknown as { rows?: { id: string; passwordHash: string }[] }).rows?.[0];
    if (!row || !(await verifyPassword(password, row.passwordHash))) {
      return reply.code(401).send({ error: "INVALID_CREDENTIALS", message: "邮箱或密码错误" });
    }
    const tokens = issueTokens(row.id, now());
    setAccessCookie(reply, tokens.accessToken);
    return reply.send({ userId: row.id, ...tokens });
  });

  app.post("/api/auth/logout", async (_req, reply) => {
    reply.clearCookie(ACCESS_COOKIE, { path: "/" });
    return reply.send({ ok: true });
  });

  app.post("/api/auth/refresh", async (req, reply) => {
    const { refreshToken } = (req.body ?? {}) as { refreshToken?: string };
    if (!refreshToken) return reply.code(400).send({ error: "BAD_REQUEST" });
    try {
      const payload = verifyJwt(refreshToken, config.jwt.secret, Math.floor(now() / 1000));
      if (payload.type !== "refresh") throw new JwtError("非 refresh token");
      const tokens = issueTokens(payload.sub, now());
      setAccessCookie(reply, tokens.accessToken);
      return reply.send({ userId: payload.sub, ...tokens });
    } catch (err) {
      return reply.code(401).send({ error: "INVALID_REFRESH", message: err instanceof JwtError ? err.message : "无效" });
    }
  });
}
