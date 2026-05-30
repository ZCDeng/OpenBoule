/**
 * 生产 AgentRunner（组合根）。把 U4 引擎注入的 phase/role spec wire 到 U2 真值源 + U3 执行器 + U5 闸门。
 *
 * 流程：读 workflow 固化快照 → role 名映射到真值源 role 文件 → loadRolePrompt 当 systemPrompt →
 * runRole（U3，claude-sdk）跑 → usage 落 workflow_costs（U3 cost hook）→ editor 角色用 U5 languageGate
 * 算 languageGateFailed 喂 Phase 4 放行闸。
 *
 * 说明：role 映射是**临时表**（真实 dispatch matrix 是 U5 deferred 的真值源数据表）；composite 用启发占位
 * （真实质量分由 adjudicate/质量评分给）。live 跑需 SDK auth（CLI 会话或 ANTHROPIC_API_KEY，KTD-2）。
 */

import { sql } from "drizzle-orm";
import type { DB } from "../db/client.ts";
import type { TruthSnapshot } from "../truth/types.ts";
import { loadRolePrompt } from "../truth/loader.ts";
import { loadPmConfig } from "../pm/config.ts";
import { languageGate } from "../pm/language-gate.ts";
import { runRole } from "../agents/executor.ts";
import { createDbCostHook } from "../agents/hooks.ts";
import { config } from "../config.ts";
import type { AgentRunner } from "../workflow/phases/index.ts";

/** spec.role / phase → 真值源 role 文件名（临时映射，真实 dispatch matrix 待接入）。 */
export function mapRoleToFile(role: string, phase: string): string {
  if (role.startsWith("researcher-")) return "industry-researcher";
  if (role.startsWith("editor-")) return "editor";
  switch (phase) {
    case "phase0_init":
    case "phase1_intake":
    case "phase1_5_axis":
      return "information-architect";
    case "phase2_research":
      return "industry-researcher";
    case "phase2_5_verify":
      return "source-verifier";
    case "phase3_synthesis":
      return "strategy-advisor";
    case "phase4_review":
      return "editor";
    case "phase5_delivery":
      return "designer";
    case "phase6_enrichment":
      return "market-scanner";
    default:
      return "information-architect";
  }
}

async function loadSnapshot(db: DB, workflowId: string): Promise<TruthSnapshot> {
  const res = await db.execute(sql`SELECT truth_snapshot AS "s" FROM workflows WHERE id = ${workflowId}`);
  const snap = (res as unknown as { rows?: { s: TruthSnapshot }[] }).rows?.[0]?.s;
  if (!snap) throw new Error(`workflow ${workflowId} 无真值源快照`);
  return snap;
}

/** 落一行 workflow_costs（U3 cost hook 的 insert 实现）。 */
function insertCost(db: DB, workflowId: string) {
  return async (row: {
    phase: string | null;
    jobId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costUsd: string;
  }) => {
    await db.execute(sql`
      INSERT INTO workflow_costs (workflow_id, phase, job_id, model, input_tokens, output_tokens, cache_read_tokens, cost_usd)
      VALUES (${workflowId}, ${row.phase}, ${row.jobId}, ${row.model}, ${row.inputTokens}, ${row.outputTokens}, ${row.cacheReadTokens}, ${row.costUsd})`);
  };
}

export function makeProductionAgentRunner(db: DB): AgentRunner {
  return async (spec) => {
    const snapshot = await loadSnapshot(db, spec.workflowId);
    const roleFile = mapRoleToFile(spec.role, spec.phase);
    const systemPrompt = loadRolePrompt(snapshot, roleFile);

    const result = await runRole(
      {
        jobId: `${spec.workflowId}:${spec.phase}:${spec.role}`,
        role: roleFile,
        systemPrompt,
        task: spec.task || spec.phase,
        model: config.agent.model,
      },
      {
        hooks: createDbCostHook(insertCost(db, spec.workflowId), { workflowId: spec.workflowId, phase: spec.phase }),
      },
    );

    // editor 角色：用 U5 语言闸门算 languageGateFailed 喂 Phase 4 放行闸（KTD-21：代码裁决）
    let score: { composite: number; mustFix: number; languageGateFailed: boolean } | undefined;
    if (spec.role.startsWith("editor-")) {
      const gate = languageGate(result.finalText, loadPmConfig(snapshot).jargonPatterns);
      score = { composite: result.ok ? 0.85 : 0, mustFix: 0, languageGateFailed: !gate.passed };
    }

    return { ok: result.ok, text: result.finalText, score };
  };
}
