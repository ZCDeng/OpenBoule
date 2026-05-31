/**
 * 报告渲染 + 撤销路由（U10）。
 * - GET /s/:token/report：免登录，验签(+scope=report) → 取最终报告 artifact → buildReportDocument →
 *   返回 HTML + `Content-Security-Policy: sandbox allow-scripts`（顶层导航强制 opaque-origin sandbox）。
 * - POST /api/shares/:token/revoke：撤销（owner/editor，nonce 入撤销集，后续访问 410）。
 */

import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { AppDeps } from "../app.ts";
import { makeAuthenticate, requireProjectRole } from "../middleware/auth.ts";
import { getWorkflowProjectId } from "../services/rbac.ts";
import { revokeShare } from "../services/share-token.ts";
import { validateForScope } from "./signer.ts";
import { buildReportDocument } from "./renderer.ts";

export function registerShareRenderRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, securityRedis } = deps;
  const authenticate = makeAuthenticate(db);
  const now = deps.now ?? Date.now;

  // 免登录渲染报告 HTML（opaque-origin sandbox）
  app.get("/s/:token/report", async (req, reply) => {
    const token = (req.params as { token: string }).token;
    const access = await validateForScope(db, securityRedis, token, "report", { nowMs: now(), ip: req.ip });
    if (!access.ok) return reply.code(access.status).send({ error: access.code });

    // 取该 workflow 的最终报告 artifact（Phase 4/5 客户语言版，取最新版本）
    const res = await db.execute(sql`
      SELECT body FROM artifacts
       WHERE workflow_id = ${access.workflowId} AND type IN ('final-report', 'report')
       ORDER BY version DESC LIMIT 1`);
    const body = (res as unknown as { rows?: { body: string }[] }).rows?.[0]?.body;
    const html = buildReportDocument({ title: "咨询报告", bodyHtml: body ?? "<p>报告生成中。</p>" });

    return reply
      .header("content-type", "text/html; charset=utf-8")
      .header("content-security-policy", "sandbox allow-scripts") // 顶层导航强制 opaque-origin sandbox
      .header("x-content-type-options", "nosniff")
      .send(html);
  });

  // 撤销分享链接（需对该 workflow 的 project 有 editor+）
  app.post(
    "/api/shares/:token/revoke",
    {
      preHandler: [
        authenticate,
        requireProjectRole(db, "editor", async (req) => {
          const token = (req.params as { token: string }).token;
          const r = await db.execute(sql`SELECT workflow_id AS "workflowId" FROM share_links WHERE token = ${token}`);
          const wf = (r as unknown as { rows?: { workflowId: string }[] }).rows?.[0]?.workflowId;
          return wf ? getWorkflowProjectId(db, wf) : null;
        }),
      ],
    },
    async (req, reply) => {
      const token = (req.params as { token: string }).token;
      const ok = await revokeShare(db, securityRedis, token);
      if (!ok) return reply.code(404).send({ error: "NOT_FOUND" });
      return reply.send({ ok: true, revoked: true });
    },
  );
}
