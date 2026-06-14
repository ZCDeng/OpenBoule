/**
 * Phase 运行器纯单测（mock agentRunner，不碰 DB / 队列）。
 * 聚焦第 5 交互轨 runInteractiveTrack 的契约：role 前缀、task 透传、artifact 类型。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runInteractiveTrack, type AgentRunner } from "../../src/workflow/phases/index.ts";

/** 记录最后一次调用的 spec，便于断言 role / task。 */
function spyRunner(text = "<html></html>"): { runner: AgentRunner; last: () => { role: string; task: string } } {
  let captured: { role: string; task: string } = { role: "", task: "" };
  const runner: AgentRunner = async (spec) => {
    captured = { role: spec.role, task: spec.task };
    return { ok: true, text };
  };
  return { runner, last: () => captured };
}

test("交互轨：role = interactive-<kind>，artifact type = interactive", async () => {
  const spy = spyRunner();
  const r = await runInteractiveTrack(spy.runner, {
    workflowId: "wf1",
    phase: "phase5_delivery",
    kind: "html-diagram",
    reportBody: "定稿正文 XYZ",
  });
  assert.equal(spy.last().role, "interactive-html-diagram");
  assert.equal(r.artifact.type, "interactive");
  assert.equal(r.artifact.status, "draft");
  assert.equal(r.ok, true);
});

test("交互轨：task 透传定稿内容 + kind 简报（内容只来自定稿）", async () => {
  const spy = spyRunner();
  await runInteractiveTrack(spy.runner, {
    workflowId: "wf1",
    phase: "phase5_delivery",
    kind: "html",
    reportBody: "独有定稿标记-7788",
  });
  const task = spy.last().task;
  assert.ok(task.includes("独有定稿标记-7788"), "task 应含定稿正文");
  assert.ok(task.includes("单文件自包含"), "task 应约束单文件自包含");
  assert.ok(task.includes("explainer") || task.includes("交互工具"), "task 应含 html kind 简报");
});

test("交互轨：agent 失败时 ok=false 带 errorCode（engine 据此留痕不阻断标准交付）", async () => {
  const runner: AgentRunner = async () => ({ ok: false, text: "", errorCode: "TIMEOUT" });
  const r = await runInteractiveTrack(runner, {
    workflowId: "wf1",
    phase: "phase5_delivery",
    kind: "html-plan",
    reportBody: "x",
  });
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, "TIMEOUT");
});
