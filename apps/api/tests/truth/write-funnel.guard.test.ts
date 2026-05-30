/**
 * 写入收口守卫（U2 / KTD-20 不变式 2）。
 *
 * `workflows.truth_snapshot` 的值只能由 `truth/sync.ts#createFrozenSnapshot()` 生产。
 * 本守卫扫描 src/，断言除 allowlist 外没有文件引用 `truthSnapshot` / `truth_snapshot`。
 *
 * 这是 tripwire：当未来某 IU（如 U4 创建 workflow）开始 INSERT truth_snapshot 时，本测试
 * 会挂 → 作者必须 (a) 确认该处用了 createFrozenSnapshot 取值，(b) 把文件加进 allowlist。
 * 强制"旁路写 snapshot"被显式 review，而非静默溜过。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", "..", "src");

// 允许引用 truth_snapshot 的文件（相对 src/）：
//  - db/schema.ts：定义该列
//  - truth/*：产生者 / 类型 / 读取者 / drift
const ALLOWLIST = new Set([
  "db/schema.ts",
  "truth/sync.ts",
  "truth/types.ts",
  "truth/loader.ts",
  "truth/drift.ts",
]);

const PATTERN = /truthSnapshot|truth_snapshot/;

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listTsFiles(abs));
    else if (ent.name.endsWith(".ts")) out.push(abs);
  }
  return out;
}

test("truth_snapshot 写入收口：无 allowlist 外的引用", () => {
  const offenders: string[] = [];
  for (const abs of listTsFiles(SRC)) {
    const rel = relative(SRC, abs).replace(/\\/g, "/");
    if (ALLOWLIST.has(rel)) continue;
    if (PATTERN.test(readFileSync(abs, "utf8"))) offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    `发现旁路引用 truth_snapshot 的文件：${offenders.join(", ")}。` +
      `若确为合法写入，请确认用了 createFrozenSnapshot() 并加进 ALLOWLIST。`,
  );
});
