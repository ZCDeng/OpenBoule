# Boule 跟随 consulting-team v2.5：落地 Phase 3.5 评审合议

> 状态：执行中 · 2026-06-05
> 触发：consulting-team `2cfdabb feat: 新增强制 Phase 3.5 实质评审合议 + 返工回路`
> 决策：用户拍板「完整落地(引擎+web+文档)」「10 阶段/7+3」「8 文件全改」

## 背景

consulting-team v2.5 在 Phase 3(strategy v1)与 Phase 4(三筛润色)之间插入**强制 Phase 3.5
实质评审**：`consulting-review-panel` workflow 跑 5 视角实质评审 → 3 票四态对抗验证 → 主审合议，
按 readiness 三分支 gate(ship/revise/rework)，rework 退回 Phase 3 重写、人确认、2 轮上限。

Boule 是 consulting-team 方法论的 Web 化产品。`PHASE_LABELS`(前端)与 `PHASE_IDS`(后端)
是双职责共享真值源——既驱动营销/方法论展示，也驱动实时工作台状态。所以"跟随"必须连引擎一起改，
否则前端会出现后端永不激活的幽灵阶段。

## 引擎映射设计

- **新 PhaseKind `panel`**：一个 job 内跑 N=5 视角评审 → 纯函数合议裁决。类比现有 `serial`
  (phase4 一个 job 内跑 3 editor + 放行闸)。
- **新 CheckpointDecision `rework`**：固定 backward 跳转退回 `phase3_synthesis`。复用 `augment`
  (固定退回 phase2)的"人确认 + 新 attempt"模式。不自动循环——每次 rework 都是 checkpoint 上的
  人决策，人就是循环上限(对齐 consulting-team「rework 退回必须人确认，不自动循环」)。
- **lineage**：`downstreamPhases` 是 index-based(按 PHASE_IDS 顺序切片)，插入 phase id 后
  自动把 phase3_5_review 纳入 phase3 的下游，无需改逻辑。
- **前端**：除 `phases.ts` 加一行外，Timeline/Workspace/DocumentList/CostChart/MethodologyGraph/
  derive/labels/ProjectDetail 都泛型消费 PHASE_LABELS，自动跟随。

## 改动清单

### 后端(基座，先行)
1. `apps/api/src/workflow/state.ts`
   - PHASE_IDS 插 `phase3_5_review`(phase3_synthesis 与 phase4_review 之间)
   - PhaseKind 加 `"panel"`；KIND_OVERRIDE 加 `phase3_5_review: "panel"`
   - CheckpointDecision 加 `"rework"`；resolveNextPhase 加 rework 分支(仅 phase3_5_review→phase3_synthesis)
   - 新增 `evaluateReviewPanel(lenses): PanelVerdict`(ship/revise/rework 三分支纯函数)+ 类型
2. `apps/api/src/workflow/phases/index.ts` — `runReviewPanel`(类比 runSerialReview)+ REVIEW_LENSES
3. `apps/api/src/workflow/engine.ts` — JOB_PANEL + processPanel + enqueue 映射 + `rework()` 方法
4. `apps/api/src/services/agent-runner.ts` — mapRoleToFile：`reviewer-*`/phase3_5_review→source-verifier；
   reviewer-* 也产 score 占位
5. `apps/api/src/routes/approvals.ts` — decisions 加 `"rework"`

### 后端测试(测意图)
- state.test.ts(图连通/kind/rework/panel gate)、lineage.test.ts(下游含 3.5)、
  cost-calc.test.ts(phases 数组)、engine.test.ts + e2e.test.ts(10 phase 按序)、
  lineage-lock.test.ts(downstream)

### 前端(对外叙事 + 实时状态)
- `apps/web/src/lib/phases.ts` — 加 phase3_5_review 行；注释 7+2→7+3
- `apps/web/src/pages/Methodology.tsx` — PHASE_META 加项；9→10 阶段、7+2→7+3、badge/文案
- `apps/web/src/pages/Landing.tsx` — hero/badge/CAPABILITIES/RUNTIME/METHOD_KEY/section 标题数字

### 文档/图
- `README.md` — 9→10、7+2→7+3、能力矩阵/阶段叙事加 Phase 3.5
- `boule-pipeline.svg` / `boule-pipeline-brutalist.svg` — 加 Phase 3.5 节点 + 标题计数
- `_design/landing-brutalist-demo.html` / `console-workbench-demo.html` — 同步文案

## 成功标准
- `pnpm --filter @boule/api test` 全绿(状态机/lineage/engine/e2e 断言 10 phase)
- `pnpm --filter @boule/web build` 通过
- 全站文案无残留"9 阶段"/"7+2"；实时工作台无幽灵阶段(后端真跑 phase3_5_review)
</content>
</invoke>
