/**
 * U0-spike1 — Agent SDK headless 跑通真实 role + 6 类归一化事件映射。
 *
 * 退出条件（plan U0）：
 *  (a) client 能正常启动和结束
 *  (b) 能声明 allowedTools（并 live 触发一次工具调用验 tool_use/tool_result）
 *  (c) 返回结果可解析
 *  (d) usage token 可提取
 *  (e) ClaudeSDKClient → 6 类归一化事件映射成立（live + fixture 双证，任一无源 fail-stop）
 *
 * run: node u0-agent-sdk/test-role.ts
 */

import { runRole } from "./executor.ts";
import {
  emptyProvenance,
  normalizeSdkMessage,
  provenanceComplete,
  type NormalizedEventType,
  type Provenance,
} from "./normalize.ts";
import { SDK_FIXTURES } from "./fixtures.ts";
import { createSnapshot, loadRoleFromSnapshot } from "../u0-truth-sync/sync.ts";

const EVENT_TYPES: NormalizedEventType[] = [
  "text_delta",
  "thinking_delta",
  "tool_use",
  "tool_result",
  "usage",
  "status",
];

function mergeProv(into: Provenance, from: Provenance) {
  for (const t of EVENT_TYPES) for (const s of from[t]) into[t].add(s);
}

console.log("── U0-spike1: Agent SDK headless + 6 事件映射 ──\n");

// 0) 真值源快照里取真实 role prompt（证明 executor 读快照，串起 spike3）
const snap = await createSnapshot();
const rolePrompt = loadRoleFromSnapshot(snap, "information-architect");
console.log(`role prompt  : information-architect.md @${snap.commit_sha.slice(0, 7)} (${rolePrompt.length} chars)\n`);

// 1) fixture 证明：6 类事件的 parse 都是真代码
const fixtureProv = emptyProvenance();
for (const f of SDK_FIXTURES) normalizeSdkMessage(f.msg, fixtureProv);
const fixtureCheck = provenanceComplete(fixtureProv);
console.log(`fixture 映射 : ${fixtureCheck.complete ? "6/6 类全部有 parse 路径 ✅" : `缺 ${fixtureCheck.missing.join(", ")} ❌`}\n`);

// 2) live 执行：真 role + 强制一次工具调用（验 tool_use/tool_result 的真实 SDK 来源）
console.log("live run     : 执行中（真调 Agent SDK，复用 claude CLI 登录）…\n");
const res = await runRole({
  jobId: "spike1-IA",
  systemPrompt: rolePrompt,
  task:
    "为确认运行环境，请先用 Bash 工具运行 `date` 命令；然后基于咨询方法论，" +
    "为「一个新中式茶饮品牌的市场进入策略」分解 3 个 test axis，每个 axis 用一行中文短句，前缀 axis-1/2/3。",
  allowedTools: ["Bash"],
  allowToolExecution: true,
  maxTurns: 8,
});

// 合并 live + fixture 的来源
const combined = emptyProvenance();
mergeProv(combined, fixtureProv);
mergeProv(combined, res.provenance);
const finalCheck = provenanceComplete(combined);

// ── 退出条件判定 ──
const axisLines = res.finalText
  .split("\n")
  .filter((l) => /axis-?\s?[123]/i.test(l));
const checks = {
  a_startEnd: res.events.some((e) => e.type === "status") && res.ok,
  b_toolsDeclared: res.toolsDeclared.length > 0,
  c_parseable: res.finalText.trim().length > 0 && axisLines.length >= 3,
  d_usage: res.usage.outputTokens > 0,
  e_mapping: finalCheck.complete,
};

console.log("live 结果:");
console.log(`  apiKeySource : ${res.apiKeySource}   model: ${res.model}`);
console.log(`  ok           : ${res.ok}   errorCode: ${res.errorCode ?? "—"}`);
console.log(`  usage        : in=${res.usage.inputTokens} out=${res.usage.outputTokens} cacheRead=${res.usage.cacheReadTokens}  cost=$${res.totalCostUsd}`);
console.log(`  event counts : ${EVENT_TYPES.map((t) => `${t}=${res.counts[t]}`).join("  ")}`);
console.log(`  axis 行      : ${axisLines.length}（${axisLines.slice(0, 3).map((s) => s.trim()).join(" | ")}）\n`);

// ── 6 事件映射表（U0 新增硬退出条件）──
console.log("6 类归一化事件映射表（live=真跑覆盖 / fixture=parse 兜底证明）:");
for (const t of EVENT_TYPES) {
  const live = res.provenance[t].size > 0;
  const fix = fixtureProv[t].size > 0;
  const src = [...combined[t]][0] ?? "—";
  console.log(
    `  ${t.padEnd(15)} ${combined[t].size > 0 ? "✅" : "❌"}  live=${live ? "✓" : "·"} fixture=${fix ? "✓" : "·"}  ← ${src}`,
  );
}

console.log("\n退出条件:");
console.log(`  (a) client 启动+结束    : ${checks.a_startEnd ? "PASS" : "FAIL"}`);
console.log(`  (b) allowedTools 声明   : ${checks.b_toolsDeclared ? "PASS" : "FAIL"}`);
console.log(`  (c) 结果可解析(≥3 axis) : ${checks.c_parseable ? "PASS" : "FAIL"}`);
console.log(`  (d) usage token 可提取  : ${checks.d_usage ? "PASS" : "FAIL"}`);
console.log(`  (e) 6 事件映射成立      : ${checks.e_mapping ? "PASS" : "FAIL"}`);

const allPass = Object.values(checks).every(Boolean);
console.log(`\nU0-spike1: ${allPass ? "✅ PASS" : "❌ FAIL"}`);
if (!allPass) process.exitCode = 1;
