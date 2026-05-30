/**
 * 审批路由（U6）。checkpoint 决策（editor+）：approve / redo / augment / reject。
 * 决策 CAS 在引擎层（U4），冲突 → CheckpointConflictError → 409。
 */

import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.ts";
import { authenticate, requireProjectRole } from "../middleware/auth.ts";
import { getWorkflowProjectId } from "../services/rbac.ts";
import { CheckpointConflictError } from "../workflow/engine.ts";

export function registerApprovalRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;
  const wfProject = async (req: { params: unknown }) =>
    getWorkflowProjectId(db, (req.params as { id: string }).id);

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
            const r = await deps.engine.approve(id);
            return reply.send({ ok: true, ...r });
          }
          await deps.engine[decision](id);
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
}
