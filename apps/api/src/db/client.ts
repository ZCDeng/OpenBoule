/**
 * DB 连接（U1 + macOS app 化）。
 *
 * 双驱动单一出口：
 *   - pg（团队模式）   = node-postgres Pool → drizzle。
 *   - pglite（本地 app）= 进程内 WASM Postgres → drizzle。dataDir 空=内存，非空=落盘。
 *
 * 全应用复用 `db`，关停统一走 `closeDb()`（不再直接暴露 pool —— 两种驱动关法不同）。
 * 运行时 API 表面一致（select/insert/transaction/execute），故对外类型统一为 NodePgDatabase。
 */

import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "../config.ts";
import * as schema from "./schema.ts";

export type DB = NodePgDatabase<typeof schema>;

let dbInstance: DB;
let closeImpl: () => Promise<void>;

if (config.dbDriver === "pglite") {
  // 动态 import：团队模式不加载 WASM 包。
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
  // dataDir 空串 → 内存实例；本地 app 由 Electron 注入持久目录。
  const client = new PGlite(config.pgliteDataDir || undefined);
  await client.waitReady;
  // pglite 与 node-postgres 的 drizzle 实例运行时 API 一致，类型统一对外。
  dbInstance = drizzlePglite(client, { schema }) as unknown as DB;
  closeImpl = async () => {
    await client.close();
  };
} else {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    // 连接失败快速暴露，不无限挂起
    connectionTimeoutMillis: 5_000,
  });
  dbInstance = drizzlePg(pool, { schema });
  closeImpl = async () => {
    await pool.end();
  };
}

export const db = dbInstance;

/** 优雅关停当前驱动（pg=pool.end / pglite=client.close）。组合根 shutdown 调用。 */
export async function closeDb(): Promise<void> {
  await closeImpl();
}

export { schema };
