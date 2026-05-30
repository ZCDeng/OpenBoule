/**
 * messages-api runtime（U3 / KTD-17 fallback）。
 * 直接 fetch Anthropic `/v1/messages`（stream），自跑**有界 tool loop**，吐**同一** 6 类事件。
 *
 * 为什么有界：BYOK 路径必须自己防 tool-loop 失控（参考 OD `MAX_BYOK_TOOL_LOOPS`）。
 *
 * ⚠️ 验证状态（Open Q 13）：本 runtime 走裸 ANTHROPIC_API_KEY，U0/U3 未用真 key live 对照。
 * normalize 逻辑由 fixture 锁（runtime-contract.test），与 claude-sdk 语义等价；
 * run() 的真 key 端到端对照待有 key 时补（plan Open Q 13）。
 * 工具真实执行（BYOK 自实现 WebSearch 等）也是后续工作——默认 toolExecutor 返回 is_error。
 */

import type { NormalizedEvent } from "../event-types.ts";
import type { BouleRoleRuntime } from "../runtime.ts";
import type { RoleContext, RuntimeKind } from "../types.ts";

export const MAX_BYOK_TOOL_LOOPS = 10;
const ANTHROPIC_VERSION = "2023-06-01";

export function requireAnthropicKey(): string {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k || k.trim() === "") {
    throw new Error("缺少 ANTHROPIC_API_KEY：messages-api runtime 需裸 key（worker 启动载入，不入 job payload/DB）");
  }
  return k.trim();
}

/** 工具执行器（注入）。默认未实现——BYOK 自建工具是后续工作。 */
export type ToolExecutor = (name: string, input: unknown) => Promise<{ content: string; isError: boolean }>;
const defaultToolExecutor: ToolExecutor = async (name) => ({
  content: `tool '${name}' 在 messages-api fallback v1 未实现`,
  isError: true,
});

/** 构造 tool_result 归一化事件（loop 执行工具后发出；API 流本身不含 tool_result）。 */
export function makeToolResultEvent(toolUseId: string, isError: boolean): NormalizedEvent {
  return { type: "tool_result", toolUseId, isError };
}

/**
 * 逐条 Anthropic 原始 SSE 事件 → 0..N 归一化事件（纯函数，供 fixture 测试）。
 * 覆盖 5 类（text/thinking/tool_use/usage/status）；tool_result 由 run 的 loop 发出。
 */
export function normalizeMessagesApiEvent(ev: any): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];
  switch (ev?.type) {
    case "message_start":
      out.push({ type: "status", phase: "started", detail: { model: ev.message?.model } });
      if (ev.message?.usage)
        out.push({
          type: "usage",
          inputTokens: ev.message.usage.input_tokens ?? 0,
          outputTokens: ev.message.usage.output_tokens ?? 0,
          cacheReadTokens: ev.message.usage.cache_read_input_tokens ?? 0,
        });
      break;
    case "content_block_start":
      if (ev.content_block?.type === "tool_use")
        out.push({ type: "tool_use", id: ev.content_block.id, name: ev.content_block.name });
      break;
    case "content_block_delta": {
      const d = ev.delta;
      if (d?.type === "text_delta") out.push({ type: "text_delta", text: d.text ?? "" });
      else if (d?.type === "thinking_delta") out.push({ type: "thinking_delta", text: d.thinking ?? "" });
      break;
    }
    case "message_delta":
      if (ev.usage)
        out.push({
          type: "usage",
          inputTokens: ev.usage.input_tokens ?? 0,
          outputTokens: ev.usage.output_tokens ?? 0,
          cacheReadTokens: ev.usage.cache_read_input_tokens ?? 0,
        });
      break;
    case "message_stop":
      out.push({ type: "status", phase: "completed" });
      break;
  }
  return out;
}

/** 解析 SSE 文本块的 `data:` 行为 JSON 事件。 */
function* parseSse(chunk: string): Generator<any> {
  for (const line of chunk.split("\n")) {
    const m = line.match(/^data:\s*(.+)$/);
    if (!m) continue;
    const payload = m[1]!.trim();
    if (payload === "[DONE]") continue;
    try {
      yield JSON.parse(payload);
    } catch {
      /* 跨分块半行——简化处理：丢弃（生产应缓冲拼接，U3 标注） */
    }
  }
}

export class MessagesApiRuntime implements BouleRoleRuntime {
  readonly kind: RuntimeKind = "messages-api";
  private readonly toolExecutor: ToolExecutor;
  // 注：Node strip-only 模式不支持参数属性（constructor(private x)），故显式赋值。
  constructor(toolExecutor: ToolExecutor = defaultToolExecutor) {
    this.toolExecutor = toolExecutor;
  }

  async *run(ctx: RoleContext): AsyncIterable<NormalizedEvent> {
    const key = requireAnthropicKey();
    const messages: { role: string; content: unknown }[] = [{ role: "user", content: ctx.task }];

    for (let loop = 0; loop < MAX_BYOK_TOOL_LOOPS; loop++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: ctx.model,
          max_tokens: 4096,
          system: ctx.systemPrompt,
          messages,
          stream: true,
          ...(ctx.allowedTools?.length ? { tools: ctx.allowedTools.map((name) => ({ name })) } : {}),
        }),
      });
      if (!res.ok || !res.body) {
        yield { type: "status", phase: "failed", detail: { status: res.status } };
        return;
      }

      const decoder = new TextDecoder();
      const toolUses: { id: string; name: string }[] = [];
      let stopReason: string | undefined;
      for await (const part of res.body as any) {
        for (const ev of parseSse(decoder.decode(part, { stream: true }))) {
          for (const n of normalizeMessagesApiEvent(ev)) {
            if (n.type !== "status" || n.phase !== "completed") yield n; // completed 留到 loop 结束统一发
            if (n.type === "tool_use") toolUses.push({ id: n.id, name: n.name });
          }
          if (ev?.type === "message_delta") stopReason = ev.delta?.stop_reason;
        }
      }

      if (stopReason !== "tool_use" || toolUses.length === 0) {
        yield { type: "status", phase: "completed", detail: { stopReason, loops: loop + 1 } };
        return;
      }

      // 执行工具 → 回填 tool_result，继续 loop
      const toolResults: unknown[] = [];
      for (const tu of toolUses) {
        const r = await this.toolExecutor(tu.name, {});
        yield makeToolResultEvent(tu.id, r.isError);
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: r.content, is_error: r.isError });
      }
      messages.push({ role: "assistant", content: toolUses.map((t) => ({ type: "tool_use", ...t, input: {} })) });
      messages.push({ role: "user", content: toolResults });
    }

    // 触上界：fail loud，不假装成功
    yield { type: "status", phase: "failed", detail: { reason: "MAX_BYOK_TOOL_LOOPS" } };
  }
}
