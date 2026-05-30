/** 7+2 phase 展示标签（与后端 state.ts PHASE_IDS 对齐）。 */
export const PHASE_LABELS: { id: string; label: string; note: string }[] = [
  { id: "phase0_init", label: "Phase 0 · 初始化", note: "骨架生成、目录创建" },
  { id: "phase1_intake", label: "Phase 1 · 接案", note: "Subject/Mode/Substance gate + brief" },
  { id: "phase1_5_axis", label: "Phase 1.5 · 轴分解", note: "按 mode 出 3-5 个 axis" },
  { id: "phase2_research", label: "Phase 2 · 调研", note: "并发 researcher fan-out" },
  { id: "phase2_5_verify", label: "Phase 2.5 · 对抗验证", note: "source-verifier 三票裁决" },
  { id: "phase3_synthesis", label: "Phase 3 · 综合", note: "strategy 合成报告" },
  { id: "phase4_review", label: "Phase 4 · 三筛", note: "editor 串行 + 放行闸" },
  { id: "phase5_delivery", label: "Phase 5 · 交付", note: "designer 排版" },
  { id: "phase6_enrichment", label: "Phase 6 · 增益", note: "market-scanner 热点扫描" },
];
