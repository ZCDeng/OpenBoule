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

/** 纯推理 role 禁用的文件系统/执行工具——止 sandbox 空转（R-2）。 */
const FS_TOOLS = ["Bash", "Glob", "Grep", "Read", "Write", "Edit", "NotebookEdit"];

/** Aditly MCP server 名 + researcher 的 web 工具白名单（README always-on 工具，无需平台凭证）。 */
const ADITLY_SERVER = "aditly";
const ADITLY_WEB_TOOLS = [
  `mcp__${ADITLY_SERVER}__anspire_web_search`,
  `mcp__${ADITLY_SERVER}__bocha_web_search`,
  `mcp__${ADITLY_SERVER}__jina_read_url`,
  `mcp__${ADITLY_SERVER}__reach_read_url`,
];

export interface RolePolicy {
  allowedTools: string[];
  disallowedTools: string[];
  allowToolExecution: boolean;
  maxTurns: number;
  watchdogMs: number;
  /** researcher 接 Aditly 时的 MCP server 配置；缺省 undefined。 */
  mcpServers?: Record<string, unknown>;
  /** researcher web 检索是否可用（false → 降级 + fail-loud 标注）。 */
  webEnabled?: boolean;
}

/**
 * role 运行策略（web 场景）：researcher 拿 Aditly web 工具白名单 + 高回合 + 大 watchdog 且真实执行；
 * 纯推理 role 禁文件系统工具、不执行工具、回合少。KTD：路由/超时让代码答（确定性映射），不交给模型。
 */
export function rolePolicy(roleFile: string): RolePolicy {
  if (roleFile === "industry-researcher") {
    const url = config.agent.aditlyMcpUrl.trim();
    const webEnabled = url !== "" && url.toLowerCase() !== "off"; // "off" 显式关闭（optional 不接受空值）
    return {
      allowedTools: webEnabled ? [...ADITLY_WEB_TOOLS] : [],
      disallowedTools: [],
      allowToolExecution: true,
      maxTurns: config.agent.researcherMaxTurns,
      watchdogMs: config.agent.watchdogMs,
      mcpServers: webEnabled ? { [ADITLY_SERVER]: { type: "http", url } } : undefined,
      webEnabled,
    };
  }
  return {
    allowedTools: [],
    disallowedTools: FS_TOOLS,
    allowToolExecution: false,
    maxTurns: config.agent.reasoningMaxTurns,
    watchdogMs: config.agent.watchdogMs,
  };
}

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
    const policy = rolePolicy(roleFile);

    // researcher 无可用 web 工具时 fail-loud：让 agent 在产出里显式标注未联网，不静默假装检索（KTD-5）。
    let systemPrompt = loadRolePrompt(snapshot, roleFile);
    if (roleFile === "industry-researcher" && policy.webEnabled === false) {
      systemPrompt += "\n\n[运行时] 无可用 web 检索工具：基于已有知识作答，并在产出中显式标注「未联网检索」。";
    }

    const result = await runRole(
      {
        jobId: `${spec.workflowId}:${spec.phase}:${spec.role}`,
        role: roleFile,
        systemPrompt,
        task: spec.task || spec.phase,
        model: config.agent.model,
        allowedTools: policy.allowedTools,
        disallowedTools: policy.disallowedTools,
        mcpServers: policy.mcpServers,
        maxTurns: policy.maxTurns,
        allowToolExecution: policy.allowToolExecution,
      },
      {
        hooks: createDbCostHook(insertCost(db, spec.workflowId), { workflowId: spec.workflowId, phase: spec.phase }),
        timeoutMs: policy.watchdogMs,
      },
    );

    // editor 角色：用 U5 语言闸门算 languageGateFailed 喂 Phase 4 放行闸（KTD-21：代码裁决）
    let score: { composite: number; mustFix: number; languageGateFailed: boolean } | undefined;
    if (spec.role.startsWith("editor-")) {
      const gate = languageGate(result.finalText, loadPmConfig(snapshot).jargonPatterns);
      score = { composite: result.ok ? 0.85 : 0, mustFix: 0, languageGateFailed: !gate.passed };
    }

    return { ok: result.ok, text: result.finalText, score, errorCode: result.errorCode };
  };
}
