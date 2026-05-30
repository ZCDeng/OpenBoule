/**
 * Coverage check 测试（U5）。覆盖 plan：空 axis 不 recovery 只上报、按 axis 分桶不跨桶凑数、lane gap。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCoverage } from "../../src/pm/coverage-check.ts";
import type { Finding } from "../../src/pm/types.ts";

const f = (axis: string, lane?: string): Finding => ({
  axis, sourceUrl: "https://x", importance: "supporting", lane,
});

test("空 axis 上报 gap（不自动 recovery——函数纯报，无副作用）", () => {
  const res = checkCoverage(
    [{ axis: "A" }, { axis: "B" }, { axis: "C" }],
    [f("A"), f("B")],
  );
  assert.deepEqual(res.emptyAxes, ["C"]);
});

test("按 axis 分桶，不跨桶凑数：A 多 finding 不能掩盖 B 为空", () => {
  const res = checkCoverage(
    [{ axis: "A" }, { axis: "B" }],
    [f("A"), f("A"), f("A")], // 全堆在 A
  );
  assert.ok(res.emptyAxes.includes("B")); // B 仍空，不被 A 凑数
  assert.equal(res.perAxis.find((p) => p.axis === "A")!.findingCount, 3);
  assert.equal(res.perAxis.find((p) => p.axis === "B")!.findingCount, 0);
});

test("无主 finding（axis 名不在声明集）单独计 unassigned，不掺进任何桶", () => {
  const res = checkCoverage([{ axis: "A" }], [f("A"), f("Z")]);
  assert.equal(res.unassignedFindings, 1);
  assert.equal(res.perAxis.find((p) => p.axis === "A")!.findingCount, 1);
});

test("lane gap：必跑 lane 无 finding 时标细粒度盲区", () => {
  const res = checkCoverage(
    [{ axis: "A", requiredLanes: ["biz", "moat"] }],
    [f("A", "biz")], // 只覆盖 biz
  );
  assert.deepEqual(res.laneGaps, [{ axis: "A", lane: "moat" }]);
  assert.deepEqual(res.perAxis[0]!.lanesCovered, ["biz"]);
});
