#!/usr/bin/env node
/**
 * Boule Thin CLI 入口（U3 / KTD-6）。零依赖纯 process.argv 路由。
 *
 * 目标用户（H 簇）：不在 Claude Code/Cursor 里、要脚本化/CI 调 Boule 的人。用 agent 的人走 MCP。
 * 子命令映射到**真实** API 端点（与 MCP 工具同面）；boule mcp 复用 U1 MCP server（@boule/api/mcp）。
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadConfig, flag } from "./config.ts";
import { get, post, del, postFile, CliError } from "./client.ts";

const USAGE = `boule — Boule Thin CLI

用法：
  boule projects                                  列出可访问项目
  boule context                                   显示当前 active context
  boule workflow <id>                             查 workflow 状态/axes
  boule documents --workflow <id>                 列出 workflow 的 artifact
  boule submit --workflow <id> --type <t> --file <path>   提交一份产出
  boule references list --project <id>              列出项目 reference（含解析状态）
  boule references upload --project <id> --file <path> 上传本地文件 reference
  boule references delete --project <id> --id <refId> 删除 reference
  boule mcp [--api-key <k>] [--daemon-url <u>]    启动 MCP stdio server（给 Claude Code 等）
  boule help                                      显示本帮助

配置优先级：命令行 flag > env(BOULE_API_URL/BOULE_API_KEY) > ~/.boule/config.json > 默认 http://localhost:3100`;

function print(v: unknown): void {
  process.stdout.write(typeof v === "string" ? v + "\n" : JSON.stringify(v, null, 2) + "\n");
}

export async function run(argv: string[]): Promise<number> {
  const cmd = argv[0];
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    print(USAGE);
    return 0;
  }

  // mcp 子命令：复用 U1 MCP server（不需要 daemon 配置，server 自己读 BOULE_API_KEY/--api-key）。
  if (cmd === "mcp") {
    const { startMcpServer } = await import("@boule/api/mcp");
    await startMcpServer({ apiKey: flag(argv, "api-key"), baseUrl: flag(argv, "daemon-url") });
    return 0; // server 持续运行直到 stdio 关闭
  }

  const cfg = loadConfig(argv);

  switch (cmd) {
    case "projects":
      print(await get(cfg, "/api/projects"));
      return 0;
    case "context":
      print(await get(cfg, "/api/active-context"));
      return 0;
    case "workflow": {
      const id = argv[1];
      if (!id) throw new CliError("用法：boule workflow <id>");
      print(await get(cfg, `/api/workflows/${id}`));
      return 0;
    }
    case "documents": {
      const wid = flag(argv, "workflow");
      if (!wid) throw new CliError("用法：boule documents --workflow <id>");
      print(await get(cfg, `/api/workflows/${wid}/artifacts`));
      return 0;
    }

    case "references": {
      const sub = argv[1];
      const projectId = flag(argv, "project");
      if (!projectId) throw new CliError("用法：boule references <list|upload|delete> --project <id> ...");
      if (sub === "list") {
        print(await get(cfg, `/api/projects/${projectId}/references`));
        return 0;
      }
      if (sub === "upload") {
        const file = flag(argv, "file");
        if (!file) throw new CliError("用法：boule references upload --project <id> --file <path>");
        print(await postFile(cfg, `/api/projects/${projectId}/references`, file));
        return 0;
      }
      if (sub === "delete") {
        const referenceId = flag(argv, "id");
        if (!referenceId) throw new CliError("用法：boule references delete --project <id> --id <refId>");
        print(await del(cfg, `/api/projects/${projectId}/references/${referenceId}`));
        return 0;
      }
      throw new CliError("用法：boule references <list|upload|delete> --project <id> ...");
    }
    case "submit": {
      const wid = flag(argv, "workflow");
      const type = flag(argv, "type");
      const file = flag(argv, "file");
      if (!wid || !type || !file) throw new CliError("用法：boule submit --workflow <id> --type <t> --file <path>");
      const body = readFileSync(file, "utf8");
      print(await post(cfg, `/api/workflows/${wid}/artifacts`, { type, body }));
      return 0;
    }
    default:
      process.stderr.write(`未知命令：${cmd}\n\n${USAGE}\n`);
      return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`${err instanceof CliError ? err.message : (err as Error).stack ?? String(err)}\n`);
      process.exit(1);
    });
}
