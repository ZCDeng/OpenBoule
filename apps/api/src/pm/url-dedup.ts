/**
 * 跨路 URL 去重 + 抓取预算（U5 / SKILL.md §"Phase 2 跨路 URL 去重"）。
 *
 * 解决真问题：N 路 researcher 各自引到同几个热门源 → 表面多源、实为同一 URL 被引 N 次 →
 * strategy 误判「一个源」为「行业共识」。normURL 归一后去重，按 normURL 计独立信源数。
 *
 * 三条硬规则（原样落地）：
 * 1. 重复 URL 不删 finding，标 source_shared_with（让 cross-cutting 看到「同源不是两个独立证据」）
 * 2. 信源去重计数按 normURL 算，不按 finding 条数算
 * 3. 透明丢弃不静默截断：dupes / budget_dropped 全部上报（deep-research 纪律 no silent caps）
 */

import type { Finding, Importance } from "./types.ts";

/** 归一化 URL：去 www 前缀 + 去尾斜杠 + 小写。解析失败退回原串小写（fail soft，但不丢）。 */
export function normURL(u: string): string {
  try {
    const p = new URL(u);
    const host = p.hostname.replace(/^www\./, "");
    const path = p.pathname.replace(/\/+$/, "");
    return (host + path).toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

const IMPORTANCE_RANK: Record<Importance, number> = { central: 0, supporting: 1, tangential: 2 };

export interface DedupedFinding extends Finding {
  /** 同源首次出现位置（重复引用标记，不删 finding）。 */
  sourceSharedWith?: { axis: string; frame?: string };
}

export interface DedupResult {
  /** 全部 finding（含被标 source_shared_with 的重复项；超预算丢弃的不在此列）。 */
  findings: DedupedFinding[];
  /** 去重后独立信源数（normURL 唯一键数）——strategy 算「几个独立信源」用这个。 */
  uniqueSources: number;
  /** 被合并的重复引用数。 */
  dupeCount: number;
  /** 超预算被丢弃的低 importance 源（透明上报，不静默截断）。 */
  budgetDropped: DedupedFinding[];
}

/**
 * 去重 + 预算。central 先占预算（按 importance 稳定排序），同源后到者标 source_shared_with，
 * 预算满后非 central 透明丢弃。输入顺序内的稳定性：同 importance 保持入参相对序。
 */
export function dedupeSources(all: Finding[], fetchBudget: number): DedupResult {
  // central 先占预算：稳定排序（Array.prototype.sort 在 V8 稳定）
  const sorted = [...all].sort((a, b) => IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance]);

  const seen = new Map<string, { axis: string; frame?: string }>();
  const findings: DedupedFinding[] = [];
  const budgetDropped: DedupedFinding[] = [];
  let dupeCount = 0;

  for (const f of sorted) {
    const key = normURL(f.sourceUrl);
    const firstSeen = seen.get(key);
    if (firstSeen) {
      // 规则 1：不删，标同源首位
      findings.push({ ...f, sourceSharedWith: firstSeen });
      dupeCount++;
      continue;
    }
    // 规则 3：预算满且非 central → 透明丢弃
    if (seen.size >= fetchBudget && f.importance !== "central") {
      budgetDropped.push({ ...f });
      continue;
    }
    seen.set(key, { axis: f.axis, frame: f.frame });
    findings.push({ ...f });
  }

  return { findings, uniqueSources: seen.size, dupeCount, budgetDropped };
}
