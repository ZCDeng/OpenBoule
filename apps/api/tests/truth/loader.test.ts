/**
 * loader 测试（U2）：从固化快照读 role prompt，hash 校验防篡改。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256, computeTruthDigest } from "../../src/truth/digest.ts";
import { loadRolePrompt, listRoles, parseAugmentMap } from "../../src/truth/loader.ts";
import type { TruthSnapshot } from "../../src/truth/types.ts";

function makeSnapshot(files: Record<string, string>): TruthSnapshot {
  const manifest = Object.entries(files).map(([path, content]) => ({
    path,
    hash: sha256(content),
  }));
  return {
    commit_sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    synced_at: "2026-05-30T00:00:00.000Z",
    truth_digest: computeTruthDigest(manifest),
    manifest,
    contents: files,
  };
}

const snap = makeSnapshot({
  "skills/SKILL.md": "# SKILL\n",
  "skills/roles/information-architect.md": "# Information Architect\nrole body",
  "skills/roles/editor.md": "# Editor\nrole body",
  "skills/augment-map.md": "## Phase 2\n- deep-research\n- expand-axis\n## Phase 4\n- tighten-language\n",
});

test("loadRolePrompt 返回 hash 校验通过的 role 内容", () => {
  const ia = loadRolePrompt(snap, "information-architect");
  assert.match(ia, /Information Architect/);
});

test("role 不在快照 → 抛错", () => {
  assert.throws(() => loadRolePrompt(snap, "nonexistent"), /不在快照中/);
});

test("快照内容被篡改（hash 不符）→ 抛错", () => {
  const tampered: TruthSnapshot = {
    ...snap,
    contents: { ...snap.contents, "skills/roles/editor.md": "篡改内容" },
  };
  assert.throws(() => loadRolePrompt(tampered, "editor"), /hash 不符/);
});

test("listRoles 列出全部 role（排序）", () => {
  assert.deepEqual(listRoles(snap), ["editor", "information-architect"]);
});

test("parseAugmentMap 按 phase 分组列表项", () => {
  const am = parseAugmentMap(snap);
  assert.deepEqual(am.byPhase["Phase 2"], ["deep-research", "expand-axis"]);
  assert.deepEqual(am.byPhase["Phase 4"], ["tighten-language"]);
  assert.ok(am.raw.length > 0);
});
