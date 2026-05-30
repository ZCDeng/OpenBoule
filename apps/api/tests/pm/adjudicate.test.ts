/**
 * 裁决核心测试（U5 / KTD-21）。覆盖 plan：自报已确认但票不足 → undetermined；
 * 规则表顺序回归（报 flag 又崩 ≠ confirmed）；弃权归一不拉偏。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { adjudicateClaim, computeComposite } from "../../src/pm/adjudicate.ts";
import type { Ballot } from "../../src/pm/types.ts";

const REQ = 2;

test("模型自报已确认但有效票<2 → 代码裁 undetermined（不采信自报）", () => {
  const ballots: Ballot[] = [
    { refuted: false, selfReportedVerdict: "confirmed" },
    null,
    null,
  ];
  const a = adjudicateClaim(ballots, REQ);
  assert.equal(a.verdict, "undetermined");
  assert.equal(a.validCount, 1);
});

test("规则顺序回归：1 票且该票驳倒 → undetermined，绝不误判 confirmed", () => {
  // refuted=1 < 2 看似「驳倒不足→confirmed」，但有效票=1<2，必须先判 undetermined
  const a = adjudicateClaim([{ refuted: true }, null], REQ);
  assert.equal(a.verdict, "undetermined"); // 顺序对 → 不被误判 confirmed
  assert.notEqual(a.verdict, "confirmed");
});

test("confirmed：3 票全撑住 → High；3 票 1 驳（<2）→ Medium", () => {
  assert.deepEqual(
    (() => {
      const x = adjudicateClaim([{ refuted: false }, { refuted: false }, { refuted: false }], REQ);
      return [x.verdict, x.confidence];
    })(),
    ["confirmed", "High"],
  );
  const split = adjudicateClaim([{ refuted: false }, { refuted: false }, { refuted: true }], REQ);
  assert.equal(split.verdict, "confirmed");
  assert.equal(split.confidence, "Medium");
});

test("killed：≥2 驳倒且无可救窄版", () => {
  const a = adjudicateClaim([{ refuted: true }, { refuted: true }], REQ);
  assert.equal(a.verdict, "killed");
});

test("salvage：≥2 驳倒但有可辩护窄版", () => {
  const a = adjudicateClaim([{ refuted: true, hasNarrowVersion: true }, { refuted: true }], REQ);
  assert.equal(a.verdict, "salvage");
});

test("弃权归一：缺席不拉偏，composite 只在在场者间算", () => {
  // 在场 2 票：1 survive 1 refute → 0.5（缺席的 null 不计入分母，不当 refute 也不当 survive）
  assert.equal(computeComposite([{ refuted: false }, null, { refuted: true }]), 0.5);
  // 全在场全撑住 → 1
  assert.equal(computeComposite([{ refuted: false }, { refuted: false }]), 1);
  // 全弃权 → 0（无信息）
  assert.equal(computeComposite([null, null]), 0);
});

test("弃权加权归一：缺席权重按比例重分配给在场者", () => {
  // 权重 [2,1,1]，第 2 票缺席。在场权重 2(survive)+1(refute)=3，survive=2 → 2/3
  const c = computeComposite([{ refuted: false }, null, { refuted: true }], [2, 1, 1]);
  assert.ok(Math.abs(c - 2 / 3) < 1e-9);
});
