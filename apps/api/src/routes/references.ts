/**
 * Reference routes：项目输入材料与 workflow 冻结快照。
 *
 * reference 映射 Skill <项目根>/sources/，是启动前输入，不复用 artifact/submit_artifact。
 */

import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.ts";
import { makeAuthenticate, requireProjectRole } from "../middleware/auth.ts";
import { getWorkflowProjectId } from "../services/rbac.ts";
import {
  MAX_REFERENCE_BYTES,
  createProjectReference,
  deleteProjectReference,
  listProjectReferences,
  listWorkflowReferences,
  validateReferenceUpload,
} from "../services/references.ts";

export function registerReferenceRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;
  const authenticate = makeAuthenticate(db);

  app.get(
    "/api/projects/:id/references",
    {
      preHandler: [
        authenticate,
        requireProjectRole(db, "viewer", async (req) => (req.params as { id: string }).id),
      ],
    },
    async (req, reply) => {
      const projectId = (req.params as { id: string }).id;
      return reply.send({ references: await listProjectReferences(db, projectId) });
    },
  );

  app.post(
    "/api/projects/:id/references",
    {
      bodyLimit: MAX_REFERENCE_BYTES + 4096,
      preHandler: [
        authenticate,
        requireProjectRole(db, "owner", async (req) => (req.params as { id: string }).id),
      ],
    },
    async (req, reply) => {
      const projectId = (req.params as { id: string }).id;
      const input = validateReferenceUpload(req.body);
      if (!input.ok) return reply.code(400).send({ error: "BAD_REFERENCE", message: input.error });
      const reference = await createProjectReference(db, projectId, input);
      return reply.code(201).send({ reference });
    },
  );

  app.delete(
    "/api/projects/:id/references/:referenceId",
    {
      preHandler: [
        authenticate,
        requireProjectRole(db, "owner", async (req) => (req.params as { id: string }).id),
      ],
    },
    async (req, reply) => {
      const { id: projectId, referenceId } = req.params as { id: string; referenceId: string };
      const deleted = await deleteProjectReference(db, projectId, referenceId);
      if (!deleted) return reply.code(404).send({ error: "NOT_FOUND" });
      return reply.code(204).send();
    },
  );

  app.get(
    "/api/workflows/:id/references",
    {
      preHandler: [
        authenticate,
        requireProjectRole(db, "viewer", async (req) => getWorkflowProjectId(db, (req.params as { id: string }).id)),
      ],
    },
    async (req, reply) => {
      const workflowId = (req.params as { id: string }).id;
      return reply.send({ references: await listWorkflowReferences(db, workflowId) });
    },
  );
}
