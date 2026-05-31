/**
 * U1 API Key 认证 + active-context（真 PG + 真 Redis，app.inject）。
 * 覆盖：bk_ key 认证、read scope 拒写、project 范围拒绝、撤销、active-context 双源 + 跨 user 越权。
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { makeApp, registerUser, auth, seedProject, db, securityRedis } from "../routes/_helpers.ts";
import {
  createApiKey,
  verifyApiKey,
  revokeApiKey,
  hashApiKey,
  generateApiKey,
} from "../../src/services/api-keys.ts";
import { writeActiveContext, readActiveContext } from "../../src/mcp/active-context.ts";
import { sql } from "drizzle-orm";

const createdUsers: string[] = [];
const createdProjects: string[] = [];

after(async () => {
  for (const pid of createdProjects) await db.execute(sql`DELETE FROM projects WHERE id = ${pid}`);
  for (const uid of createdUsers) await db.execute(sql`DELETE FROM users WHERE id = ${uid}`);
  await securityRedis.quit();
});

test("generateApiKey: bk_ 前缀 + hash 确定性", () => {
  const k = generateApiKey();
  assert.match(k.plaintext, /^bk_[0-9a-f]{32}$/);
  assert.equal(k.prefix, k.plaintext.slice(0, 12));
  assert.equal(k.keyHash, hashApiKey(k.plaintext));
});

test("create → verify → revoke 生命周期", async () => {
  const app = makeApp();
  const u = await registerUser(app);
  createdUsers.push(u.userId);
  const created = await createApiKey(db, { userId: u.userId, name: "t", scope: "write", projectIds: null });
  const v = await verifyApiKey(db, created.plaintext);
  assert.equal(v?.userId, u.userId);
  assert.equal(v?.scope, "write");
  assert.equal(v?.projectIds, null);
  assert.equal(await revokeApiKey(db, u.userId, created.id), true);
  assert.equal(await verifyApiKey(db, created.plaintext), null, "撤销后不可用");
  await app.close();
});

test("authenticate 接受 bk_ key：GET /api/projects 与 JWT 等价", async () => {
  const app = makeApp();
  const u = await registerUser(app);
  createdUsers.push(u.userId);
  const pid = await seedProject(u.userId);
  createdProjects.push(pid);
  const key = await createApiKey(db, { userId: u.userId, name: "t", scope: "write", projectIds: null });

  const viaKey = await app.inject({ method: "GET", url: "/api/projects", headers: auth(key.plaintext) });
  assert.equal(viaKey.statusCode, 200);
  const list = viaKey.json() as { projects: { id: string }[] };
  assert.ok(list.projects.some((p) => p.id === pid), "key 能列出自己的项目");
  await app.close();
});

test("read scope key 拒非只读方法（POST → 403）", async () => {
  const app = makeApp();
  const u = await registerUser(app);
  createdUsers.push(u.userId);
  const key = await createApiKey(db, { userId: u.userId, name: "ro", scope: "read", projectIds: null });
  const res = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: auth(key.plaintext),
    payload: { name: "x" },
  });
  assert.equal(res.statusCode, 403);
  assert.equal((res.json() as { message: string }).message, "只读 API key 不可写");
  await app.close();
});

test("project-scoped key 命中范围外项目 → 403", async () => {
  const app = makeApp();
  const u = await registerUser(app);
  createdUsers.push(u.userId);
  const pidIn = await seedProject(u.userId);
  const pidOut = await seedProject(u.userId);
  createdProjects.push(pidIn, pidOut);
  // key 仅授权 pidIn
  const key = await createApiKey(db, { userId: u.userId, name: "scoped", scope: "write", projectIds: [pidIn] });
  // 经 requireProjectRole 的路由：建 workflow 需 owner，且过 project 范围。范围外应 403。
  const res = await app.inject({
    method: "POST",
    url: "/api/workflows",
    headers: auth(key.plaintext),
    payload: { projectId: pidOut },
  });
  assert.equal(res.statusCode, 403, "范围外项目被拒");
  await app.close();
});

test("active-context：心跳写 + 读 + 跨 user 隔离（Redis）", async () => {
  const app = makeApp();
  const u1 = await registerUser(app);
  const u2 = await registerUser(app);
  createdUsers.push(u1.userId, u2.userId);

  await writeActiveContext(securityRedis, u1.userId, { workflowId: "wf-1", phase: "phase2" });
  const ctx1 = await readActiveContext(securityRedis, u1.userId);
  assert.equal(ctx1?.workflowId, "wf-1");
  assert.equal(ctx1?.phase, "phase2");
  // u2 读不到 u1 的（键按 userId 命名空间）
  assert.equal(await readActiveContext(securityRedis, u2.userId), null);
  await app.close();
});

test("active-context 路由：POST 心跳 → GET 命中（自己的）", async () => {
  const app = makeApp();
  const u = await registerUser(app);
  createdUsers.push(u.userId);
  const post = await app.inject({
    method: "POST",
    url: "/api/active-context",
    headers: auth(u.token),
    payload: { workflowId: "wf-x", phase: "phase3" },
  });
  assert.equal(post.statusCode, 204);
  const get = await app.inject({ method: "GET", url: "/api/active-context", headers: auth(u.token) });
  assert.equal(get.statusCode, 200);
  assert.equal((get.json() as { activeContext: { workflowId: string } }).activeContext.workflowId, "wf-x");
  await app.close();
});
