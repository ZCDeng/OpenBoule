/**
 * config 数字校验 fail-loud：非数字 env 即抛（避免 NaN 静默传到 setTimeout(NaN)→0）。
 * 动态 import：ESM 静态 import 会被 hoist 到 env 赋值之前。
 */

import { test } from "node:test";
import assert from "node:assert/strict";

test("AGENT_WATCHDOG_MS 非数字 → config 加载即抛", async () => {
  process.env.AGENT_WATCHDOG_MS = "5m"; // 坏值，Number("5m")=NaN
  await assert.rejects(() => import("../src/config.ts"), /AGENT_WATCHDOG_MS 必须是数字/);
  delete process.env.AGENT_WATCHDOG_MS;
});
