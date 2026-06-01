/**
 * 设置总览（只读）：当前登录用户即配置管理员。
 *
 * 不暴露密钥；模型调用方式由服务端环境决定，Web 首版不提供 CLI/API 切换。
 */

import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.ts";
import { config } from "../config.ts";
import { makeAuthenticate, rejectApiKeyAuth } from "../middleware/auth.ts";

const ADITLY_TOOLS = ["anspire_web_search", "bocha_web_search", "jina_read_url", "reach_read_url"];

export function registerSettingsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const authenticate = makeAuthenticate(deps.db);

  app.get("/api/settings/runtime", { preHandler: [authenticate, rejectApiKeyAuth] }, async () => {
    const aditlyUrl = config.agent.aditlyMcpUrl.trim();
    const aditlyEnabled = aditlyUrl !== "" && aditlyUrl.toLowerCase() !== "off";
    return {
      mode: config.mode,
      agent: {
        model: config.agent.model,
        runtime: "claude-agent-sdk",
        invocationMode: "server-managed",
        cliOrApiSelectableByUser: false,
        researcherMaxTurns: config.agent.researcherMaxTurns,
        reasoningMaxTurns: config.agent.reasoningMaxTurns,
        watchdogMs: config.agent.watchdogMs,
      },
      search: {
        provider: "Aditly MCP",
        enabled: aditlyEnabled,
        url: aditlyEnabled ? aditlyUrl : null,
        tools: aditlyEnabled ? ADITLY_TOOLS : [],
        disabledBehavior: "researcher 继续运行，但产出必须显式标注未联网检索",
      },
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
