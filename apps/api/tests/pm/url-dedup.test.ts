/**
 * URL 去重 + 抓取预算测试（U5）。覆盖 plan happy（normURL 去重）+ 透明丢弃。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { normURL, dedupeSources } from "../../src/pm/url-dedup.ts";
import type { Finding } from "../../src/pm/types.ts";

const f = (axis: string, url: string, importance: Finding["importance"] = "supporting"): Finding => ({
  axis, sourceUrl: url, importance,
});

test("normURL：去 www + 去尾斜杠 + 小写，www 版与裸版归一相等", () => {
  assert.equal(normURL("https://www.example.com/"), "example.com");
  assert.equal(normURL("https://www.example.com/"), normURL("https://example.com"));
  assert.equal(normURL("HTTPS://Example.COM/Path/"), "example.com/path");
});

test("同源跨路：第二条标 source_shared_with，uniqueSources 只计一次", () => {
  const res = dedupeSources(
    [f("A", "https://www.x.com/a"), f("B", "https://x.com/a")],
    20,
  );
  assert.equal(res.uniqueSources, 1);
  assert.equal(res.dupeCount, 1);
  const shared = res.findings.find((x) => x.sourceSharedWith);
  assert.ok(shared, "应有一条被标同源");
  assert.equal(shared!.sourceSharedWith!.axis, "A"); // 首次出现位置
  assert.equal(res.findings.length, 2); // 不删 finding
});

test("预算透明丢弃：central 先占预算且永不丢，超预算的非 central 进 budgetDropped", () => {
  const res = dedupeSources(
    [
      f("A", "https://a.com", "tangential"),
      f("B", "https://b.com", "central"),
      f("C", "https://c.com", "supporting"),
    ],
    1, // 预算只够 1 个独立源
  );
  // central 先占（排序后第一），独立源数=1
  assert.equal(res.uniqueSources, 1);
  // 其余非 central 超预算被透明丢弃
  assert.equal(res.budgetDropped.length, 2);
  assert.ok(!res.budgetDropped.some((x) => x.importance === "central")); // central 永不丢
  assert.ok(res.findings.some((x) => x.importance === "central"));
});
