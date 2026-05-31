/**
 * Phase 0 确定性脚手架（U1）。
 *
 * phase0「骨架生成、目录创建」本是确定性的——按 mode + 真值源 manifest 算出一份交付骨架 TOC，
 * 不需要 LLM 判断。纯函数：无 I/O、无随机、无时间，同输入同输出（供引擎 processScaffold 直接落库）。
 *
 * 设计依据见 plan 2026-05-31-001 KTD-1/KTD-2。下游 phase 目前不消费本产物（用 task:phase），
 * 故脚手架只需「合法、确定、可展示」即可。
 */

import type { PhaseArtifact } from "./phases/index.ts";

/** 五种 mode 的交付骨架章节（确定性模板）。键为 UI mode 文案。 */
const MODE_SECTIONS: Record<string, readonly string[]> = {
  调研: ["背景与问题", "行业格局", "关键发现", "机会与风险", "结论与建议"],
  决策: ["决策背景", "可选方案", "评估维度", "权衡分析", "推荐决策"],
  培训: ["培训目标", "受众与现状", "知识框架", "案例与练习", "落地评估"],
  落地: ["落地目标", "现状盘点", "实施路径", "里程碑与责任", "风险与缓解"],
  诊断: ["诊断范围", "现状评估", "问题归因", "改进举措", "预期成效"],
} as const;

/** mode 缺省时按「调研」骨架（与 U6 workflow 创建默认一致）。 */
export const DEFAULT_MODE = "调研";

/**
 * 按 mode + manifest 产出确定性脚手架 artifact。
 *
 * @param mode workflow 的 mode（可空 → DEFAULT_MODE；未知 mode → 也回落 DEFAULT_MODE 骨架）
 * @param manifest 真值源快照的文件清单（role/skill 文件名），作为脚手架的引用锚点
 */
export function buildScaffoldArtifact(
  mode: string | null | undefined,
  manifest: readonly string[],
): PhaseArtifact {
  const resolvedMode = mode && MODE_SECTIONS[mode] ? mode : DEFAULT_MODE;
  const sections = MODE_SECTIONS[resolvedMode]!;
  const body = JSON.stringify({
    kind: "scaffold",
    mode: resolvedMode,
    sections: sections.map((title, i) => ({ order: i + 1, title })),
    manifestRefs: [...manifest],
  });
  return { type: "scaffold", body, status: "draft" };
}
