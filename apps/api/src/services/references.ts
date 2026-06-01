import { sql } from "drizzle-orm";
import type { DB } from "../db/client.ts";
import { config } from "../config.ts";
import { isTextLikeMime, parseReferenceDocument, type ParseSource, type ParseStatus } from "./document-parsing.ts";

export const MAX_REFERENCE_BYTES = config.references.textMaxBytes;
export const MAX_REFERENCES_PER_WORKFLOW = 20;
export const MAX_PDF_REFERENCE_BYTES = config.references.pdfMaxBytes;
export const MAX_OFFICE_REFERENCE_BYTES = config.references.officeMaxBytes;
export const MAX_PROJECT_REFERENCE_BYTES = config.references.projectMaxBytes;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ProjectReferenceRow {
  id: string;
  projectId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  body: string;
  parseStatus: ParseStatus;
  parseSource: ParseSource | null;
  parseError: string | null;
  createdAt: Date;
}

export interface ProjectReferenceListRow extends Omit<ProjectReferenceRow, "body" | "projectId"> {}

export interface SkippedReferenceRow {
  id: string;
  filename: string | null;
  parseStatus: ParseStatus | "missing";
}

export interface LoadedReferencesResult {
  loaded: ProjectReferenceRow[];
  skipped: SkippedReferenceRow[];
}

/** 项目 reference 总量超额（替代字符串匹配，路由层据此映射 400）。 */
export class ReferenceStorageLimitError extends Error {
  override readonly name = "ReferenceStorageLimitError";
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
  if (raw.length > MAX_REFERENCES_PER_WORKFLOW) return { ok: false, error: `referenceIds 最多 ${MAX_REFERENCES_PER_WORKFLOW} 个` };
  const ids = [...new Set(raw)];
  if (!ids.every((id): id is string => typeof id === "string" && UUID_RE.test(id))) return { ok: false, error: "referenceIds 必须是 uuid" };
  return { ok: true, ids };
}

export interface ValidatedReferenceFile {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  sizeBytes: number;
}

export function validateReferenceUpload(raw: unknown): { ok: true; filename: string; mimeType: string; body: string; sizeBytes: number } | { ok: false; error: string } {
  const { filename, mimeType, body } = (raw ?? {}) as { filename?: unknown; mimeType?: unknown; body?: unknown };
  if (typeof body !== "string") return { ok: false, error: "body 必填" };
  const file = validateReferenceFile({ filename, mimeType, buffer: Buffer.from(body, "utf8") });
  if (!file.ok) return file;
  if (!isTextLikeMime(file.mimeType)) return { ok: false, error: "JSON 上传只支持文本 reference；二进制请使用 multipart" };
  const text = body.trim();
  if (!text) return { ok: false, error: "body 必填" };
  return { ok: true, filename: file.filename, mimeType: file.mimeType, body: text, sizeBytes: file.sizeBytes };
}

export function validateReferenceFile(input: { filename: unknown; mimeType: unknown; buffer: Buffer }): { ok: true } & ValidatedReferenceFile | { ok: false; error: string } {
  const filename = typeof input.filename === "string" ? input.filename.trim() : "";
  if (!filename) return { ok: false, error: "filename 必填" };
  if (filename.length > 200) return { ok: false, error: "filename 过长" };
  if (input.buffer.length === 0) return { ok: false, error: "文件为空" };
  const detected = detectMimeType(input.buffer, typeof input.mimeType === "string" ? input.mimeType : undefined, filename);
  if (!detected.ok) return detected;
  const max = maxBytesForMime(detected.mimeType);
  if (input.buffer.length > max) return { ok: false, error: `reference 超过 ${max} bytes` };
  return { ok: true, filename, mimeType: detected.mimeType, buffer: input.buffer, sizeBytes: input.buffer.length };
}

function detectMimeType(buffer: Buffer, declared: string | undefined, filename: string): { ok: true; mimeType: string } | { ok: false; error: string } {
  const lower = filename.toLowerCase();
  const d = (declared ?? "").trim().toLowerCase();
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") return { ok: true, mimeType: "application/pdf" };
  const isZip = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  if (isZip) {
    if (lower.endsWith(".docx") || d.includes("wordprocessingml")) return { ok: true, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    if (lower.endsWith(".pptx") || d.includes("presentationml")) return { ok: true, mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
    if (lower.endsWith(".xlsx") || d.includes("spreadsheetml")) return { ok: true, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
    return { ok: false, error: "不支持的 Office/ZIP reference 类型" };
  }
  if (isTextLikeMime(d) || /\.(txt|md|csv|json|ya?ml)$/i.test(filename)) return { ok: true, mimeType: d || "text/plain" };
  return { ok: false, error: "不支持的 reference 类型或文件签名不匹配" };
}

function maxBytesForMime(mimeType: string): number {
  if (mimeType === "application/pdf") return MAX_PDF_REFERENCE_BYTES;
  if (mimeType.includes("openxmlformats-officedocument")) return MAX_OFFICE_REFERENCE_BYTES;
  return MAX_REFERENCE_BYTES;
}

type SqlExecutor = Pick<DB, "execute">;

export async function assertProjectReferenceStorageBudget(db: SqlExecutor, projectId: string, incomingBytes: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await db.execute(sql`SELECT COALESCE(SUM(size_bytes), 0)::int AS "used" FROM project_references WHERE project_id = ${projectId}`);
  const used = Number((res as unknown as { rows: { used: number }[] }).rows[0]?.used ?? 0);
  if (used + incomingBytes > MAX_PROJECT_REFERENCE_BYTES) return { ok: false, error: `项目 reference 总量超过 ${MAX_PROJECT_REFERENCE_BYTES} bytes` };
  return { ok: true };
}

export async function listProjectReferences(db: DB, projectId: string): Promise<ProjectReferenceListRow[]> {
  const res = await db.execute(sql`
    SELECT id, filename, mime_type AS "mimeType", size_bytes AS "sizeBytes", parse_status AS "parseStatus",
           parse_source AS "parseSource", parse_error AS "parseError", created_at AS "createdAt"
      FROM project_references
     WHERE project_id = ${projectId}
     ORDER BY created_at DESC, id DESC`);
  return (res as unknown as { rows: ProjectReferenceListRow[] }).rows;
}

export async function createProjectReference(
  db: DB,
  projectId: string,
  input:
    | { filename: string; mimeType: string; sizeBytes: number; body: string }
    | { filename: string; mimeType: string; sizeBytes: number; buffer: Buffer },
): Promise<ProjectReferenceListRow> {
  const parsed = "body" in input
    ? { body: input.body, parseStatus: "parsed" as ParseStatus, parseSource: "local-js" as ParseSource, shouldStoreOriginal: false, error: null }
    : await parseReferenceDocument({ buffer: input.buffer, mimeType: input.mimeType, filename: input.filename });
  const originalBinary = "buffer" in input && parsed.shouldStoreOriginal ? input.buffer : null;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${projectId}))`);
    const budget = await assertProjectReferenceStorageBudget(tx, projectId, input.sizeBytes);
    if (!budget.ok) throw new ReferenceStorageLimitError(budget.error);
    const res = await tx.execute(sql`
      INSERT INTO project_references (project_id, filename, mime_type, size_bytes, body, original_binary, parse_status, parse_source, parse_error)
      VALUES (${projectId}, ${input.filename}, ${input.mimeType}, ${input.sizeBytes}, ${parsed.body}, ${originalBinary}, ${parsed.parseStatus}, ${parsed.parseSource}, ${parsed.error ?? null})
      RETURNING id, filename, mime_type AS "mimeType", size_bytes AS "sizeBytes", parse_status AS "parseStatus",
                parse_source AS "parseSource", parse_error AS "parseError", created_at AS "createdAt"`);
    return (res as unknown as { rows: ProjectReferenceListRow[] }).rows[0]!;
  });
}

export async function deleteProjectReference(db: DB, projectId: string, referenceId: string): Promise<boolean> {
  const res = await db.execute(sql`DELETE FROM project_references WHERE project_id = ${projectId} AND id = ${referenceId}`);
  return ((res as unknown as { rowCount?: number }).rowCount ?? 0) > 0;
}

export async function loadProjectReferences(db: DB, projectId: string, ids: string[]): Promise<ProjectReferenceRow[]> {
  return (await loadProjectReferencesPartitioned(db, projectId, ids)).loaded;
}

export async function loadProjectReferencesPartitioned(db: DB, projectId: string, ids: string[]): Promise<LoadedReferencesResult> {
  if (ids.length === 0) return { loaded: [], skipped: [] };
  const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  const res = await db.execute(sql`
    SELECT id, project_id AS "projectId", filename, mime_type AS "mimeType", size_bytes AS "sizeBytes",
           body, parse_status AS "parseStatus", parse_source AS "parseSource", parse_error AS "parseError", created_at AS "createdAt"
      FROM project_references
     WHERE project_id = ${projectId} AND id IN (${idList})`);
  const rows = (res as unknown as { rows: ProjectReferenceRow[] }).rows;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const loaded: ProjectReferenceRow[] = [];
  const skipped: SkippedReferenceRow[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      skipped.push({ id, filename: null, parseStatus: "missing" });
    } else if (row.parseStatus === "failed") {
      skipped.push({ id, filename: row.filename, parseStatus: row.parseStatus });
    } else {
      loaded.push(row);
    }
  }
  return { loaded, skipped };
}

export async function freezeWorkflowReferences(db: DB, workflowId: string, references: ProjectReferenceRow[]): Promise<void> {
  for (const ref of references) {
    if (ref.parseStatus === "failed") continue;
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
