/**
 * 打包前置：把 apps/api 的 TS 入口编成可运行 JS（electron-builder 用）。
 *
 * 策略：esbuild 只 bundle 我们的 src/*.ts（顺带解析 .ts 扩展名 import），所有 npm 依赖标 external
 * （--packages=external 等价）——pglite/pdfjs 等带 WASM/原生资源的包不进 bundle，运行时从随包的
 * node_modules 加载，绕开 WASM 打包难题。迁移 SQL 复制到 dist/migrations（migrate.js 按相对路径找）。
 *
 * 产物：dist/server.js（进程入口）、dist/migrate.js（迁移）、dist/migrations/*（迁移 SQL）。
 * 跑：node scripts/build.mjs
 */
import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cp, rm, mkdir } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = join(here, "..");
const dist = join(apiRoot, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await esbuild.build({
  entryPoints: [join(apiRoot, "src", "server.ts"), join(apiRoot, "src", "db", "migrate.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20", // Electron 内置 Node 基线
  packages: "external", // 所有 npm 依赖运行时从 node_modules 取（含 WASM/原生）
  outdir: dist,
  // server.ts 与 db/migrate.ts 都直接落 dist 根（migrate.js 的 import.meta.url→dist，故 migrations 复制到 dist/migrations）
  outbase: undefined,
  logLevel: "info",
});

// drizzle 迁移 SQL 随包。esbuild 保留入口结构 → migrate.js 落 dist/db/migrate.js，
// 其 import.meta.url→dist/db/，故 migrationsFolder=dist/db/migrations，复制到此。
await cp(join(apiRoot, "src", "db", "migrations"), join(dist, "db", "migrations"), { recursive: true });

console.log("✅ api 编译完成 → apps/api/dist（server.js / db/migrate.js / db/migrations/）");
