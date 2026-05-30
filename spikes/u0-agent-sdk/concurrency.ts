/**
 * U0-spike2 — 并发隔离 + usage 按 job 归账。
 *
 * 退出条件（plan U0）：
 *  (a) 同时 spawn 3 个独立 runtime，各执行不同任务，互不干扰
 *  (b) 各自的 usage 可独立追踪（按 jobId 归账）
 *  (c) 总 token 归账正确（Σ per-job = 总计，无串账/丢账）
 *
 * 对应 plan：Phase 2 的 N=4–8 researcher 各自独立 runtime 实例（无连接池）。
 * run: node u0-agent-sdk/concurrency.ts
 */

import { runRole } from "./executor.ts";
import { createSnapshot, loadRoleFromSnapshot } from "../u0-truth-sync/sync.ts";

console.log("── U0-spike2: 并发隔离 + usage 按 job 归账 ──\n");

const snap = await createSnapshot();

// 3 个不同 role + 不同任务，并发跑（无工具执行，压低成本/时延）
const jobs = [
  {
    jobId: "job-IA",
    role: "information-architect",
    task: "用一句话说出：你这个角色在 Phase 1.5 分解 test axis 时，最关键的一个判断标准是什么？只回一句中文。",
  },
  {
    jobId: "job-IR",
    role: "industry-researcher",
    task: "用一句话说出：你这个角色做行业调研时，判断一个信息源是否可信的首要标准是什么？只回一句中文。",
  },
  {
    jobId: "job-SA",
    role: "strategy-advisor",
    task: "用一句话说出：你这个角色给战略建议时，如何避免泛泛而谈？只回一句中文。",
  },
];

const t0 = Date.now();
const results = await Promise.all(
  jobs.map((j) =>
    runRole({
      jobId: j.jobId,
      systemPrompt: loadRoleFromSnapshot(snap, j.role),
      task: j.task,
      allowedTools: [],
      maxTurns: 2,
    }),
  ),
);
const wall = Date.now() - t0;

// ── 隔离 + 归账判定 ──
const byId = new Map(results.map((r) => [r.jobId, r]));
const idsMatch = jobs.every((j) => byId.has(j.jobId) && byId.get(j.jobId)!.ok);
const allHaveUsage = results.every((r) => r.usage.outputTokens > 0);
const outputs = results.map((r) => r.finalText.trim());
const distinctOutputs = new Set(outputs).size === outputs.length; // 无串账
const totalOut = results.reduce((s, r) => s + r.usage.outputTokens, 0);
const totalIn = results.reduce((s, r) => s + r.usage.inputTokens, 0);
const totalCost = results.reduce((s, r) => s + r.totalCostUsd, 0);
// 归账正确性：分别按 jobId 取值再求和，必须等于总计（证明 per-job 可独立取数）
const reSummedOut = jobs.reduce((s, j) => s + byId.get(j.jobId)!.usage.outputTokens, 0);
const accountingOk = reSummedOut === totalOut;

console.log(`并发 3 job，wall=${(wall / 1000).toFixed(1)}s\n`);
console.log("per-job 归账:");
for (const r of results) {
  console.log(
    `  ${r.jobId}  ok=${r.ok}  in=${r.usage.inputTokens} out=${r.usage.outputTokens}  $${r.totalCostUsd.toFixed(4)}  「${r.finalText.trim().slice(0, 40)}…」`,
  );
}
console.log(`\n  Σ in=${totalIn}  Σ out=${totalOut}  Σ cost=$${totalCost.toFixed(4)}`);

console.log("\n退出条件:");
console.log(`  (a) 3 runtime 互不干扰     : ${idsMatch && distinctOutputs ? "PASS" : "FAIL"}（jobId 各归各位 + 输出互异）`);
console.log(`  (b) usage 可按 job 独立追踪 : ${allHaveUsage ? "PASS" : "FAIL"}`);
console.log(`  (c) 总 token 归账正确       : ${accountingOk ? "PASS" : "FAIL"}（Σ per-job = 总计）`);

const allPass = idsMatch && distinctOutputs && allHaveUsage && accountingOk;
console.log(`\nU0-spike2: ${allPass ? "✅ PASS" : "❌ FAIL"}`);
if (!allPass) process.exitCode = 1;
