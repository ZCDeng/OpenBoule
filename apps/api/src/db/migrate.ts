/**
 * 迁移 runner（U1）。读取生成的 SQL 迁移，幂等执行。
 * 连接失败 → 打印结构化错误并以非零码退出（fail loud，不静默吞）。
 *
 * run: pnpm --filter @boule/api db:migrate
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config } from "../config.ts";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(here, "migrations");

async function main() {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 5_000,
  });
  try {
    // 先探活，连接失败给清晰错误而非 migrator 内部栈
    await pool.query("select 1");
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });
    console.log("✅ 迁移完成（幂等：已应用的迁移会被跳过）");
  } finally {
    await pool.end();
  }
}

/** 把 pg 的 AggregateError / ECONNREFUSED 等渲染成有因可查的单行消息（fail loud）。 */
function describe(err: unknown): string {
  if (err instanceof AggregateError) {
    const parts = err.errors.map(describe).filter(Boolean);
    return parts.length ? parts.join("; ") : "AggregateError（无子错误信息）";
  }
  if (err instanceof Error) {
    const code = (err as { code?: string }).code;
    const addr = (err as { address?: string; port?: number });
    const where = addr.address ? `（${addr.address}:${addr.port}）` : "";
    return [code, err.message, where].filter(Boolean).join(" ") || err.name;
  }
  return String(err);
}

main().catch((err) => {
  console.error(`❌ 迁移失败：${describe(err)}`);
  process.exitCode = 1;
});
