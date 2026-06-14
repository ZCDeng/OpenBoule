/**
 * U6 路由集成测试（app.inject，真 PG + 真 Redis）。覆盖 plan 多数 Test scenarios：
 * 注册/登录、无效 JWT 401、非成员 403、过期分享 410、护栏拒发/warn、surface 写授权、SSE 鉴权。
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  makeApp, registerUser, auth, seedProject, seedWorkflow, addMember, db, securityRedis, cleanupAll,
} from "./_helpers.ts";

let app: FastifyInstance;
const users: string[] = [];
const projects: string[] = [];

before(() => {
  app = makeApp();
});
after(async () => {
  await app.close();
  await cleanupAll(users, projects);
  await securityRedis.quit();
  await db.$client.end();
});

async function newUser() {
  const u = await registerUser(app);
  users.push(u.userId);
  return u;
}

test("注册 → 登录 happy", async () => {
  const u = await newUser();
  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: u.email, password: "pw-123456" } });
  assert.equal(login.statusCode, 200);
  assert.ok((login.json() as { accessToken: string }).accessToken);
});

test("无效 JWT → 401", async () => {
  const owner = await newUser();
  const pid = await seedProject(owner.userId); projects.push(pid);
  const wf = await seedWorkflow(pid);
  const res = await app.inject({ method: "GET", url: `/api/workflows/${wf}`, headers: { authorization: "Bearer not.a.jwt" } });
  assert.equal(res.statusCode, 401);
});

test("配置页运行时总览：Web 会话可读，暴露模型和 Aditly 状态但不暴露密钥", async () => {
  const owner = await newUser();
  const res = await app.inject({ method: "GET", url: "/api/settings/runtime", headers: auth(owner.token) });
  assert.equal(res.statusCode, 200);
  const body = res.json() as {
    agent: { model: string; runtime: string; cliOrApiSelectableByUser: boolean };
    search: { provider: string; enabled: boolean; tools: string[] };
  };
  assert.ok(body.agent.model);
  assert.equal(body.agent.runtime, "claude-agent-sdk");
  assert.equal(body.agent.cliOrApiSelectableByUser, false);
  assert.equal(body.search.provider, "Aditly MCP");
  assert.ok(!JSON.stringify(body).includes("API_KEY"));
});

test("项目详情状态监控：列出项目 workflows，非成员拒绝", async () => {
  const owner = await newUser();
  const outsider = await newUser();
  const pid = await seedProject(owner.userId); projects.push(pid);
  const wf1 = await seedWorkflow(pid);
  const wf2 = await seedWorkflow(pid);

  await db.execute(sql`UPDATE workflows SET mode = '调研', current_phase = 'phase2_research', status = 'running' WHERE id = ${wf1}`);
  await db.execute(sql`UPDATE workflows SET mode = '决策', current_phase = 'phase4_review', status = 'paused_for_approval' WHERE id = ${wf2}`);

  const denied = await app.inject({ method: "GET", url: `/api/projects/${pid}/workflows`, headers: auth(outsider.token) });
  assert.equal(denied.statusCode, 403);

  const ok = await app.inject({ method: "GET", url: `/api/projects/${pid}/workflows`, headers: auth(owner.token) });
  assert.equal(ok.statusCode, 200);
  const body = ok.json() as { workflows: { id: string; currentPhase: string; status: string; mode: string | null }[] };
  assert.equal(body.workflows.length, 2);
  assert.ok(body.workflows.some((w) => w.id === wf1 && w.currentPhase === "phase2_research" && w.mode === "调研"));
  assert.ok(body.workflows.some((w) => w.id === wf2 && w.status === "paused_for_approval" && w.mode === "决策"));
});

test("非项目成员访问 workflow → 403；加为 viewer 后 → 200", async () => {
  const owner = await newUser();
  const outsider = await newUser();
  const pid = await seedProject(owner.userId); projects.push(pid);
  const wf = await seedWorkflow(pid);

  const denied = await app.inject({ method: "GET", url: `/api/workflows/${wf}`, headers: auth(outsider.token) });
  assert.equal(denied.statusCode, 403);

  await addMember(pid, outsider.userId, "viewer");
  const ok = await app.inject({ method: "GET", url: `/api/workflows/${wf}`, headers: auth(outsider.token) });
  assert.equal(ok.statusCode, 200);
});

test("PUT artifact：残留占位符 publication-guard 拒发 422；体量骤降 stub reject 422；正常 200", async () => {
  const owner = await newUser();
  const pid = await seedProject(owner.userId); projects.push(pid);
  const wf = await seedWorkflow(pid);
  const a = await db.execute(sql`
    INSERT INTO artifacts (workflow_id, phase, type, version, body, status)
    VALUES (${wf}, 'phase4_review', 'report', 1, ${"x".repeat(1000)}, 'draft') RETURNING id`);
  const artifactId = (a as unknown as { rows: { id: string }[] }).rows[0]!.id;

  const blocked = await app.inject({
    method: "PUT", url: `/api/artifacts/${artifactId}`, headers: auth(owner.token),
    payload: { body: "最终报告：预计营收 $X.XM，详见待确认。" },
  });
  assert.equal(blocked.statusCode, 422);
  assert.equal((blocked.json() as { error: string }).error, "ARTIFACT_PUBLICATION_BLOCKED");

  const stub = await app.inject({
    method: "PUT", url: `/api/artifacts/${artifactId}`, headers: auth(owner.token),
    payload: { body: "太短了", stubMode: "reject" }, // < 旧版本 20%
  });
  assert.equal(stub.statusCode, 422);
  assert.equal((stub.json() as { error: string }).error, "ARTIFACT_STUB_REJECTED");

  const okBody = "正式报告正文。".repeat(60); // 体量足够
  const good = await app.inject({
    method: "PUT", url: `/api/artifacts/${artifactId}`, headers: auth(owner.token), payload: { body: okBody },
  });
  assert.equal(good.statusCode, 200);
  assert.equal((good.json() as { version: number }).version, 2);
});

test("签名分享：签发 + 公开访问；过期 → 410", async () => {
  const owner = await newUser();
  const pid = await seedProject(owner.userId); projects.push(pid);
  const wf = await seedWorkflow(pid);

  const created = await app.inject({
    method: "POST", url: "/api/shares", headers: auth(owner.token),
    payload: { workflowId: wf, scope: "report", ttlSec: 3600 },
  });
  assert.equal(created.statusCode, 201);
  const token = (created.json() as { token: string }).token;

  const access = await app.inject({ method: "GET", url: `/s/${token}` });
  assert.equal(access.statusCode, 200);
  assert.equal((access.json() as { workflowId: string }).workflowId, wf);

  // 过期链接：用注入的 now 让校验时刻晚于 expiry
  const expiredApp = makeApp({ now: () => Date.now() + 10 * 3600 * 1000 });
  const expired = await expiredApp.inject({ method: "GET", url: `/s/${token}` });
  await expiredApp.close();
  assert.equal(expired.statusCode, 410);
});

test("surface 写授权：external/viewer 回填被拒，editor 通过；responded_by 留痕", async () => {
  const owner = await newUser();
  const viewer = await newUser();
  const editor = await newUser();
  const pid = await seedProject(owner.userId); projects.push(pid);
  const wf = await seedWorkflow(pid);
  await addMember(pid, viewer.userId, "viewer");
  await addMember(pid, editor.userId, "editor");

  const s = await db.execute(sql`
    INSERT INTO checkpoint_surfaces (workflow_id, phase, schema_digest, status)
    VALUES (${wf}, 'phase1_intake', 'digest-abc', 'pending') RETURNING id`);
  const surfaceId = (s as unknown as { rows: { id: string }[] }).rows[0]!.id;

  // viewer 看得到 pending
  const list = await app.inject({ method: "GET", url: `/api/workflows/${wf}/surfaces`, headers: auth(viewer.token) });
  assert.equal(list.statusCode, 200);
  assert.equal((list.json() as { pending: unknown[] }).pending.length, 1);

  // viewer 回填被拒 403
  const vResp = await app.inject({ method: "POST", url: `/api/surfaces/${surfaceId}/respond`, headers: auth(viewer.token) });
  assert.equal(vResp.statusCode, 403);

  // editor 回填成功
  const eResp = await app.inject({ method: "POST", url: `/api/surfaces/${surfaceId}/respond`, headers: auth(editor.token) });
  assert.equal(eResp.statusCode, 200);

  // responded_by 留痕
  const trail = await db.execute(sql`SELECT responded_by AS "rb", status FROM checkpoint_surfaces WHERE id = ${surfaceId}`);
  const row = (trail as unknown as { rows: { rb: { user_id: string; role: string }; status: string }[] }).rows[0]!;
  assert.equal(row.status, "resolved");
  assert.equal(row.rb.user_id, editor.userId);
  assert.equal(row.rb.role, "editor");

  // 二次回填 → 409（已 resolved）
  const dup = await app.inject({ method: "POST", url: `/api/surfaces/${surfaceId}/respond`, headers: auth(editor.token) });
  assert.equal(dup.statusCode, 409);
});

test("SSE 鉴权：无凭证 401；ticket 签发；非成员带 ticket → 403", async () => {
  const owner = await newUser();
  const outsider = await newUser();
  const pid = await seedProject(owner.userId); projects.push(pid);
  const wf = await seedWorkflow(pid);

  // 无凭证连接 → 401
  const noauth = await app.inject({ method: "GET", url: `/api/sse/workflows/${wf}` });
  assert.equal(noauth.statusCode, 401);

  // 签 ticket（需登录）
  const ticketRes = await app.inject({ method: "POST", url: "/api/sse/ticket", headers: auth(outsider.token) });
  assert.equal(ticketRes.statusCode, 200);
  const ticket = (ticketRes.json() as { ticket: string }).ticket;

  // 非成员带 ticket → 403（重连重新鉴权，先于 hijack）
  const denied = await app.inject({ method: "GET", url: `/api/sse/workflows/${wf}?ticket=${ticket}` });
  assert.equal(denied.statusCode, 403);
});

test("第 5 交互轨 opt-in：viewer 拒、editor 设/清、非法 400", async () => {
  const owner = await newUser();
  const pid = await seedProject(owner.userId); projects.push(pid);
  const wf = await seedWorkflow(pid);
  const viewer = await newUser();
  await addMember(pid, viewer.userId, "viewer");

  // viewer（只读）→ 403
  const denied = await app.inject({
    method: "POST", url: `/api/workflows/${wf}/interactive-track`,
    headers: auth(viewer.token), payload: { track: "html-diagram" },
  });
  assert.equal(denied.statusCode, 403);

  // owner（editor+）设 html-diagram → 200 + 落库
  const set = await app.inject({
    method: "POST", url: `/api/workflows/${wf}/interactive-track`,
    headers: auth(owner.token), payload: { track: "html-diagram" },
  });
  assert.equal(set.statusCode, 200);
  const after1 = await db.execute(sql`SELECT checkpoint_data->>'interactiveTrack' AS "t" FROM workflows WHERE id = ${wf}`);
  assert.equal((after1 as unknown as { rows: { t: string | null }[] }).rows[0]!.t, "html-diagram");

  // 非法 track → 400
  const bad = await app.inject({
    method: "POST", url: `/api/workflows/${wf}/interactive-track`,
    headers: auth(owner.token), payload: { track: "pdf" },
  });
  assert.equal(bad.statusCode, 400);

  // 清除（none）→ 200 + 键移除
  const clear = await app.inject({
    method: "POST", url: `/api/workflows/${wf}/interactive-track`,
    headers: auth(owner.token), payload: { track: "none" },
  });
  assert.equal(clear.statusCode, 200);
  const after2 = await db.execute(sql`SELECT checkpoint_data->>'interactiveTrack' AS "t" FROM workflows WHERE id = ${wf}`);
  assert.equal((after2 as unknown as { rows: { t: string | null }[] }).rows[0]!.t, null);
});
