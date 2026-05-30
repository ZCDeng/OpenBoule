/**
 * U0 spike — 结构化失败分类器原型（KTD-17 / 全局规则 Fail loud）。
 * 生产对应：apps/api/src/agents/errors.ts
 *
 * 兜底派生链：显式 code → SDK error 枚举 → SIGNAL → EXIT_<n> → TERMINATED_UNKNOWN
 * 分类顺序：先判 auth 再判 rate，避免 401 被误判成 5xx（OD 真实坑）。
 * 这些结构化码决定何时从 claude-sdk 降级到 messages-api。
 */

export type AgentErrorCode =
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "BILLING_ERROR"
  | "UPSTREAM_5XX"
  | "INVALID_REQUEST"
  | "MAX_TURNS"
  | "MAX_BUDGET"
  | "TERMINATED_UNKNOWN";

/** SDK result/assistant 上报的 error 枚举 → 结构化码（先 auth 再 rate）。 */
function fromSdkErrorEnum(e: string | undefined): AgentErrorCode | undefined {
  switch (e) {
    case "authentication_failed":
    case "oauth_org_not_allowed":
      return "AUTH_FAILED";
    case "rate_limit":
      return "RATE_LIMITED";
    case "billing_error":
      return "BILLING_ERROR";
    case "server_error":
      return "UPSTREAM_5XX";
    case "invalid_request":
    case "model_not_found":
      return "INVALID_REQUEST";
    case "max_output_tokens":
      return "MAX_BUDGET";
    default:
      return undefined;
  }
}

/** result 消息 subtype → 结构化码。 */
function fromResultSubtype(subtype: string | undefined): AgentErrorCode | undefined {
  switch (subtype) {
    case "error_max_turns":
      return "MAX_TURNS";
    case "error_max_budget_usd":
      return "MAX_BUDGET";
    case "error_during_execution":
    case "error_max_structured_output_retries":
      return "TERMINATED_UNKNOWN";
    default:
      return undefined;
  }
}

/** 自由文本（stderr / exception message）分类——顺序即正确性：auth 在 rate 前。 */
function fromText(text: string): AgentErrorCode {
  const t = text.toLowerCase();
  if (/401|unauthor|authentication|invalid api key|oauth/.test(t)) return "AUTH_FAILED";
  if (/429|rate.?limit|too many requests/.test(t)) return "RATE_LIMITED";
  if (/402|billing|credit|quota exceeded/.test(t)) return "BILLING_ERROR";
  if (/5\d\d|server error|overloaded|upstream/.test(t)) return "UPSTREAM_5XX";
  if (/400|invalid request|bad request/.test(t)) return "INVALID_REQUEST";
  return "TERMINATED_UNKNOWN";
}

export function classifyError(input: any): AgentErrorCode {
  // 1) SDK 消息对象
  if (input && typeof input === "object" && input.type === "result") {
    return (
      fromSdkErrorEnum(input.error) ??
      fromResultSubtype(input.subtype) ??
      (Array.isArray(input.errors) && input.errors.length
        ? fromText(input.errors.join(" "))
        : "TERMINATED_UNKNOWN")
    );
  }
  if (input && typeof input === "object" && typeof input.error === "string") {
    const mapped = fromSdkErrorEnum(input.error);
    if (mapped) return mapped;
  }
  // 2) 异常对象 / 字符串
  const text =
    input instanceof Error
      ? `${input.message} ${(input as any).stderr ?? ""}`
      : typeof input === "string"
        ? input
        : JSON.stringify(input ?? {});
  return fromText(text);
}
