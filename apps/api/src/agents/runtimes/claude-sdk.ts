/**
 * claude-sdk runtime（U3 / KTD-17）。按需 spawn `query()`，把 SDK 流归一成 6 类事件。
 * U0 spike1 已 live 证明本映射（5 类 live + thinking_delta fixture）。
 *
 * 注：TS SDK 入口是 `query({ options: { includePartialMessages: true } })`（非 Python 的
 * ClaudeSDKClient 类）；includePartialMessages 是出 text_delta/thinking_delta 的必要开关。
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { NormalizedEvent } from "../event-types.ts";
import type { BouleRoleRuntime } from "../runtime.ts";
import type { RoleContext, RuntimeKind } from "../types.ts";

/** 逐条 SDK 消息 → 0..N 个归一化事件（纯函数，供 live 流与 fixture 共用）。 */
export function normalizeSdkMessage(msg: any): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];
  switch (msg?.type) {
    case "system":
      if (msg.subtype === "init") {
        out.push({
          type: "status",
          phase: "started",
          detail: { model: msg.model, apiKeySource: msg.apiKeySource },
        });
      }
      break;
    case "stream_event": {
      const ev = msg.event;
      if (ev?.type === "content_block_start" && ev.content_block?.type === "tool_use") {
        out.push({ type: "tool_use", id: ev.content_block.id, name: ev.content_block.name });
      } else if (ev?.type === "content_block_delta") {
        const d = ev.delta;
        if (d?.type === "text_delta") out.push({ type: "text_delta", text: d.text ?? "" });
        else if (d?.type === "thinking_delta")
          out.push({ type: "thinking_delta", text: d.thinking ?? "" });
      } else if (ev?.type === "message_delta" && ev.usage) {
        out.push({
          type: "usage",
          inputTokens: ev.usage.input_tokens ?? 0,
          outputTokens: ev.usage.output_tokens ?? 0,
          cacheReadTokens: ev.usage.cache_read_input_tokens ?? 0,
        });
      }
      break;
    }
    case "assistant":
      for (const block of msg.message?.content ?? []) {
        if (block?.type === "tool_use") out.push({ type: "tool_use", id: block.id, name: block.name });
        else if (block?.type === "text" && typeof block.text === "string")
          out.push({ type: "text_delta", text: block.text });
      }
      break;
    case "user":
      for (const block of msg.message?.content ?? []) {
        if (block?.type === "tool_result")
          out.push({ type: "tool_result", toolUseId: block.tool_use_id, isError: Boolean(block.is_error) });
      }
      break;
    case "result":
      if (msg.usage)
        out.push({
          type: "usage",
          inputTokens: msg.usage.input_tokens ?? 0,
          outputTokens: msg.usage.output_tokens ?? 0,
          cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
        });
      out.push({
        type: "status",
        phase: msg.subtype === "success" ? "completed" : "failed",
        detail: { subtype: msg.subtype, totalCostUsd: msg.total_cost_usd, errorEnum: msg.error },
      });
      break;
  }
  return out;
}

/** `query` 的最小签名（便于注入 spy 单测 options 透传，仿 executor 注入 runtimeImpl）。 */
export type QueryFn = (args: { prompt: unknown; options: unknown }) => AsyncIterable<unknown>;

export class ClaudeSdkRuntime implements BouleRoleRuntime {
  readonly kind: RuntimeKind = "claude-sdk";
  private readonly queryImpl: QueryFn;

  /** 默认用 SDK 的 query；测试可注入 spy。 */
  constructor(queryImpl?: QueryFn) {
    this.queryImpl = queryImpl ?? (query as unknown as QueryFn);
  }

  async *run(ctx: RoleContext): AsyncIterable<NormalizedEvent> {
    const response = this.queryImpl({
      prompt: ctx.task,
      options: {
        systemPrompt: ctx.systemPrompt,
        allowedTools: ctx.allowedTools ?? [],
        // allowedTools 默认=全部工具；纯推理 role 靠 disallowedTools 显式禁文件系统工具（KTD-3/R-2）
        ...(ctx.disallowedTools && ctx.disallowedTools.length > 0 ? { disallowedTools: ctx.disallowedTools } : {}),
        // MCP server 注入（U4：researcher 接 Aditly web 工具网关；mcp__<server>__<tool>）
        ...(ctx.mcpServers ? { mcpServers: ctx.mcpServers } : {}),
        includePartialMessages: true,
        maxTurns: ctx.maxTurns ?? 6,
        permissionMode: ctx.allowToolExecution ? "bypassPermissions" : "default",
        ...(ctx.allowToolExecution ? { allowDangerouslySkipPermissions: true } : {}),
      } as any,
    });
    for await (const msg of response) {
      for (const ev of normalizeSdkMessage(msg)) yield ev;
    }
  }
}
