/**
 * U3 role 运行策略表测试。纯表逻辑——无 I/O、无 SDK。
 * researcher 拿高回合 + 可执行工具；纯推理 role 禁文件系统工具、不执行。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAgentProgressEvent, rolePolicy } from "../../src/services/agent-runner.ts";
import { config } from "../../src/config.ts";
import type { RoleContext } from "../../src/agents/types.ts";

test("researcher：可执行工具 + 高回合 + 大 watchdog", () => {
  const p = rolePolicy("industry-researcher");
  assert.equal(p.allowToolExecution, true);
  assert.equal(p.maxTurns, config.agent.researcherMaxTurns);
  assert.ok(p.maxTurns >= 12);
  assert.equal(p.watchdogMs, config.agent.watchdogMs);
  assert.ok(p.watchdogMs >= 300_000); // 比原 120s 大
});

test("researcher web 启用（默认 Aditly url 非空）：mcpServers + web 白名单", () => {
  const p = rolePolicy("industry-researcher");
  assert.equal(p.webEnabled, true);
  assert.ok(p.mcpServers && "aditly" in p.mcpServers);
  // 白名单全是 mcp__aditly__* web 工具，不含文件系统工具
  assert.ok(p.allowedTools.length >= 3);
  assert.ok(p.allowedTools.every((t) => t.startsWith("mcp__aditly__")));
  assert.ok(!p.allowedTools.includes("Bash"));
});

test("纯推理 role：禁文件系统工具、不执行工具、回合少", () => {
  for (const role of ["editor", "strategy-advisor", "source-verifier", "designer", "market-scanner", "information-architect"]) {
    const p = rolePolicy(role);
    assert.equal(p.allowToolExecution, false, `${role} 不应执行工具`);
    assert.equal(p.maxTurns, config.agent.reasoningMaxTurns);
    // 文件系统/执行工具被显式禁用（止 sandbox 空转）
    for (const t of ["Bash", "Glob", "Read", "Write", "Edit"]) {
      assert.ok(p.disallowedTools.includes(t), `${role} 应禁用 ${t}`);
    }
    // 纯推理 role 不开任何工具白名单
    assert.deepEqual(p.allowedTools, []);
  }
});

test("watchdog 默认值已从 120s 调大", () => {
  assert.ok(config.agent.watchdogMs > 120_000);
});

test("agent progress 事件不暴露 thinking_delta", () => {
  const ctx: RoleContext = {
    jobId: "wf1:phase1_intake:ia",
    role: "information-architect",
    systemPrompt: "system",
    task: "task",
    model: "test-model",
    allowedTools: [],
    disallowedTools: [],
    allowToolExecution: false,
  };

  assert.equal(
    normalizeAgentProgressEvent({ type: "thinking_delta", text: "hidden chain of thought" }, ctx, {
      workflowId: "wf1",
      phase: "phase1_intake",
    }),
    null,
  );

  const tool = normalizeAgentProgressEvent({ type: "tool_use", id: "tu1", name: "web_search" }, ctx, {
    workflowId: "wf1",
    phase: "phase1_intake",
  });
  assert.equal(tool?.type, "tool_use");
  assert.equal(tool?.toolName, "web_search");
  assert.equal(tool?.summary, "调用工具 web_search");
});

test("agent progress 丢弃高频 text_delta，避免逐 chunk 写 workflow_events", () => {
  const ctx: RoleContext = {
    jobId: "wf1:phase1_intake:ia",
    role: "information-architect",
    systemPrompt: "system",
    task: "task",
    model: "test-model",
    allowedTools: [],
    disallowedTools: [],
    allowToolExecution: false,
  };

  assert.equal(
    normalizeAgentProgressEvent({ type: "text_delta", text: "partial token chunk" }, ctx, {
      workflowId: "wf1",
      phase: "phase1_intake",
    }),
    null,
  );
});
