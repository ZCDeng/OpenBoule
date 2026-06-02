/**
 * 集中文案映射：把后端的原始枚举码（phase id / 状态码 / scope / 角色码）在渲染前转成中文。
 * 目的——UI 不再直出 `phase2_research` / `paused_for_approval` / `report` 这类内部码，
 * 也不在界面上出现流程黑话；原始码继续在代码、API 参数、注释里保留。
 * 所有面向用户的枚举渲染都应过这里，单一真值源、改一处全站生效。
 */
import { PHASE_LABELS } from "./phases.ts";

const PHASE_BY_ID = new Map(PHASE_LABELS.map((p) => [p.id, p.label]));

/** 阶段 id → 中文阶段名（如 `phase2_research` → “阶段 2 · 调研”）。未知码原样返回。 */
export function phaseLabel(id?: string | null): string {
  if (!id) return "—";
  return PHASE_BY_ID.get(id) ?? id;
}

/** 任务 / 文档 / 产出 状态码 → 中文。覆盖工作流状态与文档状态。 */
const STATUS_LABELS: Record<string, string> = {
  // 任务（workflow）状态
  running: "运行中",
  paused_for_approval: "待确认",
  approved: "已确认",
  rejected: "已拒绝",
  completed: "已完成",
  enqueued: "排队中",
  failed: "已失败",
  // 文档 / 产出状态
  draft: "草稿",
  published: "已发布",
  below_threshold: "未达标",
  stale: "已过期",
  needs_approval: "待确认",
};

export function statusLabel(code?: string | null): string {
  if (!code) return "—";
  return STATUS_LABELS[code] ?? code;
}

/** 分享范围 scope 码 → 中文。 */
const SCOPE_LABELS: Record<string, string> = { report: "报告", methodology: "方法论" };
export function scopeLabel(code?: string | null): string {
  if (!code) return "—";
  return SCOPE_LABELS[code] ?? code;
}

/** 角色码 → 中文（用于面向用户的文案；代码内仍用原始角色码）。 */
const ROLE_LABELS: Record<string, string> = {
  researcher: "调研",
  editor: "审校",
  strategy: "综合",
  designer: "设计",
  "source-verifier": "来源核验",
  "market-scanner": "市场扫描",
};
export function roleLabel(code?: string | null): string {
  if (!code) return code ?? "—";
  return ROLE_LABELS[code] ?? code;
}

/** 字节数 → 人类可读大小（界面不直出裸 bytes）。 */
export function humanBytes(n?: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
