/** 7+3 阶段展示标签（与后端 state.ts PHASE_IDS 对齐）。
 *  label/note 是面向用户的中文文案，不出现内部角色码与流程黑话；
 *  num 供 UI 直接取阶段编号（不要再用正则从 label 里抠）。 */
export const PHASE_LABELS: { id: string; num: string; label: string; note: string }[] = [
  { id: "phase0_init", num: "0", label: "阶段 0 · 准备", note: "建立项目结构与目录" },
  { id: "phase1_intake", num: "1", label: "阶段 1 · 接案", note: "明确主题、模式与内容范围" },
  { id: "phase1_5_axis", num: "1.5", label: "阶段 1.5 · 拆解维度", note: "按场景拆出 3–5 个分析维度" },
  { id: "phase2_research", num: "2", label: "阶段 2 · 调研", note: "多线并行调研" },
  { id: "phase2_5_verify", num: "2.5", label: "阶段 2.5 · 交叉验证", note: "多方核证形成结论" },
  { id: "phase3_synthesis", num: "3", label: "阶段 3 · 综合", note: "形成报告初稿" },
  { id: "phase3_5_review", num: "3.5", label: "阶段 3.5 · 评审合议", note: "五视角实质评审，方案级把关" },
  { id: "phase4_review", num: "4", label: "阶段 4 · 三道审校", note: "逐道质量校验，含信息有效性审查" },
  { id: "phase5_delivery", num: "5", label: "阶段 5 · 交付", note: "成稿排版，可选交互件" },
  { id: "phase6_enrichment", num: "6", label: "阶段 6 · 补强", note: "行业热点扫描" },
];
