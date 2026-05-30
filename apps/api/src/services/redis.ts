/**
 * 安全集 Redis 连接（U6）——nonce / 限流 / 一次性 ticket，逻辑 DB 与 BullMQ 隔离（KTD-19）。
 * 调用方负责 quit()。
 */

import { Redis } from "ioredis";
import { config } from "../config.ts";

export function createSecurityRedis(): Redis {
  return new Redis({
    host: config.redis.host,
    port: config.redis.port,
    db: config.redis.securityDb,
    maxRetriesPerRequest: 2,
  });
}
