/**
 * grep 自检 + 语言闸门测试（U5）。覆盖 plan：客户交付物含 basis: external: → flag 失败；两段式聚合。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { grepCheck, scanJargon } from "../../src/pm/grep-check.ts";
import { languageGate } from "../../src/pm/language-gate.ts";

// 模拟从真值源解析出的黑话清单（真实清单见 config.test 回归）
const PATTERNS = ["axis", "basis", "cohort", "Phase [0-9]", "H[1-5]\\.[0-9]"];

test("scanJargon：命中真值源黑话（含正则片段 Phase [0-9]）", () => {
  const hits = scanJargon("据 Phase 2 调研，basis: external: axis 4", PATTERNS);
  const matched = hits.map((h) => h.match);
  assert.ok(matched.includes("basis"));
  assert.ok(matched.includes("axis"));
  assert.ok(matched.includes("Phase 2"));
});

test("两段式聚合：任一命中 → 非 protocol-clean；干净 → clean", () => {
  assert.equal(grepCheck("含 cohort 2 买家", PATTERNS).protocolClean, false);
  assert.equal(grepCheck("纯自然中文，无流程词", PATTERNS).protocolClean, true);
});

test("语言闸门：客户交付物含 basis: external: → 不过闸（fail）", () => {
  const res = languageGate("依据 basis: external: axis 4 kill verdict", PATTERNS);
  assert.equal(res.passed, false);
  assert.ok(res.offendingTerms.includes("basis"));
  assert.ok(res.offendingTerms.includes("axis"));
});

test("语言闸门：零流程黑话客户文 → 过闸", () => {
  const res = languageGate("依据近两年城服并购公开案例，建议聚焦区域买家。", PATTERNS);
  assert.equal(res.passed, true);
  assert.equal(res.hits.length, 0);
});
