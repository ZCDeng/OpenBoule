/**
 * 错误分类器测试（U3 / KTD-21 顺序即正确性）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyError, classifyErrorText, shouldDegrade } from "../../src/agents/errors.ts";

test("先 auth 再 rate：含 401 的文本判 AUTH_FAILED（不被 5xx/rate 抢）", () => {
  assert.equal(classifyErrorText("HTTP 401 unauthorized, also rate"), "AUTH_FAILED");
});

test("429 → RATE_LIMITED", () => {
  assert.equal(classifyErrorText("got 429 too many requests"), "RATE_LIMITED");
});

test("SDK error 枚举映射", () => {
  assert.equal(classifyError({ type: "result", error: "authentication_failed" }), "AUTH_FAILED");
  assert.equal(classifyError({ type: "result", error: "rate_limit" }), "RATE_LIMITED");
  assert.equal(classifyError({ type: "result", error: "server_error" }), "UPSTREAM_5XX");
});

test("兜底链：无 error 枚举 → subtype", () => {
  assert.equal(classifyError({ type: "result", subtype: "error_max_turns" }), "MAX_TURNS");
});

test("Error 对象 → 文本分类", () => {
  assert.equal(classifyError(new Error("connection 503 overloaded")), "UPSTREAM_5XX");
});

test("HTTP status 字段分类", () => {
  assert.equal(classifyError({ status: 502 }), "UPSTREAM_5XX");
});

test("shouldDegrade：5xx/rate 降级，auth 不降级", () => {
  assert.equal(shouldDegrade("UPSTREAM_5XX"), true);
  assert.equal(shouldDegrade("RATE_LIMITED"), true);
  assert.equal(shouldDegrade("AUTH_FAILED"), false);
  assert.equal(shouldDegrade(undefined), false);
});
