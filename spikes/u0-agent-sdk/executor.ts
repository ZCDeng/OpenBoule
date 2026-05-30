/**
 * U0 spike — Agent SDK headless 执行器原型。
 * 生产对应：apps/api/src/agents/runtimes/claude-sdk.ts（按需 spawn）
 *           + apps/api/src/agents/executor.ts（消费归一化事件流，记账/超时/落库）
 *
 * 这里只做 spike 要验的最小闭环：
 *   spawn ClaudeSDKClient(query) → 迭代 SDK 流 → normalize 成 6 类事件
 *   → 收 usage / finalText / tool 声明 / 结构化 error code，按 jobId 归账。
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  emptyProvenance,
  normalizeSdkMessage,
  type NormalizedEvent,
  type NormalizedEventType,
  type Provenance,
} from "./normalize.ts";
import { classifyError } from "./errors.ts";

export interface RoleContext {
  jobId: string;
  systemPrompt: string; // role .md 内容当 system prompt（真值源快照里读，见 spike3）
  task: string;
  allowedTools?: string[];
  maxTurns?: number;
  /** true 时允许 agent 真的调工具（bypassPermissions），用于 live 验 tool_use/tool_result */
  allowToolExecution?: boolean;
}

export interface RoleResult {
  jobId: string;
  ok: boolean;
  finalText: string;
  events: NormalizedEvent[];
  counts: Record<NormalizedEventType, number>;
  provenance: Provenance;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  totalCostUsd: number;
  apiKeySource?: string;
  model?: string;
  toolsDeclared: string[];
  errorCode?: string;
}

export async function runRole(ctx: RoleContext): Promise<RoleResult> {
  const provenance = emptyProvenance();
  const events: NormalizedEvent[] = [];
  const counts: Record<NormalizedEventType, number> = {
    text_delta: 0,
    thinking_delta: 0,
    tool_use: 0,
    tool_result: 0,
    usage: 0,
    status: 0,
  };
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  let finalText = "";
  let totalCostUsd = 0;
  let apiKeySource: string | undefined;
  let model: string | undefined;
  let ok = false;
  let errorCode: string | undefined;

  try {
    const response = query({
      prompt: ctx.task,
      options: {
        systemPrompt: ctx.systemPrompt, // 自定义 system prompt = role 即真值源
        allowedTools: ctx.allowedTools ?? [],
        includePartialMessages: true, // 必须开，才有 text_delta / thinking_delta
        maxTurns: ctx.maxTurns ?? 6,
        permissionMode: ctx.allowToolExecution ? "bypassPermissions" : "default",
        ...(ctx.allowToolExecution ? { allowDangerouslySkipPermissions: true } : {}),
      } as any,
    });

    for await (const msg of response) {
      // 记账：init 报 apiKeySource / model；result(success) 取 finalText
      if (msg.type === "system" && (msg as any).subtype === "init") {
        apiKeySource = (msg as any).apiKeySource;
        model = (msg as any).model;
      }
      if (msg.type === "result") {
        if ((msg as any).subtype === "success") {
          finalText = (msg as any).result ?? "";
          ok = true;
        } else {
          errorCode = classifyError(msg);
        }
        totalCostUsd = (msg as any).total_cost_usd ?? 0;
      }

      for (const ev of normalizeSdkMessage(msg, provenance)) {
        events.push(ev);
        counts[ev.type]++;
        if (ev.type === "usage") {
          // 取最大值归账（message_delta 是增量快照，result 是终值）
          usage.inputTokens = Math.max(usage.inputTokens, ev.inputTokens);
          usage.outputTokens = Math.max(usage.outputTokens, ev.outputTokens);
          usage.cacheReadTokens = Math.max(usage.cacheReadTokens, ev.cacheReadTokens);
        }
      }
    }
  } catch (err) {
    errorCode = classifyError(err);
    ok = false;
  }

  return {
    jobId: ctx.jobId,
    ok,
    finalText,
    events,
    counts,
    provenance,
    usage,
    totalCostUsd,
    apiKeySource,
    model,
    toolsDeclared: ctx.allowedTools ?? [],
    errorCode,
  };
}
