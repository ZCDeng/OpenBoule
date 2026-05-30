/**
 * 日志脱敏测试（U3）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { scrubString, scrub } from "../../src/agents/log-scrubber.ts";

test("抹 Anthropic key", () => {
  const out = scrubString("key=sk-ant-api03-AbCdEf123456_xyz failed");
  assert.ok(!out.includes("sk-ant-api03"));
  assert.match(out, /REDACTED/);
});

test("抹 GitHub PAT（classic + fine-grained）", () => {
  assert.ok(!scrubString("ghp_" + "a".repeat(36)).includes("ghp_aaaa"));
  assert.ok(!scrubString("github_pat_" + "a".repeat(30)).includes("github_pat_aaa"));
});

test("抹 Bearer 头但保留前缀", () => {
  const out = scrubString("Authorization: Bearer abcdef1234567890xyz");
  assert.match(out, /Bearer «REDACTED»/);
});

test("结构化对象：敏感键整值抹掉，其余递归", () => {
  const out = scrub({
    anthropic_api_key: "sk-ant-secret",
    nested: { token: "whatever", note: "Bearer abcdef1234567890" },
    keep: "normal text",
  }) as any;
  assert.equal(out.anthropic_api_key, "«REDACTED»");
  assert.equal(out.nested.token, "«REDACTED»");
  assert.match(out.nested.note, /Bearer «REDACTED»/);
  assert.equal(out.keep, "normal text");
});
