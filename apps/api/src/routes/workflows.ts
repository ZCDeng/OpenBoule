/**
 * 工作流路由（U6）。创建（owner，固化真值源快照 + 启引擎）/ 查状态（viewer+）。
 */

import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { AppDeps } from "../app.ts";
import { authenticate, requireProjectRole, getProjectRoleFromReq } from "../middleware/auth.ts";
import { getWorkflowProjectId } from "../services/rbac.ts";
import { computeCost } from "../pm/cost-calc.ts";
import { listStalePhases } from "../services/lineage.ts";
import { checkPublication } from "../artifacts/publication-guard.ts";

export function registerWorkflowRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;

  app.post(
    "/api/workflows",
    {
      preHandler: [
        authenticate,
        requireProjectRole(db, "owner", async (req) => {
          const { projectId } = (req.body ?? {}) as { projectId?: string };
          return projectId ?? null;
        }),
      ],
    },
    async (req, reply) => {
      const { projectId, mode, axes } = (req.body ?? {}) as { projectId?: string; mode?: string; axes?: unknown[] };
      // 创建时固化真值源快照（不可变，所有 phase/retry 只读它）。
      // 值必须源自 truth/sync.ts#createFrozenSnapshot（经注入的 snapshotProvider）——
      // 缺 provider 即 503，绝不在此**伪造** snapshot（KTD-20 写入收口，见 write-funnel.guard）。
      if (!deps.snapshotProvider) {
        return reply.code(503).send({ error: "TRUTH_SOURCE_UNCONFIGURED", message: "未配置真值源快照提供者" });
      }
      const snapshot = await deps.snapshotProvider();
      const res = await db.execute(sql`
        INSERT INTO workflows (project_id, mode, axes, truth_snapshot)
        VALUES (${projectId}, ${mode ?? null}, ${axes ? sql`${JSON.stringify(axes)}::jsonb` : sql`NULL`},
                ${JSON.stringify(snapshot)}::jsonb)
        RETURNING id`);
      const workflowId = (res as unknown as { rows: { id: string }[] }).rows[0]!.id;

      if (deps.engine) await deps.engine.startWorkflow(workflowId);
      return reply.code(201).send({ workflowId, started: !!deps.engine });
    },
  );

  app.get(
    "/api/workflows/:id",
    {
      preHandler: [
        authenticate,
        requireProjectRole(db, "viewer", async (req) => getWorkflowProjectId(db, (req.params as { id: string }).id)),
      ],
    },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const res = await db.execute(sql`
        SELECT id, project_id AS "projectId", current_phase AS "currentPhase", status, mode, axes
          FROM workflows WHERE id = ${id}`);
      const row = (res as unknown as { rows?: Record<string, unknown>[] }).rows?.[0];
      if (!row) return reply.code(404).send({ error: "NOT_FOUND" });
      // 带上调用者角色：前端据此显隐审批按钮（editor+ 可见，viewer 隐藏）
      return reply.send({ ...row, myRole: getProjectRoleFromReq(req).role });
    },
  );

  // 成本三层（KTD-22）：Agent 监控 KPI/图表数据源（viewer+）
  app.get(
    "/api/workflows/:id/cost",
    {
      preHandler: [
        authenticate,
        requireProjectRole(db, "viewer", async (req) => getWorkflowProjectId(db, (req.params as { id: string }).id)),
      ],
    },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      return reply.send(await computeCost(db, id));
    },
  );

  // 文档树：各 (phase,type) 的最新版本 artifact（viewer+）
  app.get(
    "/api/workflows/:id/artifacts",
    {
      preHandler: [
        authenticate,
        requireProjectRole(db, "viewer", async (req) => getWorkflowProjectId(db, (req.params as { id: string }).id)),
      ],
    },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const res = await db.execute(sql`
        SELECT DISTINCT ON (phase, type) id, phase, type, version, status, stale
          FROM artifacts WHERE workflow_id = ${id}
         ORDER BY phase, type, version DESC`);
      return reply.send({ artifacts: (res as unknown as { rows: unknown[] }).rows });
    },
  );

  // submit_artifact 后端（U1/R3）：外部 agent（Claude Code via MCP）提交产出 → 落 draft artifact。
  // editor+ 且过 API key scope/项目范围（中间件已把关）；发布护栏拒残留模板占位符。
  app.post(
    "/api/workflows/:id/artifacts",
    {
      preHandler: [
        authenticate,
        requireProjectRole(db, "editor", async (req) => getWorkflowProjectId(db, (req.params as { id: string }).id)),
      ],
    },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const { phase, type, body } = (req.body ?? {}) as { phase?: string; type?: string; body?: string };
      if (!type || typeof body !== "string") {
        return reply.code(400).send({ error: "BAD_REQUEST", message: "type + body 必填" });
      }
      const pub = checkPublication(body);
      if (pub.blocked) {
        return reply.code(422).send({
          error: "ARTIFACT_PUBLICATION_BLOCKED",
          message: "残留模板占位符，拒绝提交",
          hits: pub.hits.map((h) => h.match),
        });
      }
      // 同 (phase,type) 递增版本（首次为 1）。phase 缺省归到 external（CLI 提交无 phase 语境）。
      const ph = phase ?? "external";
      const maxV = await db.execute(sql`
        SELECT COALESCE(MAX(version), 0) AS "v" FROM artifacts
         WHERE workflow_id = ${id} AND phase = ${ph} AND type = ${type}`);
      const nextVersion = Number((maxV as unknown as { rows: { v: number }[] }).rows[0]!.v) + 1;
      const ins = await db.execute(sql`
        INSERT INTO artifacts (workflow_id, phase, type, version, body, status)
        VALUES (${id}, ${ph}, ${type}, ${nextVersion}, ${body}, 'draft')
        RETURNING id`);
      const newId = (ins as unknown as { rows: { id: string }[] }).rows[0]!.id;
      // 主键字段统一用 id（与 GET /api/artifacts/:id 一致，code-review #10）。
      return reply.code(201).send({ id: newId, phase: ph, type, version: nextVersion, status: "draft" });
    },
  );

  // lineage：当前 stale 的下游 phase（文档树 ⚠ 徽章数据源，viewer+）
  app.get(
    "/api/workflows/:id/stale",
    {
      preHandler: [
        authenticate,
        requireProjectRole(db, "viewer", async (req) => getWorkflowProjectId(db, (req.params as { id: string }).id)),
      ],
    },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      return reply.send({ stalePhases: await listStalePhases(db, id) });
    },
  );
}
