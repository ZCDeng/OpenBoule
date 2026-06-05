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
import {
  MAX_PROJECT_REFERENCE_BYTES,
  computeReferenceContentHash,
  createProjectReference,
  loadProjectReferencesPartitioned,
} from "../../src/services/references.ts";
import { makeApp, registerUser, auth, db, securityRedis, cleanupAll } from "./_helpers.ts";

const intakeTasks = new Map<string, string>();

const runner: AgentRunner = async (spec) => {
  if (spec.phase === "phase1_intake") intakeTasks.set(spec.workflowId, spec.task);
  if (spec.role.startsWith("editor-")) {
    const editorNo = Number(spec.role.replace("editor-", ""));
    return {
      ok: true,
      text: `<h1>交付报告</h1><p>${spec.role} 完成客户版终稿。</p>`,
      score: { composite: 0.9 + editorNo / 100, mustFix: 0, languageGateFailed: false },
    };
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

test("完整流：注册 → 项目 → workflow → 逐 checkpoint 审批 → 文档入库 → 分享交付", { timeout: 40000 }, async () => {
  const owner = await registerUser(app);
  users.push(owner.userId);

  const loginRes = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: owner.email, password: "pw-123456" },
  });
  assert.equal(loginRes.statusCode, 200);
  const loginToken = (loginRes.json() as { accessToken: string }).accessToken;
  assert.ok(loginToken);

  const projRes = await app.inject({ method: "POST", url: "/api/projects", headers: auth(owner.token), payload: { name: "宇润" } });
  assert.equal(projRes.statusCode, 201);
  const projectId = (projRes.json() as { projectId: string }).projectId;
  projects.push(projectId);

  const projectList = await app.inject({ method: "GET", url: "/api/projects", headers: auth(loginToken) });
  assert.equal(projectList.statusCode, 200);
  assert.ok((projectList.json() as { projects: { id: string }[] }).projects.some((p) => p.id === projectId));

  const refRes = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/references`,
    headers: auth(owner.token),
    payload: { filename: "client-brief.md", mimeType: "text/markdown", body: "客户 brief：关注现金流和组织落地。" },
  });
  assert.equal(refRes.statusCode, 201);
  const referenceId = (refRes.json() as { reference: { id: string } }).reference.id;

  const wfRes = await app.inject({
    method: "POST", url: "/api/workflows", headers: auth(owner.token),
    payload: { projectId, mode: "调研", referenceIds: [referenceId] },
  });
  assert.equal(wfRes.statusCode, 201);
  const wf = (wfRes.json() as { workflowId: string; started: boolean; referenceCount: number }).workflowId;
  assert.equal((wfRes.json() as { started: boolean }).started, true);
  assert.equal((wfRes.json() as { referenceCount: number }).referenceCount, 1);

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
  assert.deepEqual(visited, [...PHASE_IDS]); // 10 phase 全部经 HTTP 审批走完
  assert.match(intakeTasks.get(wf) ?? "", /客户 brief/);
  assert.match(intakeTasks.get(wf) ?? "", /Skill <项目根>\/sources\//);

  const frozenRefs = await app.inject({ method: "GET", url: `/api/workflows/${wf}/references`, headers: auth(owner.token) });
  assert.equal(frozenRefs.statusCode, 200);
  assert.match((frozenRefs.json() as { references: { bodySnapshot: string }[] }).references[0]!.bodySnapshot, /现金流/);

  const wfState = await app.inject({ method: "GET", url: `/api/workflows/${wf}`, headers: auth(owner.token) });
  assert.equal(wfState.statusCode, 200);
  assert.equal((wfState.json() as { currentPhase: string; status: string }).currentPhase, "phase6_enrichment");

  const artifactTree = await app.inject({ method: "GET", url: `/api/workflows/${wf}/artifacts`, headers: auth(owner.token) });
  assert.equal(artifactTree.statusCode, 200);
  const artifacts = (artifactTree.json() as {
    artifacts: { id: string; phase: string; type: string; version: number; status: string }[];
  }).artifacts;
  assert.ok(artifacts.some((a) => a.phase === "phase5_delivery" && a.type === "phase5_delivery"));
  assert.ok(artifacts.some((a) => a.phase === "phase6_enrichment" && a.type === "phase6_enrichment"));
  const finalReport = artifacts.find((a) => a.phase === "phase4_review" && a.type === "final-report");
  assert.ok(finalReport, "phase4 应产出 final-report");
  assert.equal(finalReport!.status, "published");

  const finalDoc = await app.inject({ method: "GET", url: `/api/artifacts/${finalReport!.id}`, headers: auth(owner.token) });
  assert.equal(finalDoc.statusCode, 200);
  assert.match((finalDoc.json() as { body: string }).body, /交付报告/);

  const share = await app.inject({
    method: "POST",
    url: "/api/shares",
    headers: auth(owner.token),
    payload: { workflowId: wf, scope: "report", ttlSec: 3600 },
  });
  assert.equal(share.statusCode, 201);
  const token = (share.json() as { token: string }).token;
  assert.ok(token);

  const publicMeta = await app.inject({ method: "GET", url: `/s/${token}` });
  assert.equal(publicMeta.statusCode, 200);
  assert.equal((publicMeta.json() as { workflowId: string; scope: string }).workflowId, wf);
  assert.equal((publicMeta.json() as { scope: string }).scope, "report");

  const publicReport = await app.inject({ method: "GET", url: `/s/${token}/report` });
  assert.equal(publicReport.statusCode, 200);
  assert.match(publicReport.headers["content-type"] as string, /text\/html/);
  assert.match(publicReport.body, /交付报告/);
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

test("HTTP rerun：editor 在 checkpoint 重跑某 phase → 200；非法 phase → 400", async () => {
  const owner = await registerUser(app);
  users.push(owner.userId);
  const projRes = await app.inject({ method: "POST", url: "/api/projects", headers: auth(owner.token), payload: { name: "RR" } });
  const projectId = (projRes.json() as { projectId: string }).projectId;
  projects.push(projectId);
  const wfRes = await app.inject({ method: "POST", url: "/api/workflows", headers: auth(owner.token), payload: { projectId } });
  const wf = (wfRes.json() as { workflowId: string }).workflowId;
  await waitPaused(wf);

  const bad = await app.inject({ method: "POST", url: `/api/workflows/${wf}/rerun`, headers: auth(owner.token), payload: { phase: "nope" } });
  assert.equal(bad.statusCode, 400);

  const ok = await app.inject({ method: "POST", url: `/api/workflows/${wf}/rerun`, headers: auth(owner.token), payload: { phase: "phase0_init" } });
  assert.equal(ok.statusCode, 200);
  assert.equal((ok.json() as { rerunFrom: string }).rerunFrom, "phase0_init");
  await waitPaused(wf); // 重跑后再次暂停
});

test("workflow start reports skipped failed references instead of silently dropping them", async () => {
  const owner = await registerUser(app);
  users.push(owner.userId);

  const projRes = await app.inject({ method: "POST", url: "/api/projects", headers: auth(owner.token), payload: { name: "SkipRefs" } });
  assert.equal(projRes.statusCode, 201);
  const projectId = (projRes.json() as { projectId: string }).projectId;
  projects.push(projectId);

  const okRef = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/references`,
    headers: auth(owner.token),
    payload: { filename: "ok.md", mimeType: "text/markdown", body: "可用 reference" },
  });
  assert.equal(okRef.statusCode, 201);
  const okId = (okRef.json() as { reference: { id: string } }).reference.id;

  const failed = await db.execute(sql`
    INSERT INTO project_references (project_id, filename, mime_type, size_bytes, body, parse_status, parse_error)
    VALUES (${projectId}, 'bad.pdf', 'application/pdf', 10, '', 'failed', 'OCR_DISABLED') RETURNING id`);
  const failedId = (failed as unknown as { rows: { id: string }[] }).rows[0]!.id;

  const wfRes = await app.inject({
    method: "POST",
    url: "/api/workflows",
    headers: auth(owner.token),
    payload: { projectId, mode: "调研", referenceIds: [okId, failedId] },
  });
  assert.equal(wfRes.statusCode, 201);
  const body = wfRes.json() as { referenceCount: number; skippedReferences: { id: string; filename: string; parseStatus: string }[] };
  assert.equal(body.referenceCount, 1);
  assert.equal(body.skippedReferences.length, 1);
  assert.equal(body.skippedReferences[0]!.id, failedId);
  assert.equal(body.skippedReferences[0]!.parseStatus, "failed");
});

test("reference upload is idempotent by content hash and returns 200 for duplicate", async () => {
  const owner = await registerUser(app);
  users.push(owner.userId);
  const projRes = await app.inject({ method: "POST", url: "/api/projects", headers: auth(owner.token), payload: { name: "IdempotentRefs" } });
  const projectId = (projRes.json() as { projectId: string }).projectId;
  projects.push(projectId);

  const payload = { filename: "brief.md", mimeType: "text/markdown", body: "客户 brief\n" };
  const first = await app.inject({ method: "POST", url: `/api/projects/${projectId}/references`, headers: auth(owner.token), payload });
  assert.equal(first.statusCode, 201);
  const firstId = (first.json() as { reference: { id: string } }).reference.id;

  const second = await app.inject({ method: "POST", url: `/api/projects/${projectId}/references`, headers: auth(owner.token), payload });
  assert.equal(second.statusCode, 200);
  assert.equal((second.json() as { reference: { id: string } }).reference.id, firstId);

  const rows = await db.execute(sql`SELECT COUNT(*)::int AS "count", COALESCE(SUM(size_bytes), 0)::int AS "bytes" FROM project_references WHERE project_id = ${projectId}`);
  const row = (rows as unknown as { rows: { count: number; bytes: number }[] }).rows[0]!;
  assert.equal(row.count, 1);
  assert.equal(row.bytes, Buffer.byteLength(payload.body));
});

test("reference idempotency is project-scoped and legacy NULL hashes remain forward-only", async () => {
  const owner = await registerUser(app);
  users.push(owner.userId);
  const p1 = (await app.inject({ method: "POST", url: "/api/projects", headers: auth(owner.token), payload: { name: "ScopeA" } }).then((r) => r.json())) as { projectId: string };
  const p2 = (await app.inject({ method: "POST", url: "/api/projects", headers: auth(owner.token), payload: { name: "ScopeB" } }).then((r) => r.json())) as { projectId: string };
  projects.push(p1.projectId, p2.projectId);

  const body = "same customer material";
  const mkPayload = { filename: "same.md", mimeType: "text/markdown", body };
  const a = await app.inject({ method: "POST", url: `/api/projects/${p1.projectId}/references`, headers: auth(owner.token), payload: mkPayload });
  const b = await app.inject({ method: "POST", url: `/api/projects/${p2.projectId}/references`, headers: auth(owner.token), payload: mkPayload });
  assert.equal(a.statusCode, 201);
  assert.equal(b.statusCode, 201);
  assert.notEqual((a.json() as { reference: { id: string } }).reference.id, (b.json() as { reference: { id: string } }).reference.id);

  await db.execute(sql`
    INSERT INTO project_references (project_id, filename, mime_type, size_bytes, body, parse_status, content_hash)
    VALUES (${p1.projectId}, 'legacy.md', 'text/markdown', ${Buffer.byteLength(body)}, ${body}, 'parsed', NULL)`);
  const before = await db.execute(sql`SELECT COUNT(*)::int AS "count" FROM project_references WHERE project_id = ${p1.projectId}`);
  const legacyReplay = await app.inject({ method: "POST", url: `/api/projects/${p1.projectId}/references`, headers: auth(owner.token), payload: { ...mkPayload, filename: "legacy-replay.md" } });
  assert.equal(legacyReplay.statusCode, 200, "replay dedupes against the new hashed row, not the legacy NULL row");
  const after = await db.execute(sql`SELECT COUNT(*)::int AS "count" FROM project_references WHERE project_id = ${p1.projectId}`);
  assert.equal(
    (after as unknown as { rows: { count: number }[] }).rows[0]!.count,
    (before as unknown as { rows: { count: number }[] }).rows[0]!.count,
  );

  const legacyOnlyProject = (await app.inject({ method: "POST", url: "/api/projects", headers: auth(owner.token), payload: { name: "LegacyOnly" } }).then((r) => r.json())) as { projectId: string };
  projects.push(legacyOnlyProject.projectId);
  await db.execute(sql`
    INSERT INTO project_references (project_id, filename, mime_type, size_bytes, body, parse_status, content_hash)
    VALUES (${legacyOnlyProject.projectId}, 'legacy.md', 'text/markdown', ${Buffer.byteLength(body)}, ${body}, 'parsed', NULL)`);
  const replay = await app.inject({ method: "POST", url: `/api/projects/${legacyOnlyProject.projectId}/references`, headers: auth(owner.token), payload: mkPayload });
  assert.equal(replay.statusCode, 201, "legacy NULL content_hash cannot be backfilled, so first new replay creates a hashed row");
});

test("reference storage budget is atomic under concurrent service writes", async () => {
  const owner = await registerUser(app);
  users.push(owner.userId);
  const projRes = await app.inject({ method: "POST", url: "/api/projects", headers: auth(owner.token), payload: { name: "BudgetRace" } });
  const projectId = (projRes.json() as { projectId: string }).projectId;
  projects.push(projectId);
  await db.execute(sql`
    INSERT INTO project_references (project_id, filename, mime_type, size_bytes, body, parse_status)
    VALUES (${projectId}, 'used.bin', 'text/plain', ${MAX_PROJECT_REFERENCE_BYTES - 300}, 'seed', 'parsed')`);

  const mk = (name: string, body: string) => createProjectReference(db, projectId, {
    filename: name,
    mimeType: "text/plain",
    sizeBytes: 200,
    body,
    contentHash: computeReferenceContentHash(Buffer.from(body, "utf8")),
  });
  const settled = await Promise.allSettled([mk("a.txt", "a".repeat(200)), mk("b.txt", "b".repeat(200))]);
  assert.equal(settled.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(settled.filter((r) => r.status === "rejected").length, 1);
});

test("missing references are partitioned as skipped and budget overflow maps to 400", async () => {
  const owner = await registerUser(app);
  users.push(owner.userId);
  const projRes = await app.inject({ method: "POST", url: "/api/projects", headers: auth(owner.token), payload: { name: "MissingAndBudget" } });
  const projectId = (projRes.json() as { projectId: string }).projectId;
  projects.push(projectId);

  const missingId = randomUUID();
  const partitioned = await loadProjectReferencesPartitioned(db, projectId, [missingId]);
  assert.deepEqual(partitioned, { loaded: [], skipped: [{ id: missingId, filename: null, parseStatus: "missing" }] });

  await db.execute(sql`
    INSERT INTO project_references (project_id, filename, mime_type, size_bytes, body, parse_status)
    VALUES (${projectId}, 'used.bin', 'text/plain', ${MAX_PROJECT_REFERENCE_BYTES - 5}, 'seed', 'parsed')`);
  const over = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/references`,
    headers: auth(owner.token),
    payload: { filename: "too-much.md", mimeType: "text/markdown", body: "0123456789" },
  });
  assert.equal(over.statusCode, 400);
  assert.equal((over.json() as { error: string }).error, "BAD_REFERENCE");
});

test("re-uploading a previously-failed parse refreshes the row instead of pinning the failure", async () => {
  const owner = await registerUser(app);
  users.push(owner.userId);
  const projRes = await app.inject({ method: "POST", url: "/api/projects", headers: auth(owner.token), payload: { name: "FailedReparse" } });
  const projectId = (projRes.json() as { projectId: string }).projectId;
  projects.push(projectId);

  // 模拟一次解析失败后落下的行：content_hash 与后续重传的原始字节一致。
  const body = "扫描件 OCR 此前失败的素材\n";
  const contentHash = computeReferenceContentHash(Buffer.from(body, "utf8"));
  const failed = await db.execute(sql`
    INSERT INTO project_references (project_id, filename, mime_type, size_bytes, content_hash, body, parse_status, parse_error)
    VALUES (${projectId}, 'scan.md', 'text/markdown', ${Buffer.byteLength(body)}, ${contentHash}, '', 'failed', 'OCR disabled')
    RETURNING id`);
  const failedId = (failed as unknown as { rows: { id: string }[] }).rows[0]!.id;

  // 原样重传：命中同 hash 的 failed 行 → 刷新为本次解析结果，返回同一行（200）。
  const replay = await app.inject({ method: "POST", url: `/api/projects/${projectId}/references`, headers: auth(owner.token), payload: { filename: "scan.md", mimeType: "text/markdown", body } });
  assert.equal(replay.statusCode, 200);
  assert.equal((replay.json() as { reference: { id: string } }).reference.id, failedId);

  const rows = await db.execute(sql`SELECT COUNT(*)::int AS "count", MAX(parse_status) AS "status", MAX(body) AS "body" FROM project_references WHERE project_id = ${projectId}`);
  const row = (rows as unknown as { rows: { count: number; status: string; body: string }[] }).rows[0]!;
  assert.equal(row.count, 1, "刷新而非新建：仍只有一行");
  assert.equal(row.status, "parsed", "failed 行已被本次成功解析刷新");
  assert.equal(row.body, body.trim(), "body 已写入刷新内容");
});
