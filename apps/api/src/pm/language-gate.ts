/**
 * 语言闸门（U5 / SKILL.md §纪律16 "内部工作语言 ≠ 客户交付语言"）。
 *
 * Phase 4 editor filter-1 之后，对**客户交付物**（report.html/pdf/deck 正文）跑硬闸门：
 * 命中任一流程黑话即 fail（客户版必须零流程黑话）。这是 v2 宇润项目客户反馈倒逼的硬纪律。
 *
 * 与 grep-check 的区别：grep-check 是通用两段式自检（记 flag 不一定阻断）；
 * language-gate 是 Phase 4 的硬阻断版——任一 hit = 闸门未过，喂给 U4 放行闸的 languageGateFailed。
 */

import { scanJargon, type JargonHit } from "./grep-check.ts";

export interface LanguageGateResult {
  /** 客户交付物是否过闸（零流程黑话）。 */
  passed: boolean;
  hits: JargonHit[];
  /** 命中黑话去重列表（供 checkpoint 显示「退回重清哪些词」）。 */
  offendingTerms: string[];
}

/** 对客户交付物正文跑语言闸门。patterns 来自真值源 config.jargonPatterns。 */
export function languageGate(clientText: string, patterns: string[]): LanguageGateResult {
  const hits = scanJargon(clientText, patterns);
  const offendingTerms = [...new Set(hits.map((h) => h.match))];
  return { passed: hits.length === 0, hits, offendingTerms };
}
