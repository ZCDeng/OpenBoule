/**
 * SSE 断点续传 + 重连重新鉴权（U6 / KTD-19, KTD-14）。
 * plan：带 Last-Event-ID 重连只补 id>lastEventId（不重投、不漏投）；降权重连 → 403。
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { EventReplayBuffer } from "../../src/workflow/events.ts";
import { replayEvents, authorizeSse } from "../../src/services/sse.ts";
import { db } from "../../src/db/client.ts";
import { seedProject, addMember, seedWorkflow, registerUser, makeApp, cleanupAll, securityRedis } from "./_helpers.ts";

const users: string[] = [];
const projects: string[] = [];

after(async () => {
  await cleanupAll(users, projects);
  await securityRedis.quit();
  await db.$client.end();
});

test("Last-Event-ID 续传：只补 id>lastEventId，不重投不漏投", async () => {
  const app = makeApp();
  const owner = await registerUser(app);
  await app.close();
  users.push(owner.userId);
  const pid = await seedProject(owner.userId); projects.push(pid);
  const wf = await seedWorkflow(pid);

  const buf = new EventReplayBuffer();
  const e1 = await buf.append(db, wf, "workflow-status-changed", { phase: "phase0_init" });
  const e2 = await buf.append(db, wf, "agent-progress", { i: 2 });
  const e3 = await buf.append(db, wf, "agent-progress", { i: 3 });

  // 客户端已收到 e1，带 Last-Event-ID=e1 重连
  const missing = await replayEvents(db, wf, e1.eventId);
  assert.deepEqual(missing.map((m) => m.eventId), [e2.eventId, e3.eventId]); // 只补 e2/e3
  assert.ok(!missing.some((m) => m.eventId <= e1.eventId)); // 不重投已收到的

  // 从 0 重连 = 全量
  const all = await replayEvents(db, wf, 0);
  assert.equal(all.length, 3);
});

test("重连重新鉴权：被降到非成员 → 403（不回放无权事件）", async () => {
  const app = makeApp();
  const owner = await registerUser(app);
  const member = await registerUser(app);
  await app.close();
  users.push(owner.userId, member.userId);
  const pid = await seedProject(owner.userId); projects.push(pid);
  const wf = await seedWorkflow(pid);

  await addMember(pid, member.userId, "viewer");
  const okAuth = await authorizeSse(db, member.userId, wf);
  assert.equal(okAuth.ok, true);

  // 移除成员资格（降权）后重连
  await db.execute(sql`DELETE FROM project_members WHERE project_id = ${pid} AND user_id = ${member.userId}`);
  const denied = await authorizeSse(db, member.userId, wf);
  assert.equal(denied.ok, false);
  assert.equal(denied.ok === false && denied.status, 403);
});
