/**
 * 环境配置收口（U1）。所有 env 读取经此处，缺失关键项 fail loud（不静默用默认值跑）。
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`缺少必需环境变量 ${name}（见 .env.example）`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : fallback;
}

function optionalSecret(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : null;
}

/** 数字 env，非有限数即 fail loud（避免 NaN 静默传到 setTimeout(NaN)→0 等隐患）。 */
function numeric(name: string, fallback: string): number {
  const n = Number(optional(name, fallback));
  if (!Number.isFinite(n)) {
    throw new Error(`环境变量 ${name} 必须是数字（当前 "${process.env[name]}"，见 .env.example）`);
  }
  return n;
}

function positiveInteger(name: string, fallback: string): number {
  const n = numeric(name, fallback);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`环境变量 ${name} 必须是正整数（当前 "${process.env[name]}"，见 .env.example）`);
  }
  return n;
}

function ratio(name: string, fallback: string): number {
  const n = numeric(name, fallback);
  if (n < 0 || n > 1) {
    throw new Error(`环境变量 ${name} 必须在 0..1 之间（当前 "${process.env[name]}"，见 .env.example）`);
  }
  return n;
}

function searchOrder(): ("aditly" | "anysearch")[] {
  const raw = optional("SEARCH_PROVIDER_ORDER", "aditly,anysearch");
  const out = raw.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const allowed = new Set(["aditly", "anysearch"]);
  const filtered = out.filter((x): x is "aditly" | "anysearch" => allowed.has(x));
  return filtered.length ? [...new Set(filtered)] : ["aditly", "anysearch"];
}

function publicHttpsUrl(name: string, fallback: string): string {
  const value = optional(name, fallback).trim();
  // 空串 / "off" 是有意禁用（关闭外部 provider），不是配置错误，直接放行。
  if (value === "" || value.toLowerCase() === "off") return value;
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`环境变量 ${name} 必须是 HTTPS URL 或 off`);
  let host = url.hostname.toLowerCase();
  // IPv6 字面量 new URL 会带方括号，剥掉再比对。
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  // SSRF 阻断名单：环回 / 全零 / 内网 / 链路本地（含云元数据 169.254）/ IPv6 ULA / link-local / IPv4-mapped。
  const blocked =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::" ||
    host === "::1" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host.startsWith("169.254.") || // 链路本地 + 云 metadata 端点
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host.startsWith("fc") || host.startsWith("fd") || // IPv6 ULA fc00::/7
    host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb") || // link-local fe80::/10
    host.startsWith("::ffff:"); // IPv4-mapped IPv6（绕过用）
  if (blocked) {
    throw new Error(`环境变量 ${name} 不允许指向环回或内网地址`);
  }
  return value;
}

export const config = {
  nodeEnv: optional("NODE_ENV", "development"),
  apiPort: Number(optional("API_PORT", "3000")),

  // 运行模式（U1 引入，U2 本地模式消费）：team = Postgres + JWT；local = SQLite + 免登录 + loopback-only。
  mode: optional("MODE", "team") === "local" ? "local" : "team",

  databaseUrl: required("DATABASE_URL"),

  // 自建 JWT（KTD-10）。secret 缺失即 fail loud——绝不用默认值签发可伪造的 token。
  jwt: {
    secret: optional("JWT_SECRET", ""),
    accessTtlSec: Number(optional("JWT_ACCESS_TTL_SEC", "900")), // 15min
    refreshTtlSec: Number(optional("JWT_REFRESH_TTL_SEC", "1209600")), // 14d
  },

  redis: {
    host: optional("REDIS_HOST", "localhost"),
    port: Number(optional("REDIS_PORT", "6379")),
    // KTD-19 隔离：BullMQ 与安全集（nonce/lock）分逻辑 DB
    bullmqDb: Number(optional("REDIS_BULLMQ_DB", "0")),
    securityDb: Number(optional("REDIS_SECURITY_DB", "1")),
  },

  truthSource: {
    repo: optional("TRUTH_SOURCE_REPO", "ZCDeng/consulting-team"),
    branch: optional("TRUTH_SOURCE_BRANCH", "main"),
  },

  // 组合根：role 执行用模型 + worker 身份。SDK auth 走 CLI 会话或 ANTHROPIC_API_KEY（KTD-2）。
  agent: {
    model: optional("AGENT_MODEL", "claude-opus-4-8"),
    workerId: optional("WORKER_ID", "boule-worker-1"),
    // 无事件 watchdog（ms）。120s 对联网 researcher 过紧（一次 web 抓取可能 >120s），默认调大到 300s。
    watchdogMs: numeric("AGENT_WATCHDOG_MS", "300000"),
    // researcher 多步检索需更多回合；纯推理 role 回合少。
    researcherMaxTurns: numeric("AGENT_RESEARCHER_MAX_TURNS", "12"),
    reasoningMaxTurns: numeric("AGENT_REASONING_MAX_TURNS", "6"),
  },

  references: {
    textMaxBytes: numeric("REFERENCE_TEXT_MAX_BYTES", "262144"),
    pdfMaxBytes: numeric("REFERENCE_PDF_MAX_BYTES", "31457280"),
    officeMaxBytes: numeric("REFERENCE_OFFICE_MAX_BYTES", "5242880"),
    projectMaxBytes: numeric("REFERENCE_PROJECT_MAX_BYTES", "104857600"),
    parseTimeoutMs: numeric("REFERENCE_PARSE_TIMEOUT_MS", "120000"),
    ocrLanguage: optional("BOULE_OCR_LANGUAGE", "chi_sim+eng"),
    tessdataPath: optional("TESSDATA_PREFIX", "/opt/tessdata"),
    ocrMaxPages: positiveInteger("BOULE_OCR_MAX_PAGES", "100"),
    ocrDpi: positiveInteger("BOULE_OCR_DPI", "200"),
    ocrConfidenceThreshold: ratio("BOULE_OCR_CONFIDENCE_THRESHOLD", "0.55"),
    storeOriginalConfidenceThreshold: ratio("BOULE_STORE_ORIGINAL_CONFIDENCE_THRESHOLD", "0.85"),
    ocrFallback: optional("BOULE_OCR_FALLBACK", optional("BOULE_ENABLE_CLAUDE_REFERENCE_OCR", "") === "1" ? "claude" : "none") === "claude" ? "claude" : "none",
  },

  search: {
    providerOrder: searchOrder(),
    // Aditly 自托管 MCP（兼容本机开发默认值）。设为 "off" 关闭 → researcher 降级 + fail-loud 标注。
    aditlyMcpUrl: optional("ADITLY_MCP_URL", "http://127.0.0.1:8643/mcp/"),
    // anysearch 是外部备用 provider：必须 HTTPS 且非内网/环回，key 只在服务端 env。
    anysearchMcpUrl: publicHttpsUrl("ANYSEARCH_MCP_URL", "off"),
    anysearchApiKey: optionalSecret("ANYSEARCH_API_KEY"),
    probeTimeoutMs: numeric("SEARCH_PROVIDER_PROBE_TIMEOUT_MS", "1500"),
  },
} as const;
