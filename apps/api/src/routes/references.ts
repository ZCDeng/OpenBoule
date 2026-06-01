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
  MAX_PDF_REFERENCE_BYTES,
  ReferenceStorageLimitError,
  createProjectReference,
  deleteProjectReference,
  listProjectReferences,
  listWorkflowReferences,
  validateReferenceFile,
  validateReferenceUpload,
} from "../services/references.ts";

const activeProjectUploads = new Set<string>();

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
      bodyLimit: MAX_PDF_REFERENCE_BYTES + 4096,
      preHandler: [
        authenticate,
        requireProjectRole(db, "owner", async (req) => (req.params as { id: string }).id),
      ],
    },
    async (req, reply) => {
      const projectId = (req.params as { id: string }).id;
      if (activeProjectUploads.has(projectId)) {
        return reply.code(409).send({ error: "REFERENCE_UPLOAD_BUSY", message: "该项目已有 reference 正在上传解析，请稍后重试" });
      }
      activeProjectUploads.add(projectId);
      try {
        let input: ReturnType<typeof validateReferenceUpload> | ReturnType<typeof validateReferenceFile>;
        if (req.isMultipart()) {
          const part = await req.file({ limits: { fileSize: MAX_PDF_REFERENCE_BYTES } });
          if (!part) return reply.code(400).send({ error: "BAD_REFERENCE", message: "file 必填" });
          const buffer = await part.toBuffer();
          input = validateReferenceFile({ filename: part.filename, mimeType: part.mimetype, buffer });
        } else {
          input = validateReferenceUpload(req.body);
        }
        if (!input.ok) return reply.code(400).send({ error: "BAD_REFERENCE", message: input.error });
        const reference = await createProjectReference(db, projectId, input);
        return reply.code(201).send({ reference });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof ReferenceStorageLimitError) return reply.code(400).send({ error: "BAD_REFERENCE", message });
        // Fastify multipart 超限会抛 FST_REQ_FILE_TOO_LARGE / statusCode 413。
        const code = (err as { code?: string }).code;
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (code === "FST_REQ_FILE_TOO_LARGE" || statusCode === 413) {
          return reply.code(413).send({ error: "REFERENCE_TOO_LARGE", message: `reference 超过 ${MAX_PDF_REFERENCE_BYTES} bytes` });
        }
        return reply.code(500).send({ error: "REFERENCE_UPLOAD_FAILED", message });
      } finally {
        activeProjectUploads.delete(projectId);
      }
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
