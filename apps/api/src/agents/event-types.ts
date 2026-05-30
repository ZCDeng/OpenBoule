/**
 * 6 类归一化事件契约（U3 / KTD-17）。Boule 自有设计。
 *
 * 抽象边界划在"产出归一化事件流"：无论底层是 ClaudeSDKClient(query) 还是 Messages API，
 * 都归一成这 6 类。executor / hooks / 记账 / SSE / 落库 / 超时只消费本契约，只写一遍。
 *
 * 两 runtime 只保证「经归一化后语义等价」（最终态一致 + 关键事件类型齐全），
 * 不要求逐字节相同序列（底层流分块不同）。U0 spike1 已证 claude-sdk 侧映射成立。
 */

export type NormalizedEventType =
  | "text_delta"
  | "thinking_delta"
  | "tool_use"
  | "tool_result"
  | "usage"
  | "status";

export const EVENT_TYPES: readonly NormalizedEventType[] = [
  "text_delta",
  "thinking_delta",
  "tool_use",
  "tool_result",
  "usage",
  "status",
] as const;

export type NormalizedEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_use"; id: string; name: string }
  | { type: "tool_result"; toolUseId: string; isError: boolean }
  | { type: "usage"; inputTokens: number; outputTokens: number; cacheReadTokens: number }
  | {
      type: "status";
      phase: "started" | "completed" | "failed";
      detail?: Record<string, unknown>;
    };

/** 空计数器。 */
export function emptyCounts(): Record<NormalizedEventType, number> {
  return {
    text_delta: 0,
    thinking_delta: 0,
    tool_use: 0,
    tool_result: 0,
    usage: 0,
    status: 0,
  };
}
