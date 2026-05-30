/**
 * U6 端到端（真 Fastify inject + 真 BullMQ 引擎 + 真 PG，mock agent）。
 * plan Verification：注册 → 创建项目 → 启动 workflow → 等 checkpoint → 审批 → 完成。
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { WorkflowEngine } from "../../src/workflow/engine.ts";
import type { AgentRunner } from "../../src/workflow/phases/index.ts";
import { PHASE_IDS } from "../../src/workflow/state.ts";
import { makeApp, registerUser, auth, db, securityRedis, cleanupAll } from "./_helpers.ts";

const runner: AgentRunner = async (spec) => {
  if (spec.role.startsWith("editor-")) {
    return { ok: true, text: `e-${spec.role}`, score: { composite: 0.9, mustFix: 0, languageGateFailed: false } };
  }
  return { ok: true, text: `${spec.role}-out` };
};

let app: FastifyInstance;
let engine: WorkflowEngine;
const users: string[] = [];
const projects: string[] = [];

before(() => {
  engine = new WorkflowEngine(db, {
    agentRunner: runner,
    workerId: "w-e2e",
    queueName: `boule-phase-e2e-${randomUUID()}`, // 唯一队列名，隔离并行测试文件
    leaseSeconds: 30,
    heartbeatSeconds: 5,
  });
  engine.start();
  app = makeApp({ engine, snapshotProvider: async () => ({ commit_sha: "e2e", manifest: [], contents: {} }) });
});

after(async () => {
  await engine.close();
  await app.close();
  await cleanupAll(users, projects);
  await securityRedis.quit();
  await db.$client.end();
});

async function status(wf: string): Promise<{ s: string; p: string }> {
  const r = await db.execute(sql`SELECT status AS "s", current_phase AS "p" FROM workflows WHERE id = ${wf}`);
  return (r as unknown as { rows: { s: string; p: string }[] }).rows[0]!;
}
async function waitPaused(wf: string, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if ((await status(wf)).s === "paused_for_approval") return;
    if (Date.now() - start > timeoutMs) throw new Error(`等 paused 超时 @ ${JSON.stringify(await status(wf))}`);
    await new Promise((r) => setTimeout(r, 80));
  }
}

test("完整流：注册 → 项目 → workflow → 逐 checkpoint 审批 → 完成", { timeout: 40000 }, async () => {
  const owner = await registerUser(app);
  users.push(owner.userId);

  const projRes = await app.inject({ method: "POST", url: "/api/projects", headers: auth(owner.token), payload: { name: "宇润" } });
  assert.equal(projRes.statusCode, 201);
  const projectId = (projRes.json() as { projectId: string }).projectId;
  projects.push(projectId);

  const wfRes = await app.inject({
    method: "POST", url: "/api/workflows", headers: auth(owner.token),
    payload: { projectId, mode: "调研" },
  });
  assert.equal(wfRes.statusCode, 201);
  const wf = (wfRes.json() as { workflowId: string; started: boolean }).workflowId;
  assert.equal((wfRes.json() as { started: boolean }).started, true);

  const visited: string[] = [];
  let done = false;
  for (let i = 0; i < PHASE_IDS.length + 2 && !done; i++) {
    await waitPaused(wf);
    visited.push((await status(wf)).p);
    const ap = await app.inject({ method: "POST", url: `/api/workflows/${wf}/approve`, headers: auth(owner.token) });
    assert.equal(ap.statusCode, 200);
    done = (ap.json() as { done: boolean }).done;
  }

  assert.equal(done, true);
  assert.deepEqual(visited, [...PHASE_IDS]); // 9 phase 全部经 HTTP 审批走完
});

test("非 editor 审批被拒：viewer approve → 403", async () => {
  const owner = await registerUser(app);
  const viewer = await registerUser(app);
  users.push(owner.userId, viewer.userId);

  const projRes = await app.inject({ method: "POST", url: "/api/projects", headers: auth(owner.token), payload: { name: "P" } });
  const projectId = (projRes.json() as { projectId: string }).projectId;
  projects.push(projectId);
  await db.execute(sql`INSERT INTO project_members (project_id, user_id, role) VALUES (${projectId}, ${viewer.userId}, 'viewer')`);

  const wfRes = await app.inject({ method: "POST", url: "/api/workflows", headers: auth(owner.token), payload: { projectId } });
  const wf = (wfRes.json() as { workflowId: string }).workflowId;
  await waitPaused(wf);

  const denied = await app.inject({ method: "POST", url: `/api/workflows/${wf}/approve`, headers: auth(viewer.token) });
  assert.equal(denied.statusCode, 403); // viewer 不能审批 checkpoint
});
