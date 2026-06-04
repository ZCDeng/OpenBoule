/**
 * 项目状态点 tone 映射测试（U6 follow-up）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { projectStatusTone } from "../src/lib/derive.ts";

test("workflow_status 枚举四值映射", () => {
  assert.equal(projectStatusTone("running"), "running");
  assert.equal(projectStatusTone("paused_for_approval"), "attention");
  assert.equal(projectStatusTone("approved"), "done");
  assert.equal(projectStatusTone("rejected"), "failed");
});

test("无 workflow / null / 未知码 → draft", () => {
  assert.equal(projectStatusTone(null), "draft");
  assert.equal(projectStatusTone(undefined), "draft");
  assert.equal(projectStatusTone("whatever"), "draft");
});

test("防御性归并 labels.ts 语境的扩展码", () => {
  assert.equal(projectStatusTone("enqueued"), "running");
  assert.equal(projectStatusTone("completed"), "done");
  assert.equal(projectStatusTone("failed"), "failed");
  assert.equal(projectStatusTone("below_threshold"), "failed");
});
