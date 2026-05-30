/**
 * 确定性 PM 逻辑共享类型（U5）。
 *
 * 这些是 invariant helper 的输入/输出契约——不随 skill 方法论演进而变（方法论变化走真值源 config）。
 */

/** finding 的承重等级（SKILL.md：central 先占预算/先验证）。 */
export type Importance = "central" | "supporting" | "tangential";

/** 一条研究 finding（researcher 产出的最小单位，去重/coverage/验证都以它为粒度）。 */
export interface Finding {
  axis: string;
  frame?: string;
  sourceUrl: string;
  importance: Importance;
  /** basis 标签（direct/external/reasoned/simulated）——grep 自检用。 */
  basis?: string;
  /** 该 finding 命中的 lane（coverage lane gap 判定用）。 */
  lane?: string;
}

/** 一票对抗验证裁决（source-verifier voter 自报；代码只取 refuted 布尔，advisory 字段不作数）。 */
export interface VerifierVote {
  /** voter 自报是否驳倒（缺省立场 refuted=true，见 role 文件）。 */
  refuted: boolean;
  /** voter 是否给出可辩护窄版（salvage 判定线索；evidence 文本由 PM 判，不在此结构裁）。 */
  hasNarrowVersion?: boolean;
  /** voter 自报结论/分数——advisory，代码裁决不采信（KTD-21）。 */
  selfReportedVerdict?: string;
}

/** 缺席用 null 表示（弃权，不计入有效票，不拉偏归一）。 */
export type Ballot = VerifierVote | null;
