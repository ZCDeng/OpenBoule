/**
 * U2 R5 本地→团队 export/import（真 PG）。覆盖：round-trip + owner 重映射、bundle 校验拒绝、
 * 超大拒绝、原子事务（坏 workflow → 整体回滚不留半截 project）。
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { makeApp, registerUser, auth, seedProject, seedWorkflow, db, securityRedis } from "../routes/_helpers.ts";
import {
  exportProject,
  importProject,
  validateBundle,
  EXPORT_VERSION,
  MAX_BUNDLE_BYTES,
  type ProjectBundle,
} from "../../src/services/project-export.ts";

const users: string[] = [];
const projects: string[] = [];

after(async () => {
  for (const p of projects) await db.execute(sql`DELETE FROM projects WHERE id = ${p}`);
  for (const u of users) await db.execute(sql`DELETE FROM users WHERE id = ${u}`);
  await securityRedis.quit();
});

function minimalBundle(): ProjectBundle {
  return {
    bouleExportVersion: EXPORT_VERSION,
    project: { name: "迁移项目" },
    workflows: [
      {
        currentPhase: "phase2_research",
        status: "running",
        mode: "research",
        axes: [{ axis: "a1" }],
        truthSnapshot: { commit_sha: "t" },
        artifacts: [
          { phase: "phase2_research", type: "research", version: 1, body: "结论", status: "draft", stale: false, inputArtifactVersions: null },
        ],
      },
    ],
  };
}

test("validateBundle：合法通过；版本/结构/枚举非法拒", () => {
  assert.equal(validateBundle(minimalBundle(), 500).ok, true);
  assert.equal(validateBundle({ ...minimalBundle(), bouleExportVersion: 99 }, 500).ok, false);
  assert.equal(validateBundle({ bouleExportVersion: 1, project: {}, workflows: [] }, 500).ok, false, "name 缺");
  const badStatus = minimalBundle();
  badStatus.workflows[0]!.status = "bogus";
  assert.equal(validateBundle(badStatus, 500).ok, false, "workflow status 非法");
  const badArt = minimalBundle();
  badArt.workflows[0]!.artifacts[0]!.status = "bogus";
  assert.equal(validateBundle(badArt, 500).ok, false, "artifact status 非法");
  assert.equal(validateBundle(minimalBundle(), MAX_BUNDLE_BYTES + 1).ok, false, "超大拒");
});

test("export → import round-trip + owner 重映射", async () => {
  const app = makeApp();
  const author = await registerUser(app);
  const importer = await registerUser(app);
  users.push(author.userId, importer.userId);

  // author 建源项目 + workflow + 一个 artifact
  const srcPid = await seedProject(author.userId);
  projects.push(srcPid);
  const wfId = await seedWorkflow(srcPid);
  await db.execute(sql`
    INSERT INTO artifacts (workflow_id, phase, type, version, body, status)
    VALUES (${wfId}, 'phase2_research', 'research', 1, '研究正文', 'draft')`);

  const bundle = await exportProject(db, srcPid);
  assert.equal(bundle.workflows.length, 1);
  assert.equal(bundle.workflows[0]!.artifacts.length, 1);
  assert.equal(bundle.workflows[0]!.artifacts[0]!.body, "研究正文");

  // importer 导入 → 新项目归属 importer
  const newPid = await importProject(db, importer.userId, bundle);
  projects.push(newPid);
  const ownerRow = await db.execute(sql`SELECT owner_id AS "o" FROM projects WHERE id = ${newPid}`);
  assert.equal((ownerRow as unknown as { rows: { o: string }[] }).rows[0]!.o, importer.userId, "owner 重映射为导入者");

  const artRow = await db.execute(sql`
    SELECT a.body AS "b" FROM artifacts a JOIN workflows w ON w.id = a.workflow_id WHERE w.project_id = ${newPid}`);
  assert.equal((artRow as unknown as { rows: { b: string }[] }).rows[0]!.b, "研究正文", "artifact 重建");
  await app.close();
});

test("import 原子性：坏 workflow → 整体回滚（不留半截 project）", async () => {
  const app = makeApp();
  const importer = await registerUser(app);
  users.push(importer.userId);

  // 构造一个会在第二个 workflow 失败的 bundle（truthSnapshot 用循环引用无法序列化 → 抛错）
  const bundle = minimalBundle();
  bundle.project.name = "应回滚项目";
  const bad: Record<string, unknown> = {};
  bad.self = bad; // 循环引用 → JSON.stringify 抛
  bundle.workflows.push({
    currentPhase: "phase0_init",
    status: "running",
    mode: null,
    axes: null,
    truthSnapshot: bad,
    artifacts: [],
  });

  await assert.rejects(() => importProject(db, importer.userId, bundle), /circular|Converting/i);
  // 事务回滚：不应残留该名字的 project
  const leftover = await db.execute(sql`SELECT id FROM projects WHERE name = '应回滚项目'`);
  assert.equal((leftover as unknown as { rows: unknown[] }).rows.length, 0, "回滚后无半截 project");
  await app.close();
});

test("路由：export（owner）→ import 端到端 + 非法 bundle 422", async () => {
  const app = makeApp();
  const author = await registerUser(app);
  users.push(author.userId);
  const srcPid = await seedProject(author.userId);
  projects.push(srcPid);
  await seedWorkflow(srcPid);

  const exp = await app.inject({ method: "GET", url: `/api/projects/${srcPid}/export`, headers: auth(author.token) });
  assert.equal(exp.statusCode, 200);
  const bundle = exp.json() as ProjectBundle;

  const imp = await app.inject({
    method: "POST",
    url: "/api/projects/import",
    headers: auth(author.token),
    payload: bundle,
  });
  assert.equal(imp.statusCode, 201);
  projects.push((imp.json() as { projectId: string }).projectId);

  const bad = await app.inject({
    method: "POST",
    url: "/api/projects/import",
    headers: auth(author.token),
    payload: { bouleExportVersion: 1, project: { name: "" }, workflows: [] },
  });
  assert.equal(bad.statusCode, 422);
  await app.close();
});
