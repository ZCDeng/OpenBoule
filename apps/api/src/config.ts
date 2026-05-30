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
} as const;
