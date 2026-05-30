/**
 * 对抗验证裁决（U5 / KTD-21，借鉴 open-design critique + deep-research bughunter）。
 *
 * 三条铁律落地：
 * 1. **模型给判断、代码给裁决**：voter 自报的 selfReportedVerdict 一律 advisory，本模块**只读 refuted 布尔**
 *    重算裁决。模型自报「已确认」但有效票/驳倒数不够时，代码裁 undetermined（不采信自报）。
 * 2. **规则表"顺序即正确性"**：四态自上而下「第一条匹配即赢」，顺序固化并注释为什么——
 *    OD 真实 bug：把「报了警告又崩掉」误判成「干净但不完整」，因规则排序反了。这里 undetermined
 *    （有效票不足）**必须先于** confirmed 判，否则 valid=1/refuted=1 会被误判 confirmed。
 * 3. **缺席不拉偏**：弃权（null 票）不计入有效票，composite 在**在场投票者间归一**（OD computeComposite：
 *    缺席权重在在场者间按比例重分配），缺席不被当成 survive 也不当成 refute。
 */

import type { Ballot } from "./types.ts";

export type Verdict = "confirmed" | "salvage" | "killed" | "undetermined";
export type Confidence = "High" | "Medium" | "Low";

export interface Adjudication {
  verdict: Verdict;
  validCount: number;
  refutedCount: number;
  /** 在场投票者间归一后的存活分 [0,1]（缺席权重已重分配）。 */
  composite: number;
  confidence: Confidence;
}

/**
 * 在场投票者间归一的存活分。缺席（null）权重按比例重分配给在场者，
 * 不让缺席把整体拉偏。全员缺席 → 0（无信息）。
 */
export function computeComposite(ballots: Ballot[], weights?: number[]): number {
  const w = (i: number) => (weights ? (weights[i] ?? 0) : 1);
  let presentWeight = 0;
  let surviveWeight = 0;
  ballots.forEach((b, i) => {
    if (b === null) return; // 缺席：不计权重（等于把它的权重让给在场者归一）
    presentWeight += w(i);
    if (!b.refuted) surviveWeight += w(i);
  });
  if (presentWeight === 0) return 0;
  return surviveWeight / presentWeight; // 归一：分母只含在场者
}

/**
 * 四态裁决。规则表顺序固化——**改顺序即改正确性**。
 *
 * @param ballots 含弃权（null）的票集
 * @param refutationsRequired ≥此数票驳倒 = kill 线（也是「有效票够不够裁」的下限）
 */
export function adjudicateClaim(ballots: Ballot[], refutationsRequired: number): Adjudication {
  const valid = ballots.filter((b): b is NonNullable<Ballot> => b !== null);
  const validCount = valid.length;
  const refutedCount = valid.filter((v) => v.refuted).length;
  const composite = computeComposite(ballots);

  // ── 规则表（自上而下，第一条匹配即赢；顺序是正确性的一部分）──
  let verdict: Verdict;
  if (validCount < refutationsRequired) {
    // 规则 1（必须最先）：有效票不足 = 未裁定 ≠ 无人反对。
    // 若把 confirmed 放前面，valid=1/refuted=1 会被「refuted<2」误判 confirmed（OD 排序 bug 的本地版）。
    verdict = "undetermined";
  } else if (refutedCount >= refutationsRequired) {
    // 规则 2：够票驳倒 → 看有无可辩护窄版决定 salvage vs killed。
    const anyNarrow = valid.some((v) => v.refuted && v.hasNarrowVersion);
    verdict = anyNarrow ? "salvage" : "killed";
  } else {
    // 规则 3：有效票够 且 驳倒不足 → confirmed。
    verdict = "confirmed";
  }

  // confidence：仅对 confirmed 有意义——全票撑住→High，分裂（有人驳但不够 kill）→Medium。
  let confidence: Confidence = "Low";
  if (verdict === "confirmed") confidence = refutedCount === 0 ? "High" : "Medium";

  return { verdict, validCount, refutedCount, composite, confidence };
}
