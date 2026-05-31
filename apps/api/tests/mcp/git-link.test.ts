/**
 * U4 Git-linked 安全核心（C 簇 P0）。validateLocalDir 用真实临时目录验证穿越/symlink/containment；
 * 路由验证两路径分流（团队拒 localDir、gitUrl 形态、owner-only）。
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { makeApp, registerUser, auth, seedProject, db, securityRedis } from "../routes/_helpers.ts";
import { isWithin, validateGitUrl, validateLocalDir } from "../../src/services/git-link.ts";

const users: string[] = [];
const projects: string[] = [];
const tmps: string[] = [];

after(async () => {
  for (const p of projects) await db.execute(sql`DELETE FROM projects WHERE id = ${p}`);
  for (const u of users) await db.execute(sql`DELETE FROM users WHERE id = ${u}`);
  for (const t of tmps) await rm(t, { recursive: true, force: true });
  delete process.env.BOULE_LOCAL_ROOT;
  await securityRedis.quit();
});

test("isWithin：子树命中、越界拒绝", () => {
  assert.equal(isWithin("/home/u", "/home/u/repo"), true);
  assert.equal(isWithin("/home/u", "/home/u"), true);
  assert.equal(isWithin("/home/u", "/home/uother"), false, "前缀但非子树");
  assert.equal(isWithin("/home/u", "/etc/passwd"), false);
});

test("validateGitUrl：接受 https/git@/ssh，拒 file:// 与裸串", () => {
  assert.equal(validateGitUrl("https://github.com/a/b.git").ok, true);
  assert.equal(validateGitUrl("git@github.com:a/b.git").ok, true);
  assert.equal(validateGitUrl("ssh://git@host/a/b").ok, true);
  assert.equal(validateGitUrl("file:///etc").ok, false, "file:// 绕过 localDir 守卫，拒");
  assert.equal(validateGitUrl("just-a-string").ok, false);
});

test("validateLocalDir：合法 git repo（root 子树内）→ ok", async () => {
  const root = await mkdtemp(join(tmpdir(), "boule-root-"));
  tmps.push(root);
  process.env.BOULE_LOCAL_ROOT = root;
  const repo = join(root, "myrepo");
  await mkdir(join(repo, ".git"), { recursive: true });
  const r = await validateLocalDir(repo);
  assert.equal(r.ok, true, r.error);
  assert.ok(r.resolvedDir);
});

test("validateLocalDir：非绝对路径 / 无 .git / 越界 全拒", async () => {
  const root = await mkdtemp(join(tmpdir(), "boule-root-"));
  tmps.push(root);
  process.env.BOULE_LOCAL_ROOT = root;

  assert.equal((await validateLocalDir("relative/path")).ok, false, "非绝对");

  const noGit = join(root, "plain");
  await mkdir(noGit, { recursive: true });
  assert.equal((await validateLocalDir(noGit)).ok, false, "无 .git");

  // 越界：root 外的真实目录
  const outside = await mkdtemp(join(tmpdir(), "boule-outside-"));
  tmps.push(outside);
  await mkdir(join(outside, ".git"), { recursive: true });
  assert.equal((await validateLocalDir(outside)).ok, false, "root 外越界");
});

test("validateLocalDir：symlink 跳出 root → realpath 拆穿后拒", async () => {
  const root = await mkdtemp(join(tmpdir(), "boule-root-"));
  const outside = await mkdtemp(join(tmpdir(), "boule-escape-"));
  tmps.push(root, outside);
  process.env.BOULE_LOCAL_ROOT = root;
  await mkdir(join(outside, ".git"), { recursive: true });
  await writeFile(join(outside, "secret.txt"), "x");
  // root 内的 symlink 指向 root 外
  const link = join(root, "sneaky");
  await symlink(outside, link);
  const r = await validateLocalDir(link);
  assert.equal(r.ok, false, "symlink 逃逸被 realpath 拆穿");
});

test("路由：团队模式拒 localDir（400）", async () => {
  const app = makeApp();
  const u = await registerUser(app);
  users.push(u.userId);
  const pid = await seedProject(u.userId);
  projects.push(pid);
  const res = await app.inject({
    method: "PATCH",
    url: `/api/projects/${pid}/git-link`,
    headers: auth(u.token),
    payload: { linkMode: "localDir", localBaseDir: "/tmp/x" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal((res.json() as { error: string }).error, "LOCAL_DIR_TEAM_REJECTED");
  await app.close();
});

test("路由：gitUrl 合法 → 200 落库；非法 → 422；非 owner → 403", async () => {
  const app = makeApp();
  const owner = await registerUser(app);
  const other = await registerUser(app);
  users.push(owner.userId, other.userId);
  const pid = await seedProject(owner.userId);
  projects.push(pid);

  const ok = await app.inject({
    method: "PATCH",
    url: `/api/projects/${pid}/git-link`,
    headers: auth(owner.token),
    payload: { linkMode: "gitUrl", gitUrl: "https://github.com/a/b.git" },
  });
  assert.equal(ok.statusCode, 200);
  const row = await db.execute(sql`SELECT link_mode AS "m", git_url AS "g" FROM projects WHERE id = ${pid}`);
  const r0 = (row as unknown as { rows: { m: string; g: string }[] }).rows[0]!;
  assert.equal(r0.m, "gitUrl");
  assert.equal(r0.g, "https://github.com/a/b.git");

  const bad = await app.inject({
    method: "PATCH",
    url: `/api/projects/${pid}/git-link`,
    headers: auth(owner.token),
    payload: { linkMode: "gitUrl", gitUrl: "not-a-url" },
  });
  assert.equal(bad.statusCode, 422);

  const forbidden = await app.inject({
    method: "PATCH",
    url: `/api/projects/${pid}/git-link`,
    headers: auth(other.token),
    payload: { linkMode: "gitUrl", gitUrl: "https://github.com/a/b.git" },
  });
  assert.equal(forbidden.statusCode, 403, "非 owner 拒");
  await app.close();
});
