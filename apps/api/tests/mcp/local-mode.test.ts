/**
 * U2 本地免登录模式（docker PG 退路）。覆盖：loopback 判定纯函数、local 模式免登录放行、
 * 非回环来源 403、authenticate 尊重预置 user。
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { buildApp } from "../../src/app.ts";
import { db } from "../routes/_helpers.ts";
import { createSecurityRedis } from "../../src/services/redis.ts";
import { isLoopbackAddress, isLocalHost } from "../../src/middleware/auth.ts";
import { ensureLocalUser, LOCAL_USER_ID } from "../../src/services/local-user.ts";

const redis = createSecurityRedis();
const projects: string[] = [];

after(async () => {
  for (const pid of projects) await db.execute(sql`DELETE FROM projects WHERE id = ${pid}`);
  await redis.quit();
});

test("isLoopbackAddress：回环放行、外部拒绝", () => {
  for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost", "127.0.0.5"]) {
    assert.equal(isLoopbackAddress(ip), true, `${ip} 应是回环`);
  }
  for (const ip of ["192.168.1.10", "10.0.0.1", "8.8.8.8", "", undefined]) {
    assert.equal(isLoopbackAddress(ip), false, `${ip} 不应是回环`);
  }
});

test("local 模式：免登录创建项目（app.inject 默认回环）", async () => {
  await ensureLocalUser(db);
  const app = buildApp({ db, securityRedis: redis, localMode: { userId: LOCAL_USER_ID } });
  // 无任何 token，直接建项目应成功（本地用户即 owner）。
  const res = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "本地项目" } });
  assert.equal(res.statusCode, 201);
  const pid = (res.json() as { projectId: string }).projectId;
  projects.push(pid);
  // 列表能看到（同一本地用户）
  const list = await app.inject({ method: "GET", url: "/api/projects" });
  assert.ok((list.json() as { projects: { id: string }[] }).projects.some((p) => p.id === pid));
  await app.close();
});

test("local 模式：非回环来源 → 403", async () => {
  const app = buildApp({ db, securityRedis: redis, localMode: { userId: LOCAL_USER_ID } });
  const res = await app.inject({
    method: "GET",
    url: "/api/projects",
    remoteAddress: "192.168.1.50",
  });
  assert.equal(res.statusCode, 403);
  assert.match((res.json() as { message: string }).message, /仅接受本机/);
  await app.close();
});

test("local 模式：不注册 auth 路由（register → 404）", async () => {
  const app = buildApp({ db, securityRedis: redis, localMode: { userId: LOCAL_USER_ID } });
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "x@y.z", password: "pw-123456", name: "T" },
  });
  assert.equal(res.statusCode, 404, "本地模式无登录路由");
  await app.close();
});

test("team 模式（无 localMode）：未认证仍 401", async () => {
  const app = buildApp({ db, securityRedis: redis });
  const res = await app.inject({ method: "GET", url: "/api/projects" });
  assert.equal(res.statusCode, 401, "团队模式不受本地模式影响");
  await app.close();
});

// ── code-review #2：anti-DNS-rebinding ──

test("isLocalHost：本机 Host 放行、重绑定域名拒", () => {
  for (const h of ["127.0.0.1", "127.0.0.1:3100", "localhost", "localhost:5173", "[::1]", "::1"]) {
    assert.equal(isLocalHost(h), true, `${h} 应是本机`);
  }
  for (const h of ["evil.com", "attacker.example:3100", "boule.io", "", undefined]) {
    assert.equal(isLocalHost(h), false, `${h} 不应是本机`);
  }
});

test("local 模式：回环 IP 但 Host 头是攻击者域名 → 403（防 DNS 重绑定）", async () => {
  const app = buildApp({ db, securityRedis: redis, localMode: { userId: LOCAL_USER_ID } });
  const res = await app.inject({
    method: "GET",
    url: "/api/projects",
    headers: { host: "evil.attacker.com" },
  });
  assert.equal(res.statusCode, 403);
  assert.match((res.json() as { message: string }).message, /DNS 重绑定/);
  await app.close();
});
