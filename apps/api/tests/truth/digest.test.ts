/**
 * digest 算法回归（U2 / KTD-20）。
 * frozen fixture：锁住一个已知 输入→输出。任何改动 digest 算法的提交都会让本测试挂，
 * 强制开发者意识到"历史快照会漂移"并显式 bump DIGEST_VERSION + 更新本 fixture。
 *
 * run: pnpm --filter @boule/api test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTruthDigest, canonicalJSON, DIGEST_VERSION } from "../../src/truth/digest.ts";

const FIXTURE_MANIFEST = [
  { path: "skills/SKILL.md", hash: "h_skill" },
  { path: "skills/roles/information-architect.md", hash: "h_ia" },
  { path: "skills/augment-map.md", hash: "h_aug" },
];

// 改算法/版本必须同步改这两个常量（这正是守卫点）。
const FROZEN_VERSION = 1;
const FROZEN_DIGEST = "5613a509a57b36b269b9a8d8b9c7ffd7991e6a65981e25c6c2e8a8d7b312e5a5";

test("DIGEST_VERSION 未漂移", () => {
  assert.equal(DIGEST_VERSION, FROZEN_VERSION);
});

test("frozen fixture：已知 manifest → 已知 digest", () => {
  assert.equal(computeTruthDigest(FIXTURE_MANIFEST), FROZEN_DIGEST);
});

test("digest 与文件发现顺序无关（内部按 path 排序）", () => {
  const shuffled = [...FIXTURE_MANIFEST].reverse();
  assert.equal(computeTruthDigest(shuffled), FROZEN_DIGEST);
});

test("任一文件 hash 变 → digest 变", () => {
  const mutated = FIXTURE_MANIFEST.map((m, i) =>
    i === 0 ? { ...m, hash: m.hash + "x" } : m,
  );
  assert.notEqual(computeTruthDigest(mutated), FROZEN_DIGEST);
});

test("canonicalJSON 键递归排序、与输入键序无关", () => {
  const a = canonicalJSON({ b: 1, a: { d: 2, c: 3 } });
  const b = canonicalJSON({ a: { c: 3, d: 2 }, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":{"c":3,"d":2},"b":1}');
});
