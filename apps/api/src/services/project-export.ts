/**
 * 本地→团队 项目迁移（U2 R5 / KTD-5）。export 打包 project + workflows + artifacts 为可移植 JSON，
 * import 在目标实例重建并归属导入者（owner 重映射，E 簇）。
 *
 * 无 tarball（fail loud）：当前 artifact 是 DB 文本 body，无文件附件（同 U10 inline-assets 留痕）。
 * 待文件型 artifact 出现再加附件打包。import 仍强校验：大小上限 + schema + 原子事务。
 */

import { sql } from "drizzle-orm";
import type { DB } from "../db/client.ts";

export const EXPORT_VERSION = 1;
/** import 体积上限（防 OOM/DoS）。 */
export const MAX_BUNDLE_BYTES = 10 * 1024 * 1024; // 10MB
/** 行数上限（code-review #9）：防 10MB 内塞数万行 → 单事务长时持锁 + 连接占用。 */
export const MAX_WORKFLOWS = 500;
export const MAX_ARTIFACTS_PER_WORKFLOW = 1000;

const WORKFLOW_STATUS = new Set(["running", "paused_for_approval", "approved", "rejected"]);
const ARTIFACT_STATUS = new Set(["draft", "below_threshold", "published"]);

export interface ExportedArtifact {
  phase: string;
  type: string;
  version: number;
  body: string;
  status: string;
  stale: boolean;
  inputArtifactVersions: unknown;
}
export interface ExportedWorkflow {
  currentPhase: string;
  status: string;
  mode: string | null;
  axes: unknown;
  truthSnapshot: unknown;
  artifacts: ExportedArtifact[];
}
export interface ProjectBundle {
  bouleExportVersion: number;
  project: { name: string };
  workflows: ExportedWorkflow[];
}

/** 打包一个 project（owner 信息不导出——导入时归属导入者）。 */
export async function exportProject(db: DB, projectId: string): Promise<ProjectBundle> {
  const proj = await db.execute(sql`SELECT name FROM projects WHERE id = ${projectId}`);
  const projRow = (proj as unknown as { rows?: { name: string }[] }).rows?.[0];
  if (!projRow) throw new Error(`project ${projectId} 不存在`);

  const wfRes = await db.execute(sql`
    SELECT id, current_phase AS "currentPhase", status, mode, axes, truth_snapshot AS "truthSnapshot"
      FROM workflows WHERE project_id = ${projectId} ORDER BY created_at ASC`);
  const wfRows = (wfRes as unknown as {
    rows: { id: string; currentPhase: string; status: string; mode: string | null; axes: unknown; truthSnapshot: unknown }[];
  }).rows;

  const workflows: ExportedWorkflow[] = [];
  for (const w of wfRows) {
    const aRes = await db.execute(sql`
      SELECT phase, type, version, body, status, stale,
             input_artifact_versions AS "inputArtifactVersions"
        FROM artifacts WHERE workflow_id = ${w.id} ORDER BY phase, type, version`);
    const artifacts = (aRes as unknown as { rows: ExportedArtifact[] }).rows;
    workflows.push({
      currentPhase: w.currentPhase,
      status: w.status,
      mode: w.mode,
      axes: w.axes,
      truthSnapshot: w.truthSnapshot,
      artifacts,
    });
  }
  return { bouleExportVersion: EXPORT_VERSION, project: { name: projRow.name }, workflows };
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  bundle?: ProjectBundle;
}

/** 校验导入 bundle：大小 + 版本 + 结构 + 枚举值。任一不满足拒（fail loud）。 */
export function validateBundle(raw: unknown, rawByteLength: number): ValidationResult {
  if (rawByteLength > MAX_BUNDLE_BYTES) {
    return { ok: false, error: `bundle 超过 ${MAX_BUNDLE_BYTES} 字节上限` };
  }
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "bundle 非对象" };
  const b = raw as Partial<ProjectBundle>;
  if (b.bouleExportVersion !== EXPORT_VERSION) {
    return { ok: false, error: `不支持的 bouleExportVersion（需 ${EXPORT_VERSION}）` };
  }
  if (!b.project || typeof b.project.name !== "string" || b.project.name.trim() === "") {
    return { ok: false, error: "project.name 缺失或非法" };
  }
  if (!Array.isArray(b.workflows)) return { ok: false, error: "workflows 需为数组" };
  if (b.workflows.length > MAX_WORKFLOWS) return { ok: false, error: `workflows 超过 ${MAX_WORKFLOWS} 上限` };
  for (const [i, w] of b.workflows.entries()) {
    if (!w || typeof w !== "object") return { ok: false, error: `workflows[${i}] 非对象` };
    if (typeof w.currentPhase !== "string") return { ok: false, error: `workflows[${i}].currentPhase 非法` };
    if (!WORKFLOW_STATUS.has(w.status)) return { ok: false, error: `workflows[${i}].status 非法值` };
    if (w.truthSnapshot === undefined || w.truthSnapshot === null) {
      return { ok: false, error: `workflows[${i}].truthSnapshot 缺失` };
    }
    if (!Array.isArray(w.artifacts)) return { ok: false, error: `workflows[${i}].artifacts 需为数组` };
    if (w.artifacts.length > MAX_ARTIFACTS_PER_WORKFLOW) {
      return { ok: false, error: `workflows[${i}].artifacts 超过 ${MAX_ARTIFACTS_PER_WORKFLOW} 上限` };
    }
    for (const [j, a] of w.artifacts.entries()) {
      if (!a || typeof a.phase !== "string" || typeof a.type !== "string" || typeof a.body !== "string") {
        return { ok: false, error: `workflows[${i}].artifacts[${j}] 字段非法` };
      }
      if (typeof a.version !== "number" || !ARTIFACT_STATUS.has(a.status)) {
        return { ok: false, error: `workflows[${i}].artifacts[${j}] version/status 非法` };
      }
    }
  }
  return { ok: true, bundle: b as ProjectBundle };
}

/**
 * 导入 bundle：原子事务建 project（owner=导入者）+ workflows + artifacts。
 * 任一步失败整体回滚（不留半截项目）。返回新 project id。
 */
export async function importProject(db: DB, importerUserId: string, bundle: ProjectBundle): Promise<string> {
  return db.transaction(async (tx) => {
    const projRes = await tx.execute(sql`
      INSERT INTO projects (name, owner_id) VALUES (${bundle.project.name}, ${importerUserId}) RETURNING id`);
    const projectId = (projRes as unknown as { rows: { id: string }[] }).rows[0]!.id;

    for (const w of bundle.workflows) {
      const axesJson = w.axes === undefined || w.axes === null ? null : JSON.stringify(w.axes);
      const wfRes = await tx.execute(sql`
        INSERT INTO workflows (project_id, current_phase, status, mode, axes, truth_snapshot)
        VALUES (${projectId}, ${w.currentPhase}, ${w.status}::workflow_status, ${w.mode},
                ${axesJson}::jsonb, ${JSON.stringify(w.truthSnapshot)}::jsonb)
        RETURNING id`);
      const workflowId = (wfRes as unknown as { rows: { id: string }[] }).rows[0]!.id;

      for (const a of w.artifacts) {
        const iav =
          a.inputArtifactVersions === undefined || a.inputArtifactVersions === null
            ? null
            : JSON.stringify(a.inputArtifactVersions);
        await tx.execute(sql`
          INSERT INTO artifacts (workflow_id, phase, type, version, body, status, stale, input_artifact_versions)
          VALUES (${workflowId}, ${a.phase}, ${a.type}, ${a.version}, ${a.body},
                  ${a.status}::artifact_status, ${a.stale ?? false}, ${iav}::jsonb)`);
      }
    }
    return projectId;
  });
}
