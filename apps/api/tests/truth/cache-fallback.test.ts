/**
 * 缓存降级回归（U2）。
 * 守住一个真实修过的 bug：readFromCache 曾对路径重复加 "skills/" 前缀，导致
 * GitHub 不可用时本地缓存读不出来（manifest 空 → 误判"无缓存可降级"）。
 *
 * 离线测试（不碰网络）：预置一个临时 skills-cache，无 GITHUB_TOKEN 时
 * syncTruthSource 必须 source="cache" 读出全部文件。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 必须在 import sync.ts 之前设好 env（CACHE_DIR 在模块加载时定值）。
const CACHE = join(tmpdir(), `boule-truth-cache-${process.pid}`);
process.env.SKILLS_CACHE_DIR = CACHE;
delete process.env.GITHUB_TOKEN;

function seedCache() {
  const files: Record<string, string> = {
    "skills/SKILL.md": "# SKILL\n",
    "skills/augment-map.md": "## Phase 2\n- x\n",
    "skills/roles/information-architect.md": "# IA\n",
    "skills/roles/editor.md": "# Editor\n",
  };
  for (const [p, c] of Object.entries(files)) {
    const dest = join(CACHE, p);
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, c);
  }
  writeFileSync(
    join(CACHE, ".truth-meta.json"),
    JSON.stringify({ commit_sha: "cafe", truth_digest: "x", synced_at: "2026-05-30T00:00:00.000Z" }),
  );
}

test("无 token + 有缓存 → 降级读缓存（source=cache，文件齐全）", async () => {
  seedCache();
  const { syncTruthSource } = await import("../../src/truth/sync.ts");
  const r = await syncTruthSource();
  assert.equal(r.source, "cache");
  assert.equal(r.files.length, 4);
  assert.ok(r.files.includes("skills/roles/information-architect.md"));
  rmSync(CACHE, { recursive: true, force: true });
});

test("无 token + 无缓存 → fail loud（不静默成功）", async () => {
  rmSync(CACHE, { recursive: true, force: true });
  const { syncTruthSource } = await import("../../src/truth/sync.ts");
  await assert.rejects(() => syncTruthSource(), /无本地缓存可降级/);
});
