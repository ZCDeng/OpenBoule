/**
 * 自建 JWT（U6 / KTD-10）——HS256，stdlib crypto，零依赖。
 *
 * 用户量小（me + team），不引 Clerk/Auth0/jsonwebtoken。手写 HS256 sign/verify：
 * base64url(header).base64url(payload).base64url(HMAC-SHA256)。
 * secret 缺失即抛——绝不用空/默认 secret 签发可伪造 token（fail loud）。
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface JwtPayload {
  sub: string; // userId
  type: "access" | "refresh";
  iat: number;
  exp: number;
  [k: string]: unknown;
}

export class JwtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JwtError";
  }
}

function b64urlEncode(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function requireSecret(secret: string): string {
  if (!secret || secret.trim() === "") {
    throw new JwtError("JWT secret 未配置（设 JWT_SECRET）——拒绝用空 secret 签发/校验");
  }
  return secret;
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/** 签发 token。expSec = 绝对过期秒（调用方用 nowSec + ttl 算）。 */
export function signJwt(
  payload: { sub: string; type: "access" | "refresh"; [k: string]: unknown },
  secret: string,
  opts: { nowSec: number; ttlSec: number },
): string {
  requireSecret(secret);
  const full: JwtPayload = {
    ...payload,
    iat: opts.nowSec,
    exp: opts.nowSec + opts.ttlSec,
  };
  const header = b64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64urlEncode(JSON.stringify(full));
  const signingInput = `${header}.${body}`;
  return `${signingInput}.${sign(signingInput, secret)}`;
}

/**
 * 校验 token：结构 → 签名（timing-safe）→ 过期。任一失败抛 JwtError。
 * @param nowSec 当前秒（注入便于测试 + 避免对 Date 隐式依赖）
 */
export function verifyJwt(token: string, secret: string, nowSec: number): JwtPayload {
  requireSecret(secret);
  const parts = token.split(".");
  if (parts.length !== 3) throw new JwtError("token 结构非法");
  const [header, body, providedSig] = parts as [string, string, string];
  const expectedSig = sign(`${header}.${body}`, secret);
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new JwtError("签名不匹配");
  }
  let payload: JwtPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new JwtError("payload 解析失败");
  }
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) {
    throw new JwtError("token 已过期");
  }
  return payload;
}
