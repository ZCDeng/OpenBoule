/**
 * 组合根（boule API 进程入口）。把已测的 buildApp / WorkflowEngine / 真值源 / U3 执行器 wire 成可部署进程。
 *
 * 启动：建 securityRedis → 生产 agentRunner（U2+U3+U5）→ WorkflowEngine.start → boot recoverStalled →
 * buildApp（snapshotProvider=createFrozenSnapshot）→ listen。SIGINT/SIGTERM 优雅关闭（关引擎/redis/pool）。
 *
 * 注：workflow 的 phase 真正执行需 SDK auth（CLI 会话或 ANTHROPIC_API_KEY，KTD-2）；无 auth 时 HTTP 网关
 * 仍完整可用，仅 phase 执行会 fail（在时间线可见），不影响进程启动。
 */

import { buildApp } from "./app.ts";
import { config } from "./config.ts";
import { db, pool } from "./db/client.ts";
import { createSecurityRedis } from "./services/redis.ts";
import { WorkflowEngine } from "./workflow/engine.ts";
import { makeProductionAgentRunner } from "./services/agent-runner.ts";
import { createFrozenSnapshot } from "./truth/sync.ts";

async function main() {
  const securityRedis = createSecurityRedis();

  const engine = new WorkflowEngine(db, {
    agentRunner: makeProductionAgentRunner(db),
    workerId: config.agent.workerId,
  });
  engine.start();

  // boot 兜底：接管上次进程留下的失联 attempt（运行期 lease+heartbeat 是主探活，见 U4）
  try {
    const recovered = await engine.recoverStalled();
    if (recovered > 0) console.log(`[boot] 恢复 ${recovered} 个失联 phase`);
  } catch (err) {
    console.error("[boot] recoverStalled 失败（非致命）", err);
  }

  const app = buildApp({
    db,
    securityRedis,
    engine,
    snapshotProvider: () => createFrozenSnapshot(), // 创建 workflow 时固化当前 HEAD 快照
  });

  await app.listen({ port: config.apiPort, host: "0.0.0.0" });
  console.log(`[boule] API listening on :${config.apiPort}`);

  let closing = false;
  const shutdown = async (sig: string) => {
    if (closing) return;
    closing = true;
    console.log(`[boule] ${sig} → 优雅关闭…`);
    try {
      await app.close();
      await engine.close();
      await securityRedis.quit();
      await pool.end();
      console.log("[boule] 已关闭");
      process.exit(0);
    } catch (err) {
      console.error("[boule] 关闭出错", err);
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[boule] 启动失败", err);
  process.exit(1);
});
