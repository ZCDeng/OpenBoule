/**
 * 本地模式固定用户（U2）。免登录单用户 = 一个确定性的 users 行（满足 projects.owner_id FK）。
 * boot 时幂等 upsert；authenticate 在本地模式注入这个 userId。
 */

import { sql } from "drizzle-orm";
import type { DB } from "../db/client.ts";

/** 固定本地用户 id（确定性 UUID，便于备份/迁移识别）。 */
export const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000001";

/** 幂等确保本地用户存在（密码 hash 占位——本地模式不走登录）。 */
export async function ensureLocalUser(db: DB): Promise<void> {
  await db.execute(sql`
    INSERT INTO users (id, email, password_hash, name)
    VALUES (${LOCAL_USER_ID}, 'local@boule.local', 'x-local-no-login', 'Local')
    ON CONFLICT (id) DO NOTHING`);
}
