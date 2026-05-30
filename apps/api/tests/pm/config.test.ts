/**
 * PM config 解析回归（U5）——对真实缓存的 SKILL.md / editor.md 解析，证明「从真值源读不硬编码」。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parsePmConfig, parseJargonPatterns } from "../../src/pm/config.ts";

const here = dirname(fileURLToPath(import.meta.url));
const skillsDir = join(here, "../../../../skills-cache/skills");
const skillMd = readFileSync(join(skillsDir, "SKILL.md"), "utf8");
const editorMd = readFileSync(join(skillsDir, "roles/editor.md"), "utf8");

test("解析真值源 SKILL.md 阈值：FETCH_BUDGET=20 / VERIFY_CAP=5 / REFUTATIONS_REQUIRED=2", () => {
  const cfg = parsePmConfig(skillMd, editorMd);
  assert.equal(cfg.fetchBudget, 20);
  assert.equal(cfg.verifyCap, 5);
  assert.equal(cfg.refutationsRequired, 2);
});

test("流程黑话清单来自 editor.md filter-1 grep（含 axis/basis/cohort/Phase）", () => {
  const patterns = parseJargonPatterns(editorMd);
  assert.ok(patterns.includes("axis"));
  assert.ok(patterns.includes("basis"));
  assert.ok(patterns.includes("cohort"));
  assert.ok(patterns.some((p) => /Phase/.test(p))); // "Phase [0-9]"
  assert.ok(patterns.length >= 10); // 真值源那条 grep 有十几项
});

test("真值源缺该 grep → fail loud（不静默兜底空表）", () => {
  assert.throws(() => parseJargonPatterns("# 没有任何 grep 行的文档"), /fail loud|未找到/);
});

test("阈值缺失 → 抛错（不静默默认）", () => {
  assert.throws(() => parsePmConfig("没有阈值", editorMd), /FETCH_BUDGET/);
});
