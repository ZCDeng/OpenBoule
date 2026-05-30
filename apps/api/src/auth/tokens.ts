/**
 * Token 签发助手（U6）。access + refresh，access 同时落 HttpOnly cookie（SSE 鉴权走 cookie，KTD-14）。
 */

import type { FastifyReply } from "fastify";
import "@fastify/cookie"; // 引入 setCookie/cookies 的类型增强
import { signJwt } from "./jwt.ts";
import { config } from "../config.ts";
import { ACCESS_COOKIE } from "../middleware/auth.ts";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export function issueTokens(userId: string, nowMs: number): TokenPair {
  const nowSec = Math.floor(nowMs / 1000);
  return {
    accessToken: signJwt({ sub: userId, type: "access" }, config.jwt.secret, {
      nowSec,
      ttlSec: config.jwt.accessTtlSec,
    }),
    refreshToken: signJwt({ sub: userId, type: "refresh" }, config.jwt.secret, {
      nowSec,
      ttlSec: config.jwt.refreshTtlSec,
    }),
  };
}

/** 把 access token 写进 HttpOnly cookie。 */
export function setAccessCookie(reply: FastifyReply, accessToken: string): void {
  reply.setCookie(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: config.nodeEnv === "production",
    maxAge: config.jwt.accessTtlSec,
  });
}
