/**
 * U4 claude-sdk runtime options 透传测试。注入 spy query，断言 mcpServers/disallowedTools 进 options。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ClaudeSdkRuntime, type QueryFn } from "../../src/agents/runtimes/claude-sdk.ts";
import type { RoleContext } from "../../src/agents/types.ts";

function spyQuery(): { fn: QueryFn; calls: { prompt: unknown; options: any }[] } {
  const calls: { prompt: unknown; options: any }[] = [];
  // eslint 无关：异步空流，run() 只关心 options 已透传
  const fn: QueryFn = (args) => {
    calls.push(args as { prompt: unknown; options: any });
    return (async function* () {})();
  };
  return { fn, calls };
}

const baseCtx: RoleContext = {
  jobId: "j1",
  role: "industry-researcher",
  systemPrompt: "sp",
  task: "t",
  model: "claude-opus-4-8",
};

test("mcpServers 透传进 query options", async () => {
  const spy = spyQuery();
  const rt = new ClaudeSdkRuntime(spy.fn);
  const mcp = { aditly: { type: "http", url: "http://127.0.0.1:8643/mcp/" } };
  for await (const _ of rt.run({ ...baseCtx, mcpServers: mcp })) void _;
  assert.equal(spy.calls.length, 1);
  assert.deepEqual(spy.calls[0]!.options.mcpServers, mcp);
});

test("disallowedTools 非空时透传；空/缺省时不带该键", async () => {
  const spy = spyQuery();
  const rt = new ClaudeSdkRuntime(spy.fn);
  for await (const _ of rt.run({ ...baseCtx, disallowedTools: ["Bash", "Read"] })) void _;
  assert.deepEqual(spy.calls[0]!.options.disallowedTools, ["Bash", "Read"]);

  const spy2 = spyQuery();
  const rt2 = new ClaudeSdkRuntime(spy2.fn);
  for await (const _ of rt2.run({ ...baseCtx })) void _;
  assert.equal("disallowedTools" in spy2.calls[0]!.options, false);
  assert.equal("mcpServers" in spy2.calls[0]!.options, false);
});

test("allowToolExecution=true → bypassPermissions", async () => {
  const spy = spyQuery();
  const rt = new ClaudeSdkRuntime(spy.fn);
  for await (const _ of rt.run({ ...baseCtx, allowToolExecution: true })) void _;
  assert.equal(spy.calls[0]!.options.permissionMode, "bypassPermissions");
});
