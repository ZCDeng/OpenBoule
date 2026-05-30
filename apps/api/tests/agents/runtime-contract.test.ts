/**
 * runtime 契约一致性（U3 / KTD-17）。
 * 两 runtime 对等价输入产出**经归一化后语义等价**的事件流：6 类事件类型齐全 + 最终态一致。
 * 不要求逐字节相同序列（底层流分块不同）。
 *
 * claude-sdk 侧 U0 已 live 证；messages-api 侧裸 key 端到端对照挂 Open Q 13——
 * 这里用 fixture 锁住 normalize 逻辑，保证语义等价。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENT_TYPES, type NormalizedEvent, type NormalizedEventType } from "../../src/agents/event-types.ts";
import { normalizeSdkMessage } from "../../src/agents/runtimes/claude-sdk.ts";
import {
  normalizeMessagesApiEvent,
  makeToolResultEvent,
} from "../../src/agents/runtimes/messages-api.ts";

function typesOf(events: NormalizedEvent[]): Set<NormalizedEventType> {
  return new Set(events.map((e) => e.type));
}

// ── claude-sdk fixtures（SDK 消息形态）──
const SDK_MSGS: any[] = [
  { type: "system", subtype: "init", model: "claude-opus-4-8", apiKeySource: "oauth" },
  { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "a" } } },
  { type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "t" } } },
  { type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", id: "tu1", name: "Bash" } } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", is_error: false }] } },
  { type: "stream_event", event: { type: "message_delta", usage: { input_tokens: 10, output_tokens: 5 } } },
  { type: "result", subtype: "success", usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.01 },
];

// ── messages-api fixtures（Anthropic 原始 SSE 形态）──
const MA_EVENTS: any[] = [
  { type: "message_start", message: { model: "claude-opus-4-8", usage: { input_tokens: 10, output_tokens: 0 } } },
  { type: "content_block_start", content_block: { type: "tool_use", id: "tu1", name: "Bash" } },
  { type: "content_block_delta", delta: { type: "text_delta", text: "a" } },
  { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "t" } },
  { type: "message_delta", usage: { input_tokens: 10, output_tokens: 5 } },
  { type: "message_stop" },
];

test("claude-sdk fixtures → 6 类事件全覆盖", () => {
  const events = SDK_MSGS.flatMap(normalizeSdkMessage);
  const types = typesOf(events);
  for (const t of EVENT_TYPES) assert.ok(types.has(t), `claude-sdk 缺 ${t}`);
});

test("messages-api fixtures(+tool_result) → 6 类事件全覆盖", () => {
  const events = MA_EVENTS.flatMap(normalizeMessagesApiEvent);
  // tool_result 由 run 的 loop 执行工具后发出（API 流本身不含）
  events.push(makeToolResultEvent("tu1", false));
  const types = typesOf(events);
  for (const t of EVENT_TYPES) assert.ok(types.has(t), `messages-api 缺 ${t}`);
});

test("语义等价：两 runtime 覆盖相同的事件类型集合", () => {
  const sdk = typesOf(SDK_MSGS.flatMap(normalizeSdkMessage));
  const ma = typesOf([...MA_EVENTS.flatMap(normalizeMessagesApiEvent), makeToolResultEvent("tu1", false)]);
  assert.deepEqual([...sdk].sort(), [...ma].sort());
});

test("两 runtime 最终态都是 completed", () => {
  const sdkLast = SDK_MSGS.flatMap(normalizeSdkMessage).filter((e) => e.type === "status").at(-1);
  const maLast = MA_EVENTS.flatMap(normalizeMessagesApiEvent).filter((e) => e.type === "status").at(-1);
  assert.equal(sdkLast?.type === "status" && sdkLast.phase, "completed");
  assert.equal(maLast?.type === "status" && maLast.phase, "completed");
});
