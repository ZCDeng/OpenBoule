/**
 * U9 路由测试（真 PG + 真 Redis）。文档锁占用/释放；PUT 编辑传播 stale 到下游。
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { makeApp, registerUser, auth, seedProject, seedWorkflow, addMember, db, securityRedis, cleanupAll } from "./_helpers.ts";

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

async function seedArtifact(wf: string, phase: string, body = "x".repeat(200)): Promise<string> {
  const r = await db.execute(sql`
    INSERT INTO artifacts (workflow_id, phase, type, version, body) VALUES (${wf}, ${phase}, 'report', 1, ${body}) RETURNING id`);
  return (r as unknown as { rows: { id: string }[] }).rows[0]!.id;
}

test("文档锁：editor 占用，第二人 409 + 持有者；释放后可再占；心跳非 owner 409", async () => {
  const a = await registerUser(app);
  const b = await registerUser(app);
  users.push(a.userId, b.userId);
  const pid = await seedProject(a.userId); projects.push(pid);
  await addMember(pid, b.userId, "editor");
  const wf = await seedWorkflow(pid);
  const art = await seedArtifact(wf, "phase4_review");

  const lock1 = await app.inject({ method: "POST", url: `/api/artifacts/${art}/lock`, headers: auth(a.token) });
  assert.equal(lock1.statusCode, 200);

  const lock2 = await app.inject({ method: "POST", url: `/api/artifacts/${art}/lock`, headers: auth(b.token) });
  assert.equal(lock2.statusCode, 409);
  assert.equal((lock2.json() as { holder: string }).holder, a.userId);

  // 非 owner 心跳 → 409
  const hb = await app.inject({ method: "POST", url: `/api/artifacts/${art}/lock/heartbeat`, headers: auth(b.token) });
  assert.equal(hb.statusCode, 409);

  // owner 释放 → b 可占
  const rel = await app.inject({ method: "DELETE", url: `/api/artifacts/${art}/lock`, headers: auth(a.token) });
  assert.equal(rel.statusCode, 200);
  const lock3 = await app.inject({ method: "POST", url: `/api/artifacts/${art}/lock`, headers: auth(b.token) });
  assert.equal(lock3.statusCode, 200);
  await app.inject({ method: "DELETE", url: `/api/artifacts/${art}/lock`, headers: auth(b.token) });
});

test("PUT 编辑：传播 stale 到下游 phase，GET /stale 反映", async () => {
  const owner = await registerUser(app);
  users.push(owner.userId);
  const pid = await seedProject(owner.userId); projects.push(pid);
  const wf = await seedWorkflow(pid);
  // 上游被编辑的 artifact + 两个下游 artifact
  const upstream = await seedArtifact(wf, "phase1_5_axis");
  await seedArtifact(wf, "phase3_synthesis");
  await seedArtifact(wf, "phase4_review");

  const put = await app.inject({
    method: "PUT", url: `/api/artifacts/${upstream}`, headers: auth(owner.token),
    payload: { body: "更新后的轴分解，体量足够通过护栏。".repeat(20) },
  });
  assert.equal(put.statusCode, 200);
  const affected = (put.json() as { affectedDownstream: string[] }).affectedDownstream;
  assert.deepEqual(affected.sort(), ["phase3_synthesis", "phase4_review"]);

  const stale = await app.inject({ method: "GET", url: `/api/workflows/${wf}/stale`, headers: auth(owner.token) });
  assert.deepEqual((stale.json() as { stalePhases: string[] }).stalePhases.sort(), ["phase3_synthesis", "phase4_review"]);
});
