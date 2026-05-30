/**
 * 日志脱敏（U3）。所有结构化日志发出前抹掉密钥模式。
 *
 * 13 个并发 verifier 时 API key 在多进程内存，stdout/stderr 未脱敏即泄露。
 * key 绝不进 BullMQ job payload / DB；这是发出端的最后一道防线。
 */

const REDACTED = "«REDACTED»";

/** 已知密钥模式。新增凭据类型时在此补充。 */
const PATTERNS: { re: RegExp; replace: string }[] = [
  // Anthropic key
  { re: /sk-ant-[A-Za-z0-9_-]{10,}/g, replace: REDACTED },
  // GitHub PAT（classic ghp_ / fine-grained github_pat_）
  { re: /\bghp_[A-Za-z0-9]{20,}/g, replace: REDACTED },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, replace: REDACTED },
  // Bearer 头
  { re: /(Bearer\s+)[A-Za-z0-9._-]{12,}/gi, replace: `$1${REDACTED}` },
  // JWT（三段 base64url）
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replace: REDACTED },
];

/** 敏感字段名（结构化对象里整值抹掉，不管值长啥样）。 */
const SENSITIVE_KEYS = /^(anthropic_api_key|api_?key|github_token|token|password|secret|authorization|jwt|refresh_token|access_token)$/i;

export function scrubString(input: string): string {
  let out = input;
  for (const { re, replace } of PATTERNS) out = out.replace(re, replace);
  return out;
}

/** 递归脱敏结构化对象：敏感键整值抹掉，字符串值过模式。返回新对象（不改原）。 */
export function scrub(value: unknown): unknown {
  if (typeof value === "string") return scrubString(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? REDACTED : scrub(v);
    }
    return out;
  }
  return value;
}
