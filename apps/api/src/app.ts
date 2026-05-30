/**
 * Fastify 应用装配（U6）。把 U2 真值源 / U4 引擎 / U5 helper / 安全原语 wire 成对外 HTTP。
 *
 * buildApp(deps) 工厂——db / securityRedis / engine / snapshotProvider / now 全注入，
 * 便于测试用 app.inject 跑全流程，不起真 socket。
 */

import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import type { DB } from "./db/client.ts";
import type { Redis } from "ioredis";
import type { WorkflowEngine } from "./workflow/engine.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerProjectRoutes } from "./routes/projects.ts";
import { registerWorkflowRoutes } from "./routes/workflows.ts";
import { registerApprovalRoutes } from "./routes/approvals.ts";
import { registerArtifactRoutes } from "./routes/artifacts.ts";
import { registerSurfaceRoutes } from "./routes/surfaces.ts";
import { registerShareRoutes } from "./routes/shares.ts";
import { registerSseRoutes } from "./routes/sse.ts";
import { registerLockRoutes } from "./routes/locks.ts";
import { registerShareRenderRoutes } from "./share/routes.ts";

/** 创建 workflow 时固化的真值源快照（生产 = U2 syncTruthSource 产；测试可注入 stub）。 */
export interface FrozenSnapshot {
  commit_sha: string;
  manifest: unknown[];
  contents: Record<string, string>;
}

export interface AppDeps {
  db: DB;
  securityRedis: Redis;
  /** 工作流引擎（启动/审批）；省略则相关路由 503。 */
  engine?: WorkflowEngine;
  /** 真值源快照提供者（创建 workflow 时固化）。 */
  snapshotProvider?: () => Promise<FrozenSnapshot>;
  /** 当前时间（ms）注入，便于测试确定性（token 过期 / 分享过期）。默认 Date.now。 */
  now?: () => number;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(cookie);

  app.get("/health", async () => ({ ok: true }));

  registerAuthRoutes(app, deps);
  registerProjectRoutes(app, deps);
  registerWorkflowRoutes(app, deps);
  registerApprovalRoutes(app, deps);
  registerArtifactRoutes(app, deps);
  registerSurfaceRoutes(app, deps);
  registerShareRoutes(app, deps);
  registerSseRoutes(app, deps);
  registerLockRoutes(app, deps);
  registerShareRenderRoutes(app, deps);

  return app;
}
