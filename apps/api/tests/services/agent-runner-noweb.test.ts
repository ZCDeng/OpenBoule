/**
 * U4 researcher web 降级测试。ADITLY_MCP_URL="off" → 无 web 工具 + webEnabled=false（fail-loud 由 runner 标注）。
 * 用动态 import：ESM 静态 import 会被 hoist 到 env 赋值之前，故设 env 后再动态加载 config/agent-runner。
 */

import { test } from "node:test";
import assert from "node:assert/strict";

test("aditlyMcpUrl=off：researcher 降级，无 mcpServers / 无 web 工具", async () => {
  process.env.ADITLY_MCP_URL = "off"; // 在动态 import 之前
  const { rolePolicy } = await import("../../src/services/agent-runner.ts");
  const p = rolePolicy("industry-researcher");
  assert.equal(p.webEnabled, false);
  assert.equal(p.mcpServers, undefined);
  assert.deepEqual(p.allowedTools, []);
  assert.equal(p.allowToolExecution, true); // 仍允许执行，只是无工具可用
});
