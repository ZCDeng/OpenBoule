/**
 * Agent 执行器类型（U3）。
 */

import type { NormalizedEvent, NormalizedEventType } from "./event-types.ts";
import type { AgentErrorCode } from "./errors.ts";

export type RuntimeKind = "claude-sdk" | "messages-api";

/** 一次 role 执行的输入。runtime 无关——两 runtime 各自映射 allowedTools 等。 */
export interface RoleContext {
  jobId: string;
  role: string;
  /** role .md 内容当 system prompt（从 truth snapshot 读，见 U2 loader）。 */
  systemPrompt: string;
  task: string;
  model: string;
  allowedTools?: string[];
  /** 显式拒绝表（U3 web 策略：纯推理 role 禁文件系统工具，止 sandbox 空转）。 */
  disallowedTools?: string[];
  /** MCP server 配置（U4：researcher 接 Aditly web 工具网关）。形如 { aditly: { type:"http", url } }。 */
  mcpServers?: Record<string, unknown>;
  maxTurns?: number;
  /** 是否允许真实执行工具（live 验 tool_use/tool_result；生产由 phase 配置决定）。 */
  allowToolExecution?: boolean;
}

/** 一次 role 执行的归一化结果（executor 消费事件流后汇总）。 */
export interface RoleResult {
  jobId: string;
  runtime: RuntimeKind;
  ok: boolean;
  finalText: string;
  counts: Record<NormalizedEventType, number>;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  errorCode?: AgentErrorCode;
}

export type { NormalizedEvent };
