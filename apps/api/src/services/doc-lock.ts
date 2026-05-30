/**
 * 单写者文档锁（U9 / KTD-16）。Redis 分布式锁，TTL 默认 5min + 心跳续期。
 *
 * 获取用 SET NX EX（原子）；续期/释放用 Lua 校验 owner（原子 compare-and-act，防误删/误续他人锁）。
 * 超时自动释放（TTL 到期 key 消失），被编辑内容由前端在释放前自动保存为最新版本（前端负责）。
 */

import type { Redis } from "ioredis";

export const DEFAULT_LOCK_TTL_SEC = 300; // 5min

function key(docId: string): string {
  return `doc:lock:${docId}`;
}

export type LockResult =
  | { ok: true; holder: string }
  | { ok: false; holder: string; ttlSec: number }; // 被他人持有

/** 获取锁。成功返回 ok+自己；已被他人持有返回 ok:false + 持有者 + 剩余秒。 */
export async function acquireLock(
  redis: Redis,
  docId: string,
  userId: string,
  ttlSec = DEFAULT_LOCK_TTL_SEC,
): Promise<LockResult> {
  const set = await redis.set(key(docId), userId, "EX", ttlSec, "NX");
  if (set === "OK") return { ok: true, holder: userId };
  // 已被持有：可能就是自己（重入）→ 续期并视为成功
  const holder = (await redis.get(key(docId))) ?? "";
  if (holder === userId) {
    await redis.expire(key(docId), ttlSec);
    return { ok: true, holder: userId };
  }
  const ttl = await redis.ttl(key(docId));
  return { ok: false, holder, ttlSec: ttl < 0 ? 0 : ttl };
}

const RENEW_LUA = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("EXPIRE", KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE_LUA = `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end`;

/** 心跳续期。仅 owner 成功（返回 true）；非 owner / 锁已失 → false。 */
export async function heartbeatLock(
  redis: Redis,
  docId: string,
  userId: string,
  ttlSec = DEFAULT_LOCK_TTL_SEC,
): Promise<boolean> {
  const r = (await redis.eval(RENEW_LUA, 1, key(docId), userId, String(ttlSec))) as number;
  return r === 1;
}

/** 释放。仅 owner 成功。 */
export async function releaseLock(redis: Redis, docId: string, userId: string): Promise<boolean> {
  const r = (await redis.eval(RELEASE_LUA, 1, key(docId), userId)) as number;
  return r === 1;
}

/** 查锁状态：持有者 + 剩余秒（无锁返回 null）。 */
export async function lockStatus(redis: Redis, docId: string): Promise<{ holder: string; ttlSec: number } | null> {
  const holder = await redis.get(key(docId));
  if (!holder) return null;
  const ttl = await redis.ttl(key(docId));
  return { holder, ttlSec: ttl < 0 ? 0 : ttl };
}
