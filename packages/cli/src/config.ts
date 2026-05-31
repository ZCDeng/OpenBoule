/**
 * CLI 配置解析（U3 / KTD-6）。优先级：命令行 flag > env > ~/.boule/config.json > 默认。
 * 纯函数 resolveConfig(argv, env, fileJson) 便于测试（不读真实文件/env）。
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CliConfig {
  daemonUrl: string;
  apiKey?: string;
}

const DEFAULT_URL = "http://localhost:3100";

/** 从 argv 取 --flag 的值（无值返回 undefined）。 */
export function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

/** 纯解析（注入 argv/env/fileJson）。 */
export function resolveConfig(
  argv: string[],
  env: Record<string, string | undefined>,
  fileJson: Partial<CliConfig>,
): CliConfig {
  return {
    daemonUrl: flag(argv, "daemon-url") ?? env.BOULE_API_URL ?? fileJson.daemonUrl ?? DEFAULT_URL,
    apiKey: flag(argv, "api-key") ?? env.BOULE_API_KEY ?? fileJson.apiKey,
  };
}

/** 读 ~/.boule/config.json（缺失/坏 JSON → 空对象，不报错）。 */
export function readConfigFile(): Partial<CliConfig> {
  try {
    return JSON.parse(readFileSync(join(homedir(), ".boule", "config.json"), "utf8")) as Partial<CliConfig>;
  } catch {
    return {};
  }
}

/** 生产入口：合并真实 argv/env/文件。 */
export function loadConfig(argv: string[]): CliConfig {
  return resolveConfig(argv, process.env, readConfigFile());
}
