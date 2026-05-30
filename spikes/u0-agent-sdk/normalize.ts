/**
 * U0 spike — ClaudeSDKClient → 6 类归一化事件映射（KTD-17 最承重假设）。
 *
 * 这是生产 `apps/api/src/agents/event-types.ts` + `runtimes/claude-sdk.ts` 的原型。
 * 设计要点：normalize 是「逐条 SDK 消息 → 0..N 个归一化事件」的纯函数，
 * 这样 live 流和 fixture 喂同一函数，映射即代码、可回归。
 *
 * 6 类归一化事件契约（Boule 自有，非照搬 OD）：
 *   text_delta / thinking_delta / tool_use / tool_result / usage / status
 */

export type NormalizedEventType =
  | "text_delta"
  | "thinking_delta"
  | "tool_use"
  | "tool_result"
  | "usage"
  | "status";

export type NormalizedEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_use"; id: string; name: string }
  | { type: "tool_result"; toolUseId: string; isError: boolean }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
    }
  | {
      type: "status";
      phase: "started" | "completed" | "failed";
      detail?: Record<string, unknown>;
    };

/** 记录每类归一化事件的 SDK 来源（U0 退出条件：任一事件无 SDK 来源则 fail-stop）。 */
export type Provenance = Record<NormalizedEventType, Set<string>>;

export function emptyProvenance(): Provenance {
  return {
    text_delta: new Set(),
    thinking_delta: new Set(),
    tool_use: new Set(),
    tool_result: new Set(),
    usage: new Set(),
    status: new Set(),
  };
}

/**
 * 逐条 SDK 消息归一。`prov` 可选：传入则记录「哪种 SDK 消息形态产了哪类事件」。
 * 防御式取字段——SDK 消息形态随版本演进，缺字段不抛错。
 */
export function normalizeSdkMessage(
  msg: any,
  prov?: Provenance,
): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];
  const mark = (t: NormalizedEventType, source: string) => {
    if (prov) prov[t].add(source);
  };

  switch (msg?.type) {
    case "system": {
      if (msg.subtype === "init") {
        out.push({
          type: "status",
          phase: "started",
          detail: {
            model: msg.model,
            apiKeySource: msg.apiKeySource,
            toolCount: Array.isArray(msg.tools) ? msg.tools.length : 0,
          },
        });
        mark("status", "system/init");
      }
      break;
    }

    case "stream_event": {
      const ev = msg.event;
      if (ev?.type === "content_block_start" && ev.content_block?.type === "tool_use") {
        out.push({ type: "tool_use", id: ev.content_block.id, name: ev.content_block.name });
        mark("tool_use", "stream_event/content_block_start.tool_use");
      } else if (ev?.type === "content_block_delta") {
        const d = ev.delta;
        if (d?.type === "text_delta") {
          out.push({ type: "text_delta", text: d.text ?? "" });
          mark("text_delta", "stream_event/content_block_delta.text_delta");
        } else if (d?.type === "thinking_delta") {
          out.push({ type: "thinking_delta", text: d.thinking ?? "" });
          mark("thinking_delta", "stream_event/content_block_delta.thinking_delta");
        }
      } else if (ev?.type === "message_delta" && ev.usage) {
        out.push({
          type: "usage",
          inputTokens: ev.usage.input_tokens ?? 0,
          outputTokens: ev.usage.output_tokens ?? 0,
          cacheReadTokens: ev.usage.cache_read_input_tokens ?? 0,
        });
        mark("usage", "stream_event/message_delta.usage");
      }
      break;
    }

    case "assistant": {
      const content = msg.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === "tool_use") {
            out.push({ type: "tool_use", id: block.id, name: block.name });
            mark("tool_use", "assistant/message.content.tool_use");
          } else if (block?.type === "text" && typeof block.text === "string") {
            // 非 partial 路径：整段文本也归一成 text_delta（语义等价）
            out.push({ type: "text_delta", text: block.text });
            mark("text_delta", "assistant/message.content.text");
          }
        }
      }
      break;
    }

    case "user": {
      const content = msg.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === "tool_result") {
            out.push({
              type: "tool_result",
              toolUseId: block.tool_use_id,
              isError: Boolean(block.is_error),
            });
            mark("tool_result", "user/message.content.tool_result");
          }
        }
      }
      break;
    }

    case "result": {
      if (msg.usage) {
        out.push({
          type: "usage",
          inputTokens: msg.usage.input_tokens ?? 0,
          outputTokens: msg.usage.output_tokens ?? 0,
          cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
        });
        mark("usage", "result.usage");
      }
      out.push({
        type: "status",
        phase: msg.subtype === "success" ? "completed" : "failed",
        detail: {
          subtype: msg.subtype,
          totalCostUsd: msg.total_cost_usd,
          numTurns: msg.num_turns,
        },
      });
      mark("status", "result");
      break;
    }
  }

  return out;
}

/** U0 退出条件判定：6 类事件是否都有至少一个 SDK 来源。 */
export function provenanceComplete(prov: Provenance): {
  complete: boolean;
  missing: NormalizedEventType[];
} {
  const missing = (Object.keys(prov) as NormalizedEventType[]).filter(
    (t) => prov[t].size === 0,
  );
  return { complete: missing.length === 0, missing };
}
