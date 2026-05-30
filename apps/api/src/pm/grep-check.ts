/**
 * grep 自检（U5 / SKILL.md §纪律1 "关键约束主线程 grep 一遍"）。
 *
 * 黑话清单从真值源（config.jargonPatterns）来，**不硬编码**。两段式 flag（KTD-21）：
 * 单次命中只记 flag 不阻断；聚合层把「任何 flag = 这份产物不 protocol-clean」。
 * 阻断与否由调用方决定（language-gate 是硬阻断版，见 language-gate.ts）。
 */

export interface JargonHit {
  /** 命中的真值源正则备选项原文。 */
  pattern: string;
  /** 实际命中的子串。 */
  match: string;
  /** 命中位置（字符 index）。 */
  index: number;
}

/** 用真值源正则备选项扫文本，返回全部命中（区分大小写，镜像 grep -E 无 -i）。 */
export function scanJargon(text: string, patterns: string[]): JargonHit[] {
  const hits: JargonHit[] = [];
  for (const pattern of patterns) {
    let re: RegExp;
    try {
      re = new RegExp(pattern, "g");
    } catch {
      continue; // 真值源里若有非法正则片段，跳过该条（其余照扫）
    }
    for (const m of text.matchAll(re)) {
      hits.push({ pattern, match: m[0], index: m.index ?? -1 });
    }
  }
  return hits;
}

export interface GrepCheckResult {
  hits: JargonHit[];
  /** 两段式聚合：任一命中 → 非 protocol-clean。 */
  protocolClean: boolean;
}

export function grepCheck(text: string, patterns: string[]): GrepCheckResult {
  const hits = scanJargon(text, patterns);
  return { hits, protocolClean: hits.length === 0 };
}
