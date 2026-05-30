/**
 * executor 测试（U3）。用 mock runtime（不碰网络）验记账 / hooks / 超时 / finalText / errorCode。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runRole } from "../../src/agents/executor.ts";
import { createInMemoryCostHook } from "../../src/agents/hooks.ts";
import { shouldDegrade } from "../../src/agents/errors.ts";
import type { BouleRoleRuntime } from "../../src/agents/runtime.ts";
import type { NormalizedEvent } from "../../src/agents/event-types.ts";
import type { RoleContext, RuntimeKind } from "../../src/agents/types.ts";

function mockRuntime(events: NormalizedEvent[], opts: { hang?: boolean } = {}): BouleRoleRuntime {
  return {
    kind: "claude-sdk" as RuntimeKind,
    async *run() {
      for (const e of events) yield e;
      if (opts.hang) await new Promise(() => {}); // 永不 resolve，触发 watchdog
    },
  };
}

const ctx: RoleContext = {
  jobId: "j1",
  role: "information-architect",
  systemPrompt: "sp",
  task: "t",
  model: "claude-opus-4-8",
};

test("happy：累积 finalText + usage，onUsage 一次，ok=true", async () => {
  const { hook, records } = createInMemoryCostHook();
  const events: NormalizedEvent[] = [
    { type: "status", phase: "started" },
    { type: "text_delta", text: "ax" },
    { type: "text_delta", text: "is" },
    { type: "usage", inputTokens: 100, outputTokens: 20, cacheReadTokens: 50 },
    { type: "status", phase: "completed" },
  ];
  const r = await runRole(ctx, { runtimeImpl: mockRuntime(events), hooks: hook });
  assert.equal(r.ok, true);
  assert.equal(r.finalText, "axis");
  assert.equal(r.usage.outputTokens, 20);
  assert.equal(r.counts.text_delta, 2);
  assert.equal(records.length, 1);
  assert.ok(records[0]!.costUsd > 0);
});

test("failed：status failed(rate_limit) → errorCode RATE_LIMITED 且应降级", async () => {
  const events: NormalizedEvent[] = [
    { type: "status", phase: "started" },
    { type: "usage", inputTokens: 5, outputTokens: 0, cacheReadTokens: 0 },
    { type: "status", phase: "failed", detail: { errorEnum: "rate_limit" } },
  ];
  const r = await runRole(ctx, { runtimeImpl: mockRuntime(events) });
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, "RATE_LIMITED");
  assert.equal(shouldDegrade(r.errorCode), true);
});

test("timeout watchdog：挂住的 runtime → TERMINATED_UNKNOWN，onUsage 仍归账已花 token", async () => {
  const { hook, records } = createInMemoryCostHook();
  const events: NormalizedEvent[] = [
    { type: "status", phase: "started" },
    { type: "usage", inputTokens: 7, outputTokens: 3, cacheReadTokens: 0 },
  ];
  const r = await runRole(ctx, { runtimeImpl: mockRuntime(events, { hang: true }), hooks: hook, timeoutMs: 60 });
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, "TERMINATED_UNKNOWN");
  assert.equal(records.length, 1); // 即便超时，已花 token 仍归账
  assert.equal(records[0]!.usage.outputTokens, 3);
});

test("onEvent 每事件回调一次", async () => {
  const seen: string[] = [];
  const events: NormalizedEvent[] = [
    { type: "status", phase: "started" },
    { type: "text_delta", text: "x" },
    { type: "status", phase: "completed" },
  ];
  await runRole(ctx, {
    runtimeImpl: mockRuntime(events),
    hooks: { onEvent: (e) => void seen.push(e.type) },
  });
  assert.deepEqual(seen, ["status", "text_delta", "status"]);
});
