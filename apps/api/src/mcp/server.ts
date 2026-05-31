/**
 * Boule MCP stdio server（U1 / KTD-1, KTD-2）。
 *
 * 低层 Server + setRequestHandler——工具/资源用 JSON schema（不引 Zod）。零状态：所有 tools/resources
 * 都 thin fetch 到 Boule API（createBouleClient）。`boule mcp` 子命令或 `node src/mcp/server.ts` 起。
 *
 * 鉴权：BOULE_API_KEY（env 或 --api-key）走 Bearer。daemon 不可达时工具返回清晰错误（call() 已兜底）。
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createBouleClient, makeTools, type BouleClient } from "./tools.ts";
import { listResources, readResource, resourceTemplates } from "./resources.ts";

/** 装配 MCP Server（可注入 client，便于测试）。 */
export function buildMcpServer(client: BouleClient): Server {
  const server = new Server(
    { name: "boule", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
  );
  const tools = makeTools(client);
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = toolMap.get(req.params.name);
    if (!tool) {
      return { isError: true, content: [{ type: "text", text: `未知工具：${req.params.name}` }] };
    }
    try {
      const result = await tool.handler((req.params.arguments ?? {}) as Record<string, unknown>);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      // fail loud：把 API 错误（含 daemon 不可达）原样回给调用 agent，不静默吞。
      return { isError: true, content: [{ type: "text", text: (err as Error).message }] };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: listResources().map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    })),
  }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: resourceTemplates(),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    const text = await readResource(client, uri);
    if (text === null) throw new Error(`无法读取资源 URI：${uri}`);
    return { contents: [{ uri, mimeType: "application/json", text }] };
  });

  return server;
}

/** 入口：从 env/参数取配置，连 stdio transport。 */
export async function startMcpServer(opts: { apiKey?: string; baseUrl?: string } = {}): Promise<void> {
  const client = createBouleClient(opts);
  if (!client.apiKey) {
    // fail loud：无 key 直接拒，避免所有工具调用统一 401 让人困惑。
    process.stderr.write("[boule mcp] 缺少 API key：设 BOULE_API_KEY 或传 --api-key\n");
    process.exit(1);
  }
  const server = buildMcpServer(client);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`[boule mcp] stdio server 就绪 → ${client.baseUrl}\n`);
}

// 直接执行（node src/mcp/server.ts）时启动。被 import（测试/CLI 复用）时不自动启。
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const keyIdx = argv.indexOf("--api-key");
  const urlIdx = argv.indexOf("--daemon-url");
  void startMcpServer({
    apiKey: keyIdx >= 0 ? argv[keyIdx + 1] : undefined,
    baseUrl: urlIdx >= 0 ? argv[urlIdx + 1] : undefined,
  });
}
