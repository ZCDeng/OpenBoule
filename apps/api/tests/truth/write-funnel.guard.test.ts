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
//  - app.ts / routes/workflows.ts：创建 workflow 时持久化快照——值经注入的 snapshotProvider
//    取自 createFrozenSnapshot，路由本身不构造 snapshot（缺 provider 即 503，已 review，U6）
//  - services/agent-runner.ts：**只读** workflow 快照取 role prompt（loadSnapshot SELECT），不写不构造（已 review，组合根）
//  - workflow/engine.ts：**只读** truth_snapshot->'manifest' 算 phase0 确定性脚手架（processScaffold SELECT），不写不构造（已 review，U2 去 agent 化）
//  - services/project-export.ts：R5 迁移**搬运原始快照**（export SELECT / import INSERT carry-over）。
//    刻意不 re-freeze——import 写入的是源实例已固化的快照，重新 createFrozenSnapshot 会捕获导入方 HEAD
//    而非源 HEAD，破坏 provenance。故此处合法写入但不经 createFrozenSnapshot（已 review，U2 R5）
const ALLOWLIST = new Set([
  "db/schema.ts",
  "truth/sync.ts",
  "truth/types.ts",
  "truth/loader.ts",
  "truth/drift.ts",
  "app.ts",
  "routes/workflows.ts",
  "services/agent-runner.ts",
  "workflow/engine.ts",
  "services/project-export.ts",
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
