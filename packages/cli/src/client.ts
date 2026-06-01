/**
 * CLI 的 thin HTTP client（U3）。零依赖，带 Bearer，非 2xx + 连接失败给清晰中文错误。
 * 与 MCP tools 同一 REST 面，但这是人用层（KTD-6：人机接口分离）。
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { CliConfig } from "./config.ts";

export class CliError extends Error {}

async function request(cfg: CliConfig, method: string, path: string, body?: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${cfg.daemonUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers: {
        ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000), // code-review #3：半开连接超时兜底
    });
  } catch (err) {
    throw new CliError(`无法连接 Boule（${cfg.daemonUrl}）：daemon 在运行吗？(${(err as Error).message})`);
  }
  return parseResponse(method, path, res);
}

function fileForm(filePath: string): FormData {
  let buf: Buffer;
  try {
    buf = readFileSync(filePath);
  } catch (err) {
    throw new CliError(`读取 reference 文件失败：${filePath}（${(err as Error).message}）`);
  }
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)]), basename(filePath));
  return form;
}

export async function postFile(cfg: CliConfig, path: string, filePath: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${cfg.daemonUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
      body: fileForm(filePath),
      // 上传路径要长于 JSON request() 的 15s：服务端解析 reference 最长可达 parseTimeoutMs（120s），
      // 大文件/扫描件会在解析中途被 abort。给 parseTimeoutMs + margin。
      signal: AbortSignal.timeout(130_000),
    });
  } catch (err) {
    throw new CliError(`无法连接 Boule（${cfg.daemonUrl}）：daemon 在运行吗？(${(err as Error).message})`);
  }
  return parseResponse("POST", path, res);
}

async function parseResponse(method: string, path: string, res: Response): Promise<unknown> {
  const text = await res.text();
  const parsed = text ? safeJson(text) : null;
  if (!res.ok) {
    const msg =
      (parsed as { message?: string; error?: string } | null)?.message ??
      (parsed as { error?: string } | null)?.error ??
      `HTTP ${res.status}`;
    throw new CliError(`${method} ${path} → ${res.status}：${msg}`);
  }
  return parsed;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const get = (cfg: CliConfig, path: string) => request(cfg, "GET", path);
export const post = (cfg: CliConfig, path: string, body: unknown) => request(cfg, "POST", path, body);
export const del = (cfg: CliConfig, path: string) => request(cfg, "DELETE", path);
