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

// ── code-review #1：scope 提权回归 ──

test("提权防线：write key 不能 mint 新 key（POST /api/api-keys → 403）", async () => {
  const app = makeApp();
  const u = await registerUser(app);
  createdUsers.push(u.userId);
  const key = await createApiKey(db, { userId: u.userId, name: "w", scope: "write", projectIds: null });
  const res = await app.inject({
    method: "POST",
    url: "/api/api-keys",
    headers: auth(key.plaintext),
    payload: { name: "minted", scope: "write" },
  });
  assert.equal(res.statusCode, 403, "API key 不能管理 key");
  // GET / DELETE 同样拒
  assert.equal((await app.inject({ method: "GET", url: "/api/api-keys", headers: auth(key.plaintext) })).statusCode, 403);
  await app.close();
});

test("提权防线：scoped key 不能创建新项目（POST /api/projects → 403）", async () => {
  const app = makeApp();
  const u = await registerUser(app);
  createdUsers.push(u.userId);
  const pid = await seedProject(u.userId);
  createdProjects.push(pid);
  const scoped = await createApiKey(db, { userId: u.userId, name: "s", scope: "write", projectIds: [pid] });
  const res = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: auth(scoped.plaintext),
    payload: { name: "新项目" },
  });
  assert.equal(res.statusCode, 403, "受限 key 不能创建项目");
  // 全账户 key 可以
  const full = await createApiKey(db, { userId: u.userId, name: "f", scope: "write", projectIds: null });
  const ok = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: auth(full.plaintext),
    payload: { name: "全账户建的" },
  });
  assert.equal(ok.statusCode, 201);
  createdProjects.push((ok.json() as { projectId: string }).projectId);
  await app.close();
});

// ── API key CRUD HTTP（route 层，之前只测了 service 层）──

test("CRUD HTTP：POST 回显明文一次 / GET 不漏 hash / DELETE 200+二次 404 / 他人不能删", async () => {
  const app = makeApp();
  const owner = await registerUser(app);
  const other = await registerUser(app);
  createdUsers.push(owner.userId, other.userId);

  const create = await app.inject({
    method: "POST",
    url: "/api/api-keys",
    headers: auth(owner.token),
    payload: { name: "my-laptop", scope: "read" },
  });
  assert.equal(create.statusCode, 201);
  const created = create.json() as { id: string; apiKey: string; prefix: string };
  assert.match(created.apiKey, /^bk_/, "回显明文一次");

  const list = await app.inject({ method: "GET", url: "/api/api-keys", headers: auth(owner.token) });
  const body = list.body;
  assert.doesNotMatch(body, /key_hash|keyHash/, "列表不漏 hash");
  assert.doesNotMatch(body, new RegExp(created.apiKey), "列表不漏明文");

  // 他人不能删我的 key
  const otherDel = await app.inject({ method: "DELETE", url: `/api/api-keys/${created.id}`, headers: auth(other.token) });
  assert.equal(otherDel.statusCode, 404, "他人删不到（按 userId 过滤）");

  const del = await app.inject({ method: "DELETE", url: `/api/api-keys/${created.id}`, headers: auth(owner.token) });
  assert.equal(del.statusCode, 200);
  const del2 = await app.inject({ method: "DELETE", url: `/api/api-keys/${created.id}`, headers: auth(owner.token) });
  assert.equal(del2.statusCode, 404, "二次删幂等 404");
  await app.close();
});

test("撤销后经 HTTP authenticate → 401（不只是 service 层 null）", async () => {
  const app = makeApp();
  const u = await registerUser(app);
  createdUsers.push(u.userId);
  const key = await createApiKey(db, { userId: u.userId, name: "k", scope: "read", projectIds: null });
  await revokeApiKey(db, u.userId, key.id);
  const res = await app.inject({ method: "GET", url: "/api/projects", headers: auth(key.plaintext) });
  assert.equal(res.statusCode, 401, "撤销的 key 被中间件拒");
  await app.close();
});

// ── #5 根因回归：authenticate 用注入的 db，不是进程单例 ──

test("authenticate 走注入 db：注入一个查不到 key 的 db → 真 key 也 401", async () => {
  const u = await registerUser(makeApp());
  createdUsers.push(u.userId);
  // key 建在真实单例 db 里——若 authenticate 仍 import 单例，会在单例里查到它而放行。
  const key = await createApiKey(db, { userId: u.userId, name: "probe", scope: "write", projectIds: null });

  // 注入一个 execute 永远返回空 rows 的 db：authenticate 若用注入 db，查不到 key → 401。
  const emptyDb = { execute: async () => ({ rows: [] }) } as unknown as typeof db;
  const app = makeApp({ db: emptyDb });
  const res = await app.inject({ method: "GET", url: "/api/projects", headers: auth(key.plaintext) });
  assert.equal(res.statusCode, 401, "注入 db 查不到 → 拒；证明没旁路打单例");
  await app.close();

  // 对照：注入真实 db，同一 key → 200（auth 命中注入的真实库）
  const ok = makeApp();
  const res2 = await ok.inject({ method: "GET", url: "/api/projects", headers: auth(key.plaintext) });
  assert.equal(res2.statusCode, 200, "注入真实 db → 命中");
  await ok.close();
});

// ── code-review #4：Redis 失败降级（注入抛错的 redis stub）──

test("active-context：Redis 抛错时 read 返回 null、write 不抛（降级）", async () => {
  const throwing = {
    get: async () => {
      throw new Error("redis down");
    },
    set: async () => {
      throw new Error("redis down");
    },
  } as unknown as typeof securityRedis;
  // write 不抛
  await writeActiveContext(throwing, "u-x", { workflowId: "wf" });
  // read 返回 null 而非抛
  assert.equal(await readActiveContext(throwing, "u-x"), null);
});
