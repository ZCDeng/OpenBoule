/**
 * task-threading 纯函数测试：axes 解析（容错）+ researcher task 构建。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAxes, researcherTask, type AxisItem } from "../../src/workflow/axes.ts";

test("parseAxes：```json 块 {axes:[{axis}]} → AxisItem[]", () => {
  const text = "分解如下。\n\n```json\n{\"axes\":[{\"axis\":\"市场规模\"},{\"axis\":\"竞争格局\",\"frame\":\"波特五力\"}]}\n```";
  assert.deepEqual(parseAxes(text), [{ axis: "市场规模" }, { axis: "竞争格局", frame: "波特五力" }]);
});

test("parseAxes：裸数组形态", () => {
  assert.deepEqual(parseAxes("```json\n[{\"axis\":\"A\"},\"B\"]\n```"), [{ axis: "A" }, { axis: "B" }]);
});

test("parseAxes：多个 json 块取最后一个有效的", () => {
  const text = "```json\n{\"draft\":true}\n```\n改定稿：\n```json\n{\"axes\":[{\"axis\":\"终版轴\"}]}\n```";
  assert.deepEqual(parseAxes(text), [{ axis: "终版轴" }]);
});

test("parseAxes：lanes 提取 + 过滤空 axis", () => {
  const text = "```json\n{\"axes\":[{\"axis\":\"X\",\"lanes\":[\"政策\",\"技术\"]},{\"axis\":\"\"},{\"axis\":\"  \"}]}\n```";
  assert.deepEqual(parseAxes(text), [{ axis: "X", lanes: ["政策", "技术"] }]);
});

test("parseAxes：容错——无块/坏 JSON/坏形状/非字符串 → []", () => {
  assert.deepEqual(parseAxes("纯文本无结构"), []);
  assert.deepEqual(parseAxes("```json\n{坏 json\n```"), []);
  assert.deepEqual(parseAxes("```json\n{\"foo\":1}\n```"), []);
  assert.deepEqual(parseAxes(""), []);
  assert.deepEqual(parseAxes(undefined as unknown as string), []);
});

test("researcherTask：有 axis → 含轴内容 + web 检索指令", () => {
  const axes: AxisItem[] = [{ axis: "出海合规", frame: "欧盟", lanes: ["法规", "案例"] }];
  const t = researcherTask(axes, 1, "fallback");
  assert.ok(t.includes("出海合规"));
  assert.ok(t.includes("欧盟"));
  assert.ok(t.includes("web 搜索工具"));
  assert.ok(t.includes("法规") && t.includes("案例"));
});

test("researcherTask：无对应 axis（越界）→ fallback", () => {
  assert.equal(researcherTask([], 1, "phase2_research"), "phase2_research");
  assert.equal(researcherTask([{ axis: "A" }], 2, "fb"), "fb");
});
