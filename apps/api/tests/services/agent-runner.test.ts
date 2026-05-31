/**
 * U3 role 运行策略表测试。纯表逻辑——无 I/O、无 SDK。
 * researcher 拿高回合 + 可执行工具；纯推理 role 禁文件系统工具、不执行。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { rolePolicy } from "../../src/services/agent-runner.ts";
import { config } from "../../src/config.ts";

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
