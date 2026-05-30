/**
 * 签名分享全生命周期（U10，真 PG + 真 Redis）。
 * 创建 → 免登录访问渲染 + CSP 头 → 撤销 → 再访问 410；scope 不匹配 → 403。
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { makeApp, registerUser, auth, seedProject, seedWorkflow, db, securityRedis, cleanupAll } from "../routes/_helpers.ts";

let app: FastifyInstance;
const users: string[] = [];
const projects: string[] = [];

before(() => { app = makeApp(); });
after(async () => {
  await app.close();
  await cleanupAll(users, projects);
  await securityRedis.quit();
  await db.$client.end();
});

async function setup() {
  const owner = await registerUser(app);
  users.push(owner.userId);
  const pid = await seedProject(owner.userId); projects.push(pid);
  const wf = await seedWorkflow(pid);
  await db.execute(sql`
    INSERT INTO artifacts (workflow_id, phase, type, version, body)
    VALUES (${wf}, 'phase4_review', 'final-report', 1, ${"<h1>客户报告</h1><p>结论。</p>"})`);
  return { owner, wf };
}

test("创建 → 免登录访问渲染 HTML + CSP 头 → 撤销 → 再访问 410", async () => {
  const { owner, wf } = await setup();

  const created = await app.inject({
    method: "POST", url: "/api/shares", headers: auth(owner.token),
    payload: { workflowId: wf, scope: "report", ttlSec: 3600 },
  });
  const token = (created.json() as { token: string }).token;

  // 免登录访问
  const view = await app.inject({ method: "GET", url: `/s/${token}/report` });
  assert.equal(view.statusCode, 200);
  assert.match(view.headers["content-type"] as string, /text\/html/);
  assert.equal(view.headers["content-security-policy"], "sandbox allow-scripts");
  assert.match(view.body, /客户报告/);

  // 撤销
  const rev = await app.inject({ method: "POST", url: `/api/shares/${token}/revoke`, headers: auth(owner.token) });
  assert.equal(rev.statusCode, 200);

  // 再访问 → 410 Gone
  const after2 = await app.inject({ method: "GET", url: `/s/${token}/report` });
  assert.equal(after2.statusCode, 410);
});

test("scope 不匹配：methodology token 访问 /report → 403", async () => {
  const { owner, wf } = await setup();
  const created = await app.inject({
    method: "POST", url: "/api/shares", headers: auth(owner.token),
    payload: { workflowId: wf, scope: "methodology", ttlSec: 3600 },
  });
  const token = (created.json() as { token: string }).token;
  const view = await app.inject({ method: "GET", url: `/s/${token}/report` });
  assert.equal(view.statusCode, 403);
});

test("过期链接访问 /report → 410", async () => {
  const { owner, wf } = await setup();
  const created = await app.inject({
    method: "POST", url: "/api/shares", headers: auth(owner.token),
    payload: { workflowId: wf, scope: "report", ttlSec: 3600 },
  });
  const token = (created.json() as { token: string }).token;
  // 用注入 now 让校验时刻晚于过期
  const expiredApp = makeApp({ now: () => Date.now() + 10 * 3600 * 1000 });
  const view = await expiredApp.inject({ method: "GET", url: `/s/${token}/report` });
  await expiredApp.close();
  assert.equal(view.statusCode, 410);
});
