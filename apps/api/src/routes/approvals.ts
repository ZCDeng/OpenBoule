/**
 * 审批路由（U6）。checkpoint 决策（editor+）：approve / redo / augment / reject。
 * 决策 CAS 在引擎层（U4），冲突 → CheckpointConflictError → 409。
 */

import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.ts";
import { authenticate, requireProjectRole, getUser, getProjectRoleFromReq } from "../middleware/auth.ts";
import { getWorkflowProjectId } from "../services/rbac.ts";
import { CheckpointConflictError } from "../workflow/engine.ts";
import { isPhaseId } from "../workflow/state.ts";

export function registerApprovalRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;
  const wfProject = async (req: { params: unknown }) =>
    getWorkflowProjectId(db, (req.params as { id: string }).id);

  // 决策动作携带 responded_by{user_id, role} 作 surface 审计留痕（RBAC 已由 requireProjectRole 把关）
  const respondedBy = (req: Parameters<typeof getUser>[0]) => {
    const user = getUser(req);
    const { role } = getProjectRoleFromReq(req);
    return user && role ? { user_id: user.userId, role } : undefined;
  };

  const decisions = ["approve", "redo", "augment", "reject"] as const;
  for (const decision of decisions) {
    app.post(
      `/api/workflows/:id/${decision}`,
      { preHandler: [authenticate, requireProjectRole(db, "editor", wfProject)] },
      async (req, reply) => {
        if (!deps.engine) return reply.code(503).send({ error: "ENGINE_UNAVAILABLE" });
        const id = (req.params as { id: string }).id;
        try {
          if (decision === "approve") {
            const r = await deps.engine.approve(id, respondedBy(req));
            return reply.send({ ok: true, ...r });
          }
          await deps.engine[decision](id, respondedBy(req));
          return reply.send({ ok: true });
        } catch (err) {
          if (err instanceof CheckpointConflictError) {
            return reply.code(409).send({ error: "CHECKPOINT_CONFLICT", message: err.message });
          }
          throw err;
        }
      },
    );
  }

  // lineage 重跑：从某 phase 重新执行下游（文档工作台「保存并重跑」）。editor+。
  app.post(
    "/api/workflows/:id/rerun",
    { preHandler: [authenticate, requireProjectRole(db, "editor", wfProject)] },
    async (req, reply) => {
      if (!deps.engine) return reply.code(503).send({ error: "ENGINE_UNAVAILABLE" });
      const id = (req.params as { id: string }).id;
      const { phase } = (req.body ?? {}) as { phase?: string };
      if (!phase || !isPhaseId(phase)) return reply.code(400).send({ error: "BAD_REQUEST", message: "phase 非法" });
      try {
        await deps.engine.rerunFrom(id, phase, respondedBy(req));
        return reply.send({ ok: true, rerunFrom: phase });
      } catch (err) {
        if (err instanceof CheckpointConflictError) {
          return reply.code(409).send({ error: "CHECKPOINT_CONFLICT", message: err.message });
        }
        throw err;
      }
    },
  );
}
