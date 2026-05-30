/**
 * U0 spike — 6 类归一化事件的 canonical SDK 消息 fixture。
 * 形态取自 @anthropic-ai/claude-agent-sdk 0.3.158 的 sdk.d.ts。
 *
 * 用途：把 fixture 喂同一个 normalizeSdkMessage，证明每类事件的 parse 是真代码。
 * live run 覆盖到的更强；rare 事件（thinking_delta / tool_*）由 fixture 兜底证明映射成立。
 * 这是生产 runtime-contract 测试（U3 tests/agents/runtime-contract.test.ts）的雏形。
 */

export const SDK_FIXTURES: { label: string; msg: any }[] = [
  {
    label: "system/init → status(started)",
    msg: {
      type: "system",
      subtype: "init",
      model: "claude-opus-4-8",
      apiKeySource: "oauth",
      tools: ["WebSearch", "Read"],
    },
  },
  {
    label: "stream_event text_delta → text_delta",
    msg: {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "axis-1: 定价锚点" },
      },
    },
  },
  {
    label: "stream_event thinking_delta → thinking_delta",
    msg: {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "先确定 mode 再分解 axis…" },
      },
    },
  },
  {
    label: "stream_event content_block_start tool_use → tool_use",
    msg: {
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "toolu_01ABC", name: "WebSearch" },
      },
    },
  },
  {
    label: "user tool_result → tool_result",
    msg: {
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_01ABC", is_error: false, content: "…" },
        ],
      },
    },
  },
  {
    label: "stream_event message_delta.usage → usage",
    msg: {
      type: "stream_event",
      event: {
        type: "message_delta",
        delta: {},
        usage: { input_tokens: 1200, output_tokens: 340, cache_read_input_tokens: 800 },
      },
    },
  },
  {
    label: "result success → usage + status(completed)",
    msg: {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "axis-1 …\naxis-2 …\naxis-3 …",
      num_turns: 2,
      total_cost_usd: 0.0123,
      usage: { input_tokens: 1500, output_tokens: 400, cache_read_input_tokens: 800 },
    },
  },
];
