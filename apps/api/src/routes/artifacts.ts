/**
 * Artifact 路由（U6）。查看（viewer+）/ 编辑创建新版本（editor+，过 publication + stub 两道护栏）/ 历史版本。
 */

import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { AppDeps } from "../app.ts";
import { authenticate, requireProjectRole } from "../middleware/auth.ts";
import { getArtifactContext } from "../services/rbac.ts";
import { checkPublication } from "../artifacts/publication-guard.ts";
import { checkStub, type StubMode } from "../artifacts/stub-guard.ts";

interface ArtifactRow {
  id: string;
  workflowId: string;
  phase: string;
  type: string;
  version: number;
  body: string;
  status: string;
}

export function registerArtifactRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db } = deps;
  const artifactProject = async (req: { params: unknown }) => {
    const ctx = await getArtifactContext(db, (req.params as { id: string }).id);
    return ctx?.projectId ?? null;
  };

  async function loadArtifact(id: string): Promise<ArtifactRow | null> {
    const res = await db.execute(sql`
      SELECT id, workflow_id AS "workflowId", phase, type, version, body, status
        FROM artifacts WHERE id = ${id}`);
    return (res as unknown as { rows?: ArtifactRow[] }).rows?.[0] ?? null;
  }

  app.get(
    "/api/artifacts/:id",
    { preHandler: [authenticate, requireProjectRole(db, "viewer", artifactProject)] },
    async (req, reply) => {
      const a = await loadArtifact((req.params as { id: string }).id);
      if (!a) return reply.code(404).send({ error: "NOT_FOUND" });
      return reply.send(a);
    },
  );

  app.get(
    "/api/artifacts/:id/versions",
    { preHandler: [authenticate, requireProjectRole(db, "viewer", artifactProject)] },
    async (req, reply) => {
      const a = await loadArtifact((req.params as { id: string }).id);
      if (!a) return reply.code(404).send({ error: "NOT_FOUND" });
      const res = await db.execute(sql`
        SELECT id, version, status, created_at AS "createdAt"
          FROM artifacts WHERE workflow_id = ${a.workflowId} AND phase = ${a.phase} AND type = ${a.type}
         ORDER BY version ASC`);
      return reply.send({ versions: (res as unknown as { rows: unknown[] }).rows });
    },
  );

  app.put(
    "/api/artifacts/:id",
    { preHandler: [authenticate, requireProjectRole(db, "editor", artifactProject)] },
    async (req, reply) => {
      const a = await loadArtifact((req.params as { id: string }).id);
      if (!a) return reply.code(404).send({ error: "NOT_FOUND" });
      const { body, stubMode } = (req.body ?? {}) as { body?: string; stubMode?: StubMode };
      if (typeof body !== "string") return reply.code(400).send({ error: "BAD_REQUEST", message: "body 必填" });

      // 护栏 1：发布护栏——残留模板占位符拒发
      const pub = checkPublication(body);
      if (pub.blocked) {
        return reply.code(422).send({
          error: "ARTIFACT_PUBLICATION_BLOCKED",
          message: "残留模板占位符，拒绝发布",
          hits: pub.hits.map((h) => h.match),
        });
      }

      // 护栏 2：退化护栏——新 body < 同 artifact 历史最大版本 20%
      const baselineRes = await db.execute(sql`
        SELECT body FROM artifacts
         WHERE workflow_id = ${a.workflowId} AND phase = ${a.phase} AND type = ${a.type}
         ORDER BY length(body) DESC LIMIT 1`);
      const baselineBody = (baselineRes as unknown as { rows?: { body: string }[] }).rows?.[0]?.body ?? "";
      const stub = checkStub(body, Buffer.byteLength(baselineBody, "utf8"), stubMode ?? "warn");
      if (stub.verdict === "reject") {
        return reply.code(422).send({ error: "ARTIFACT_STUB_REJECTED", message: "疑似写崩（体量骤降）", ratio: stub.ratio });
      }

      const maxV = await db.execute(sql`
        SELECT COALESCE(MAX(version), 0) AS "v" FROM artifacts
         WHERE workflow_id = ${a.workflowId} AND phase = ${a.phase} AND type = ${a.type}`);
      const nextVersion = Number((maxV as unknown as { rows: { v: number }[] }).rows[0]!.v) + 1;
      const ins = await db.execute(sql`
        INSERT INTO artifacts (workflow_id, phase, type, version, body, status)
        VALUES (${a.workflowId}, ${a.phase}, ${a.type}, ${nextVersion}, ${body}, 'draft')
        RETURNING id`);
      const newId = (ins as unknown as { rows: { id: string }[] }).rows[0]!.id;
      return reply.send({ id: newId, version: nextVersion, warning: stub.verdict === "warn" ? "STUB_WARN" : undefined });
    },
  );
}
