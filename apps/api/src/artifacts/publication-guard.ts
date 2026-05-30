/**
 * 发布护栏（U6，借鉴 open-design）。html/deck 残留模板占位符 → 拒发 ARTIFACT_PUBLICATION_BLOCKED。
 *
 * 占位符是「未填完的模板」通用标记（待确认 / $X.XM / {{...}}），非真值源方法论词——故默认表内置、可注入覆盖。
 * fail loud：命中即拒，不静默发布半成品给客户。
 */

/** 通用未填占位符（区分大小写匹配 ASCII 占位；中文占位直配）。 */
export const DEFAULT_PLACEHOLDER_PATTERNS: string[] = [
  "待确认",
  "待补充",
  "待定",
  "待填",
  "XX公司",
  "XX集团",
  "某公司",
  "\\$X+(?:\\.X+)?[MKB万亿]?", // $X.XM / $XX / $X.X万
  "\\{\\{[^}]*\\}\\}", // {{placeholder}}
  "\\[\\[[^\\]]*\\]\\]", // [[placeholder]]
  "\\bTODO\\b",
  "\\bTKTK\\b",
  "\\bFIXME\\b",
  "[Xx]{3,}", // XXX / xxx
  "_{3,}", // ___
];

export interface PublicationHit {
  pattern: string;
  match: string;
  index: number;
}

export interface PublicationGuardResult {
  blocked: boolean;
  hits: PublicationHit[];
}

export function checkPublication(
  body: string,
  patterns: string[] = DEFAULT_PLACEHOLDER_PATTERNS,
): PublicationGuardResult {
  const hits: PublicationHit[] = [];
  for (const pattern of patterns) {
    let re: RegExp;
    try {
      re = new RegExp(pattern, "g");
    } catch {
      continue;
    }
    for (const m of body.matchAll(re)) {
      hits.push({ pattern, match: m[0], index: m.index ?? -1 });
    }
  }
  return { blocked: hits.length > 0, hits };
}
