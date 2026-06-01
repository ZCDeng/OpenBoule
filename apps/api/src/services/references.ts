import { sql } from "drizzle-orm";
import type { DB } from "../db/client.ts";

export const MAX_REFERENCE_BYTES = 256 * 1024;
export const MAX_REFERENCES_PER_WORKFLOW = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ProjectReferenceRow {
  id: string;
  projectId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  body: string;
  createdAt: Date;
}

export interface WorkflowReferenceRow {
  id: string;
  workflowId: string;
  referenceId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  bodySnapshot: string;
  createdAt: Date;
}

export function validateReferenceIds(raw: unknown): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, ids: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "referenceIds 必须是数组" };
  if (raw.length > MAX_REFERENCES_PER_WORKFLOW) {
    return { ok: false, error: `referenceIds 最多 ${MAX_REFERENCES_PER_WORKFLOW} 个` };
  }
  const ids = [...new Set(raw)];
  if (!ids.every((id): id is string => typeof id === "string" && UUID_RE.test(id))) {
    return { ok: false, error: "referenceIds 必须是 uuid" };
  }
  return { ok: true, ids };
}

export function validateReferenceUpload(raw: unknown): {
  ok: true;
  filename: string;
  mimeType: string;
  body: string;
  sizeBytes: number;
} | { ok: false; error: string } {
  const { filename, mimeType, body } = (raw ?? {}) as { filename?: unknown; mimeType?: unknown; body?: unknown };
  if (typeof filename !== "string" || filename.trim() === "") return { ok: false, error: "filename 必填" };
  if (filename.length > 200) return { ok: false, error: "filename 过长" };
  if (typeof body !== "string" || body.trim() === "") return { ok: false, error: "body 必填" };
  const sizeBytes = Buffer.byteLength(body, "utf8");
  if (sizeBytes > MAX_REFERENCE_BYTES) return { ok: false, error: `reference 超过 ${MAX_REFERENCE_BYTES} bytes` };
  const normalizedMime = typeof mimeType === "string" && mimeType.trim() ? mimeType.trim() : "text/plain";
  return { ok: true, filename: filename.trim(), mimeType: normalizedMime, body, sizeBytes };
}

export async function listProjectReferences(db: DB, projectId: string): Promise<Omit<ProjectReferenceRow, "body" | "projectId">[]> {
  const res = await db.execute(sql`
    SELECT id, filename, mime_type AS "mimeType", size_bytes AS "sizeBytes", created_at AS "createdAt"
      FROM project_references
     WHERE project_id = ${projectId}
     ORDER BY created_at DESC, id DESC`);
  return (res as unknown as { rows: Omit<ProjectReferenceRow, "body" | "projectId">[] }).rows;
}

export async function createProjectReference(
  db: DB,
  projectId: string,
  input: { filename: string; mimeType: string; sizeBytes: number; body: string },
): Promise<Omit<ProjectReferenceRow, "projectId" | "body">> {
  const res = await db.execute(sql`
    INSERT INTO project_references (project_id, filename, mime_type, size_bytes, body)
    VALUES (${projectId}, ${input.filename}, ${input.mimeType}, ${input.sizeBytes}, ${input.body})
    RETURNING id, filename, mime_type AS "mimeType", size_bytes AS "sizeBytes", created_at AS "createdAt"`);
  return (res as unknown as { rows: Omit<ProjectReferenceRow, "projectId" | "body">[] }).rows[0]!;
}

export async function loadProjectReferences(db: DB, projectId: string, ids: string[]): Promise<ProjectReferenceRow[]> {
  if (ids.length === 0) return [];
  const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  const res = await db.execute(sql`
    SELECT id, project_id AS "projectId", filename, mime_type AS "mimeType", size_bytes AS "sizeBytes",
           body, created_at AS "createdAt"
      FROM project_references
     WHERE project_id = ${projectId} AND id IN (${idList})`);
  const rows = (res as unknown as { rows: ProjectReferenceRow[] }).rows;
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter((row): row is ProjectReferenceRow => !!row);
}

export async function freezeWorkflowReferences(db: DB, workflowId: string, references: ProjectReferenceRow[]): Promise<void> {
  for (const ref of references) {
    await db.execute(sql`
      INSERT INTO workflow_references (workflow_id, reference_id, filename, mime_type, size_bytes, body_snapshot)
      VALUES (${workflowId}, ${ref.id}, ${ref.filename}, ${ref.mimeType}, ${ref.sizeBytes}, ${ref.body})`);
  }
}

export async function listWorkflowReferences(db: DB, workflowId: string): Promise<WorkflowReferenceRow[]> {
  const res = await db.execute(sql`
    SELECT id, workflow_id AS "workflowId", reference_id AS "referenceId", filename, mime_type AS "mimeType",
           size_bytes AS "sizeBytes", body_snapshot AS "bodySnapshot", created_at AS "createdAt"
      FROM workflow_references
     WHERE workflow_id = ${workflowId}
     ORDER BY created_at ASC, id ASC`);
  return (res as unknown as { rows: WorkflowReferenceRow[] }).rows;
}

export function buildReferenceTaskContext(references: WorkflowReferenceRow[]): string | null {
  if (references.length === 0) return null;
  const chunks: string[] = [
    "项目 reference 材料如下。这些材料对应 Skill <项目根>/sources/，只能作为客户提供的 reference/source 使用；不要把它们当成 agent 产出文档，也不要改变原有 artifact 提交方式。",
  ];
  let used = 0;
  const totalLimit = 12000;
  for (const ref of references) {
    const remaining = totalLimit - used;
    if (remaining <= 0) break;
    const body = ref.bodySnapshot.length > remaining ? `${ref.bodySnapshot.slice(0, remaining)}\n[reference 已截断]` : ref.bodySnapshot;
    used += body.length;
    chunks.push(`\n[source: ${ref.filename}; mime=${ref.mimeType}; bytes=${ref.sizeBytes}]\n${body}`);
  }
  return chunks.join("\n");
}
