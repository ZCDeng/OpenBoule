/**
 * 单写者锁测试（U9 / KTD-16，真 Redis）。并发获取单赢 / 续期仅 owner / 释放仅 owner / 状态。
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { acquireLock, heartbeatLock, releaseLock, lockStatus } from "../../src/services/doc-lock.ts";
import { createSecurityRedis } from "../../src/services/redis.ts";

const redis = createSecurityRedis();
after(async () => {
  await redis.quit();
});

test("并发获取：只一个赢，另一个看到持有者 + 剩余", async () => {
  const doc = `d-${randomUUID()}`;
  const [a, b] = await Promise.all([acquireLock(redis, doc, "userA", 60), acquireLock(redis, doc, "userB", 60)]);
  const wins = [a, b].filter((r) => r.ok);
  const losses = [a, b].filter((r) => !r.ok);
  assert.equal(wins.length, 1);
  assert.equal(losses.length, 1);
  assert.ok((losses[0] as { holder: string }).holder); // 看得到持有者
  await releaseLock(redis, doc, wins[0]!.holder);
});

test("重入：同 owner 再次获取 → 成功并续期", async () => {
  const doc = `d-${randomUUID()}`;
  const a = await acquireLock(redis, doc, "userA", 60);
  assert.equal(a.ok, true);
  const again = await acquireLock(redis, doc, "userA", 60);
  assert.equal(again.ok, true);
  await releaseLock(redis, doc, "userA");
});

test("心跳续期：仅 owner 成功，非 owner 失败", async () => {
  const doc = `d-${randomUUID()}`;
  await acquireLock(redis, doc, "userA", 60);
  assert.equal(await heartbeatLock(redis, doc, "userA", 120), true);
  assert.equal(await heartbeatLock(redis, doc, "intruder", 120), false);
  const st = await lockStatus(redis, doc);
  assert.equal(st?.holder, "userA");
  assert.ok(st!.ttlSec > 60); // 续期到 ~120
  await releaseLock(redis, doc, "userA");
});

test("释放仅 owner；释放后可被他人获取", async () => {
  const doc = `d-${randomUUID()}`;
  await acquireLock(redis, doc, "userA", 60);
  assert.equal(await releaseLock(redis, doc, "intruder"), false); // 非 owner 释放失败
  assert.equal(await releaseLock(redis, doc, "userA"), true);
  assert.equal(await lockStatus(redis, doc), null); // 已释放
  const b = await acquireLock(redis, doc, "userB", 60);
  assert.equal(b.ok, true);
  await releaseLock(redis, doc, "userB");
});
