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
import type { NormalizedEvent } from "../agents/event-types.ts";
import type { RoleContext } from "../agents/types.ts";
import { config } from "../config.ts";
import { providerToMcpServers, resolveSearchProviderChain, selectFirstConfiguredSearchProvider } from "./search-providers.ts";
import { resolveSafeCwd } from "./git-link.ts";
import type { AgentRunner } from "../workflow/phases/index.ts";

// 纯推理 role 禁用的内建工具——止 sandbox 空转（R-2）。
// 注：本 SDK「空 allowedTools = 全部工具」，故必须显式 deny（非冗余）；覆盖 文件系统/执行/联网/子代理。
const FS_TOOLS = ["Bash", "Glob", "Grep", "Read", "Write", "Edit", "NotebookEdit", "WebFetch", "WebSearch", "Task"];

/** 需要 web 检索能力的 role（接 Aditly）。新增 web role 在此加一行即可。 */
const WEB_ROLES = new Set(["industry-researcher"]);

export interface RolePolicy {
  allowedTools: string[];
  disallowedTools: string[];
  allowToolExecution: boolean;
  maxTurns: number;
  watchdogMs: number;
  /** researcher 接选中的 web search MCP server 配置；缺省 undefined。 */
  mcpServers?: Record<string, unknown>;
  /** researcher web 检索是否可用（false → 降级 + fail-loud 标注）。 */
  webEnabled?: boolean;
}

/**
 * role 运行策略（web 场景）：researcher 拿选中 provider 的 web 工具白名单 + 高回合 + 大 watchdog 且真实执行；
 * 纯推理 role 禁文件系统工具、不执行工具、回合少。KTD：路由/超时让代码答（确定性映射），不交给模型。
 */
function baseReasoningPolicy(): RolePolicy {
  return {
    allowedTools: [],
    disallowedTools: FS_TOOLS,
    allowToolExecution: false,
    maxTurns: config.agent.reasoningMaxTurns,
    watchdogMs: config.agent.watchdogMs,
  };
}

function webRolePolicyFromProvider(provider: ReturnType<typeof selectFirstConfiguredSearchProvider>["selected"]): RolePolicy {
  const webEnabled = Boolean(provider);
  return {
    allowedTools: provider?.tools ?? [],
    disallowedTools: [],
    allowToolExecution: true,
    maxTurns: config.agent.researcherMaxTurns,
    watchdogMs: config.agent.watchdogMs,
    mcpServers: providerToMcpServers(provider),
    webEnabled,
  };
}

/**
 * 仅供测试使用：跳过联网 provider 的 pre-flight probe，直接取第一个已配置 provider。
 * 生产路径用 rolePolicyWithSearchProbe（带 probe）。请勿删除——测试依赖它。
 */
export function rolePolicy(roleFile: string): RolePolicy {
  if (!WEB_ROLES.has(roleFile)) return baseReasoningPolicy();
  return webRolePolicyFromProvider(selectFirstConfiguredSearchProvider().selected);
}

export async function rolePolicyWithSearchProbe(roleFile: string): Promise<RolePolicy> {
  if (!WEB_ROLES.has(roleFile)) return baseReasoningPolicy();
  return webRolePolicyFromProvider((await resolveSearchProviderChain()).selected);
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

/** U4：查 workflow 所属 project 的 git-linked localDir（未链接返回 null）。 */
async function loadLinkedBaseDir(db: DB, workflowId: string): Promise<string | null> {
  const res = await db.execute(sql`
    SELECT p.local_base_dir AS "dir" FROM workflows w JOIN projects p ON p.id = w.project_id
     WHERE w.id = ${workflowId} AND p.link_mode = 'localDir'`);
  return (res as unknown as { rows?: { dir: string | null }[] }).rows?.[0]?.dir ?? null;
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

function truncateSummary(text: string, max = 160): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

export function normalizeAgentProgressEvent(
  ev: NormalizedEvent,
  ctx: RoleContext,
  meta: { workflowId: string; phase: string | null },
): Record<string, unknown> | null {
  const base = {
    jobId: ctx.jobId,
    phase: meta.phase,
    role: ctx.role,
    model: ctx.model,
    type: ev.type,
  };

  switch (ev.type) {
    case "thinking_delta":
      return null;
    case "text_delta":
      // text_delta 高频且低信息密度；runRole 会 await 每个 hook，逐 chunk 写 DB 会拖慢流式执行并污染 SSE 回放日志。
      // 最终文本仍由 phase artifact 持久化；实时流只保留状态/工具/用量等可审计事件。
      return null;
    case "tool_use":
      return { ...base, toolName: ev.name, toolUseId: ev.id, summary: `调用工具 ${ev.name}` };
    case "tool_result":
      return {
        ...base,
        toolUseId: ev.toolUseId,
        isError: ev.isError,
        summary: ev.isError ? "工具返回错误" : "工具返回结果",
      };
    case "usage":
      return {
        ...base,
        usage: {
          inputTokens: ev.inputTokens,
          outputTokens: ev.outputTokens,
          cacheReadTokens: ev.cacheReadTokens,
        },
        summary: `Token 用量 input ${ev.inputTokens} / output ${ev.outputTokens}`,
      };
    case "status": {
      const detail = typeof ev.detail?.message === "string" ? `：${truncateSummary(ev.detail.message)}` : "";
      return { ...base, status: ev.phase, summary: `Agent ${ev.phase}${detail}` };
    }
  }
}

function appendAgentProgressEvent(db: DB, workflowId: string) {
  return async (data: Record<string, unknown>) => {
    await db.execute(sql`
      INSERT INTO workflow_events (run_id, event, data)
      VALUES (${workflowId}, 'agent-progress', ${JSON.stringify(data)}::jsonb)
    `);
  };
}

export function makeProductionAgentRunner(db: DB): AgentRunner {
  return async (spec) => {
    const snapshot = await loadSnapshot(db, spec.workflowId);
    const roleFile = mapRoleToFile(spec.role, spec.phase);
    const policy = await rolePolicyWithSearchProbe(roleFile);

    // web role 无可用检索工具时 fail-loud：让 agent 在产出里显式标注未联网，不静默假装检索（KTD-5）。
    // webEnabled 仅 web role 才置（reasoning role 为 undefined），故 === false 精确命中「web role 且关闭」。
    let systemPrompt = loadRolePrompt(snapshot, roleFile);
    if (policy.webEnabled === false) {
      systemPrompt += "\n\n[运行时] 无可用 web 检索工具：基于已有知识作答，并在产出中显式标注「未联网检索」。";
    }
    // phase1.5 轴分解：约定末尾输出结构化 axes 块，供系统解析持久化并透传给 phase2 researcher（task-threading）。
    if (spec.phase === "phase1_5_axis") {
      systemPrompt +=
        '\n\n[运行时] 在产出末尾追加一个 ```json 代码块，形如 {"axes":[{"axis":"轴名","frame":"可选视角","lanes":["可选lane"]}]}，逐条列出本次分解的调研轴，供系统解析。';
    }

    // U4 Git-linked：执行型 role 且项目链接了本地 repo 时，cwd 指向真实目录 + 锁子树。
    // 执行前再校验（resolveSafeCwd，防 TOCTOU）；校验失败即抛，不在不安全目录里跑。
    let cwd: string | undefined;
    if (policy.allowToolExecution) {
      const baseDir = await loadLinkedBaseDir(db, spec.workflowId);
      if (baseDir) cwd = await resolveSafeCwd(baseDir);
    }

    const costHook = createDbCostHook(insertCost(db, spec.workflowId), { workflowId: spec.workflowId, phase: spec.phase });
    const appendProgress = appendAgentProgressEvent(db, spec.workflowId);

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
        ...(cwd ? { cwd, additionalDirectories: [cwd] } : {}),
      },
      {
        hooks: {
          async onEvent(ev, ctx) {
            const data = normalizeAgentProgressEvent(ev, ctx, { workflowId: spec.workflowId, phase: spec.phase });
            if (data) await appendProgress(data);
          },
          async onUsage(usage, ctx) {
            await costHook.onUsage?.(usage, ctx);
          },
        },
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
