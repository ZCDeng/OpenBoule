/**
 * DB 连接（U1）。单 Pool + drizzle 实例，全应用复用。
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "../config.ts";
import * as schema from "./schema.ts";

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  // 连接失败快速暴露，不无限挂起
  connectionTimeoutMillis: 5_000,
});

export const db = drizzle(pool, { schema });

export type DB = typeof db;
export { schema };
