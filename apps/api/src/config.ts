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

export const config = {
  nodeEnv: optional("NODE_ENV", "development"),
  apiPort: Number(optional("API_PORT", "3000")),

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
    watchdogMs: Number(optional("AGENT_WATCHDOG_MS", "300000")),
    // researcher 多步检索需更多回合；纯推理 role 回合少。
    researcherMaxTurns: Number(optional("AGENT_RESEARCHER_MAX_TURNS", "12")),
    reasoningMaxTurns: Number(optional("AGENT_REASONING_MAX_TURNS", "6")),
  },
} as const;
