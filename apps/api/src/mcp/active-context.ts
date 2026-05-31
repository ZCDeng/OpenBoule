/**
 * Active Context（U1 / KTD-3）。Web 前端心跳写「当前打开的 project/workflow/phase」，
 * MCP 工具不传参时据此自动定位（消除 CLI↔Web 上下文断裂）。
 *
 * 双源（A 簇）：team 模式写 Redis（TTL 5min，断线 5min 内仍可恢复）；local 模式写单 JSON 文件
 * （单进程无并发，不起 Redis）。键按 userId 命名空间（F 簇：MCP 只读自己 userId 的键，防越权）。
 * 多标签页「以最近交互为准」= 同 userId 键 last-write-wins。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Redis } from "ioredis";
import { config } from "../config.ts";

export interface ActiveContext {
  projectId?: string;
  workflowId?: string;
  phase?: string;
  document?: string;
  /** 写入会话标识（审计用，非定位键）。 */
  sessionId?: string;
  /** 写入时刻（ms），读取按此判最近。 */
  ts: number;
}

const TTL_SEC = 300; // 5min
const redisKey = (userId: string) => `active_context:${userId}`;

function localFilePath(): string {
  return join(homedir(), ".boule", "local", "active-context.json");
}

/** 写 active context（心跳）。team→Redis，local→JSON 文件。 */
export async function writeActiveContext(
  redis: Redis,
  userId: string,
  ctx: Omit<ActiveContext, "ts">,
): Promise<void> {
  const value: ActiveContext = { ...ctx, ts: Date.now() };
  if (config.mode === "local") {
    const path = localFilePath();
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    // 本地单用户：键内联 userId，读取时校验匹配。
    await writeFile(path, JSON.stringify({ userId, value }), { mode: 0o600 });
    return;
  }
  // Redis 失败不该 500 心跳（best-effort 信号，code-review #4）：吞错降级，与 local 分支对称。
  try {
    await redis.set(redisKey(userId), JSON.stringify(value), "EX", TTL_SEC);
  } catch {
    // 心跳丢一拍无碍——下次交互再写。
  }
}

/** 读 active context；无则 null。local 模式校验文件内 userId 与请求方匹配（防越权读他人）。 */
export async function readActiveContext(redis: Redis, userId: string): Promise<ActiveContext | null> {
  if (config.mode === "local") {
    try {
      const raw = await readFile(localFilePath(), "utf8");
      const parsed = JSON.parse(raw) as { userId: string; value: ActiveContext };
      if (parsed.userId !== userId) return null;
      return parsed.value;
    } catch {
      return null; // 文件不存在 = 尚无 active context
    }
  }
  try {
    const raw = await redis.get(redisKey(userId));
    return raw ? (JSON.parse(raw) as ActiveContext) : null;
  } catch {
    return null; // Redis blip → 当作无 active context（code-review #4，与 local 分支对称）
  }
}
