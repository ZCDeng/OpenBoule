/**
 * PM 配置解析（U5）——从真值源 SKILL.md / editor.md 解析，**不硬编码**。
 *
 * 纪律：流程黑话清单是「黑话列表从真值源读」的硬要求（plan U5 / SKILL.md §纪律16）。
 * 解析不到 = fail loud 抛错，绝不静默退回空表（空表会让 language-gate 永远放行 = 静默失效）。
 * 阈值（FETCH_BUDGET / VERIFY_CAP / REFUTATIONS_REQUIRED）同样从 SKILL.md 解析，缺失即抛。
 *
 * 解析对象是真值源固化快照里的原文，随 skill 演进自动跟随（方法论变化不改代码）。
 */

import type { TruthSnapshot } from "../truth/types.ts";

export interface PmConfig {
  fetchBudget: number;
  verifyCap: number;
  refutationsRequired: number;
  /** 流程黑话正则备选项（来自 editor.md filter-1 的 grep -noE 清单，原样保留含 H[1-5]\.[0-9] 等）。 */
  jargonPatterns: string[];
}

function parseIntVar(skillMd: string, name: string): number {
  const m = skillMd.match(new RegExp(`^\\s*${name}\\s*=\\s*(\\d+)`, "m"));
  if (!m) throw new Error(`SKILL.md 未找到 ${name}（真值源结构变更？解析 fail loud，不静默默认）`);
  return Number(m[1]);
}

/**
 * 从 editor.md 抽 filter-1 流程黑话 grep 的正则备选项。
 * 锚定那条同时含 axis / basis / cohort 的 `grep -noE '<regex>' ...report.html`（filter-1 核心关口）。
 */
export function parseJargonPatterns(editorMd: string): string[] {
  // 逐行找 grep -noE '...'，挑含 axis|basis|cohort 的那条（区别于 basis-tag 统计的另一条 grep）
  for (const line of editorMd.split("\n")) {
    const m = line.match(/grep\s+-\w*E?\w*\s+'([^']+)'/);
    if (!m) continue;
    const regex = m[1]!;
    if (/axis/.test(regex) && /basis/.test(regex) && /cohort/.test(regex)) {
      const parts = regex.split("|").map((s) => s.trim()).filter(Boolean);
      if (parts.length < 3) break; // 异常短，落到下方抛错
      return parts;
    }
  }
  throw new Error("editor.md 未找到 filter-1 流程黑话 grep 清单（真值源结构变更？不硬编码兜底，fail loud）");
}

/** 纯解析：两份真值源原文 → 配置。 */
export function parsePmConfig(skillMd: string, editorMd: string): PmConfig {
  return {
    fetchBudget: parseIntVar(skillMd, "FETCH_BUDGET"),
    verifyCap: parseIntVar(skillMd, "VERIFY_CAP"),
    refutationsRequired: parseIntVar(skillMd, "REFUTATIONS_REQUIRED"),
    jargonPatterns: parseJargonPatterns(editorMd),
  };
}

/** 从固化快照装配置（生产路径；SKILL.md + roles/editor.md 必须在快照里）。 */
export function loadPmConfig(snapshot: TruthSnapshot): PmConfig {
  const skillMd = snapshot.contents["skills/SKILL.md"];
  const editorMd = snapshot.contents["skills/roles/editor.md"];
  if (skillMd === undefined) throw new Error("快照缺 skills/SKILL.md");
  if (editorMd === undefined) throw new Error("快照缺 skills/roles/editor.md");
  return parsePmConfig(skillMd, editorMd);
}
