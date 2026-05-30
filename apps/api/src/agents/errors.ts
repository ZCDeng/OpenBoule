/**
 * 结构化失败分类器（U3 / KTD-17 / 全局规则 Fail loud）。
 *
 * 兜底派生链：显式 code → SDK error 枚举 → result subtype → 文本分类 → TERMINATED_UNKNOWN。
 * 分类顺序固化：**先判 auth 再判 rate**，避免 401 被误判成 5xx（OD 真实坑，KTD-21 顺序即正确性）。
 * 这些码决定何时从 claude-sdk 降级到 messages-api。
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

/** 触发降级到 messages-api 的码（瞬态/上游问题，换后端可能好转）。 */
export const DEGRADE_CODES: ReadonlySet<AgentErrorCode> = new Set<AgentErrorCode>([
  "UPSTREAM_5XX",
  "RATE_LIMITED",
]);

export function shouldDegrade(code: AgentErrorCode | undefined): boolean {
  return code !== undefined && DEGRADE_CODES.has(code);
}

/** SDK 上报的 error 枚举 → 结构化码（先 auth 再 rate）。 */
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

/** 自由文本（stderr / exception / HTTP status）分类——顺序即正确性：auth 在 rate 前。 */
export function classifyErrorText(text: string): AgentErrorCode {
  const t = text.toLowerCase();
  if (/401|unauthor|authentication|invalid api key|oauth/.test(t)) return "AUTH_FAILED";
  if (/429|rate.?limit|too many requests/.test(t)) return "RATE_LIMITED";
  if (/402|billing|credit|quota exceeded|insufficient/.test(t)) return "BILLING_ERROR";
  if (/5\d\d|server error|overloaded|upstream/.test(t)) return "UPSTREAM_5XX";
  if (/400|invalid request|bad request/.test(t)) return "INVALID_REQUEST";
  return "TERMINATED_UNKNOWN";
}

export function classifyError(input: unknown): AgentErrorCode {
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    if (obj.type === "result") {
      return (
        fromSdkErrorEnum(obj.error as string | undefined) ??
        fromResultSubtype(obj.subtype as string | undefined) ??
        (Array.isArray(obj.errors) && obj.errors.length
          ? classifyErrorText((obj.errors as unknown[]).join(" "))
          : "TERMINATED_UNKNOWN")
      );
    }
    if (typeof obj.error === "string") {
      const mapped = fromSdkErrorEnum(obj.error);
      if (mapped) return mapped;
    }
    if (typeof obj.status === "number") {
      return classifyErrorText(String(obj.status));
    }
  }
  const text =
    input instanceof Error
      ? `${input.message} ${(input as { stderr?: string }).stderr ?? ""}`
      : typeof input === "string"
        ? input
        : JSON.stringify(input ?? {});
  return classifyErrorText(text);
}
