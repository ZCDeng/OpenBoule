/**
 * Axis coverage check（U5 / SKILL.md §"axis-coverage check"）。
 *
 * 按 axis 严格分桶找 gap，**不跨桶凑数**（借鉴 OD incomplete_panel：axis A 的 finding
 * 不能拿 axis B 的来凑——finding.axis 必须精确等于声明 axis 才计入该桶）。
 * 空 axis 标 gap 但**不自动 recovery**（recovery 是 PM Agent 的 +2 cap 决策），只如实上报 checkpoint（fail loud）。
 * lane gap 是更细粒度盲区：某 axis 的某必跑 lane 无任何 finding。
 */

import type { Finding } from "./types.ts";

export interface AxisSpec {
  axis: string;
  /** 该 axis 的必跑 lane（来自 axis→lane 路由表）；省略则不查 lane gap。 */
  requiredLanes?: string[];
}

export interface CoverageResult {
  /** 完全无 finding 的 axis（coverage gap，仅上报不 recovery）。 */
  emptyAxes: string[];
  /** 某 axis 的某必跑 lane 无 finding（细粒度盲区）。 */
  laneGaps: { axis: string; lane: string }[];
  /** 每 axis 的桶统计（finding 数 + 实到 lane）。 */
  perAxis: { axis: string; findingCount: number; lanesCovered: string[] }[];
  /** axis 名不匹配任何声明 axis 的 finding 数（透明上报，不静默并桶）。 */
  unassignedFindings: number;
}

export function checkCoverage(axes: AxisSpec[], findings: Finding[]): CoverageResult {
  const declared = new Set(axes.map((a) => a.axis));
  // 严格分桶：finding.axis === 声明 axis 才入桶
  const bucket = new Map<string, Finding[]>();
  for (const a of axes) bucket.set(a.axis, []);
  let unassigned = 0;
  for (const f of findings) {
    if (declared.has(f.axis)) bucket.get(f.axis)!.push(f);
    else unassigned++; // 不跨桶凑数：无主 finding 单独计，不掺进任何 axis
  }

  const emptyAxes: string[] = [];
  const laneGaps: { axis: string; lane: string }[] = [];
  const perAxis: CoverageResult["perAxis"] = [];

  for (const spec of axes) {
    const fs = bucket.get(spec.axis)!;
    const lanesCovered = [...new Set(fs.map((f) => f.lane).filter((l): l is string => !!l))];
    perAxis.push({ axis: spec.axis, findingCount: fs.length, lanesCovered });
    if (fs.length === 0) emptyAxes.push(spec.axis);
    for (const lane of spec.requiredLanes ?? []) {
      if (!lanesCovered.includes(lane)) laneGaps.push({ axis: spec.axis, lane });
    }
  }

  return { emptyAxes, laneGaps, perAxis, unassignedFindings: unassigned };
}
