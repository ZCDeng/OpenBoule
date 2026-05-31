/**
 * U3 CLI 配置优先级（纯函数，注入 argv/env/file）。
 * flag > env > file > 默认——这是 CLI 唯一值得测的逻辑（fetch 是 thin 透传）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveConfig, flag } from "../src/config.ts";

test("flag：取 --name 的值，缺失 undefined", () => {
  assert.equal(flag(["--workflow", "wf-1"], "workflow"), "wf-1");
  assert.equal(flag(["--workflow"], "workflow"), undefined, "末尾无值");
  assert.equal(flag([], "workflow"), undefined);
});

test("优先级：flag > env > file > 默认", () => {
  // 全空 → 默认
  assert.deepEqual(resolveConfig([], {}, {}), {
    daemonUrl: "http://localhost:3100",
    apiKey: undefined,
  });
  // file 兜底
  assert.equal(resolveConfig([], {}, { daemonUrl: "http://file" }).daemonUrl, "http://file");
  // env 盖 file
  assert.equal(
    resolveConfig([], { BOULE_API_URL: "http://env" }, { daemonUrl: "http://file" }).daemonUrl,
    "http://env",
  );
  // flag 盖 env
  assert.equal(
    resolveConfig(["--daemon-url", "http://flag"], { BOULE_API_URL: "http://env" }, {}).daemonUrl,
    "http://flag",
  );
});

test("apiKey 同样遵循优先级", () => {
  assert.equal(resolveConfig(["--api-key", "bk_flag"], { BOULE_API_KEY: "bk_env" }, {}).apiKey, "bk_flag");
  assert.equal(resolveConfig([], { BOULE_API_KEY: "bk_env" }, { apiKey: "bk_file" }).apiKey, "bk_env");
  assert.equal(resolveConfig([], {}, { apiKey: "bk_file" }).apiKey, "bk_file");
});
