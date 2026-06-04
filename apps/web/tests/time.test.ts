/**
 * 相对时间格式化测试（U6 follow-up）。注入固定 now，确定性。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { relativeTime } from "../src/lib/time.ts";

const NOW = Date.parse("2026-06-04T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

test("空 / 非法输入 → —", () => {
  assert.equal(relativeTime(null, NOW), "—");
  assert.equal(relativeTime(undefined, NOW), "—");
  assert.equal(relativeTime("not-a-date", NOW), "—");
});

test("分级：刚刚 / 分钟 / 小时 / 天 / 周", () => {
  assert.equal(relativeTime(ago(10 * S), NOW), "刚刚");
  assert.equal(relativeTime(ago(5 * M), NOW), "5 分钟前");
  assert.equal(relativeTime(ago(3 * H), NOW), "3 小时前");
  assert.equal(relativeTime(ago(2 * D), NOW), "2 天前");
  assert.equal(relativeTime(ago(2 * 7 * D), NOW), "2 周前");
});

test("边界：59s→刚刚，60s→1 分钟前；23h→小时，24h→1 天前", () => {
  assert.equal(relativeTime(ago(59 * S), NOW), "刚刚");
  assert.equal(relativeTime(ago(60 * S), NOW), "1 分钟前");
  assert.equal(relativeTime(ago(23 * H), NOW), "23 小时前");
  assert.equal(relativeTime(ago(24 * H), NOW), "1 天前");
});

test("超过约一月 → 绝对日期 YYYY-MM-DD", () => {
  const out = relativeTime(ago(60 * D), NOW);
  assert.match(out, /^\d{4}-\d{2}-\d{2}$/);
});
