/**
 * 设置总览（只读）：当前登录用户即配置管理员。
 *
 * 不暴露密钥；模型调用方式由服务端环境决定，Web 首版不提供 CLI/API 切换。
 */

import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.ts";
import { config } from "../config.ts";
import { publicSearchSettings } from "../services/search-providers.ts";
import { makeAuthenticate, rejectApiKeyAuth } from "../middleware/auth.ts";


export function registerSettingsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const authenticate = makeAuthenticate(deps.db);

  app.get("/api/settings/runtime", { preHandler: [authenticate, rejectApiKeyAuth] }, async () => {
    return {
      mode: config.mode,
      claudeOnly: true,
      agent: {
        model: config.agent.model,
        runtime: "claude-agent-sdk",
        invocationMode: "server-managed",
        cliOrApiSelectableByUser: false,
        researcherMaxTurns: config.agent.researcherMaxTurns,
        reasoningMaxTurns: config.agent.reasoningMaxTurns,
        watchdogMs: config.agent.watchdogMs,
      },
      search: publicSearchSettings(),
      cli: {
        mcpCommand: "boule mcp",
        submitExample: "boule submit --workflow <workflowId> --type research --file research.md",
      },
      apiKeys: {
        auth: "Bearer bk_...",
        management: "Web 会话创建；明文只在创建时回显一次",
      },
    };
  });
}
