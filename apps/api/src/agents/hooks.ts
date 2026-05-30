/**
 * 执行器 hooks（U3）。usage 事件一处记账到 `workflow_costs`（不管哪个 runtime，KTD-22）。
 *
 * ⚠️ pricing 是占位值——**结算真值**的 cost-calc / 权威单价表是 U5/U6（KTD-22）。
 * 这里只为 U3 把 token→$ 的 hook 形态跑通；真单价随 U6 接入。
 */

import type { NormalizedEvent } from "./event-types.ts";
import type { RoleContext } from "./types.ts";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface RuntimeHooks {
  /** 每个归一化事件（SSE 推送 / 落 workflow_events 在 U4/U6 接）。 */
  onEvent?(ev: NormalizedEvent, ctx: RoleContext): void | Promise<void>;
  /** 执行结束的最终 usage（一次），用于成本归账。 */
  onUsage?(usage: Usage, ctx: RoleContext): void | Promise<void>;
}

/** 占位单价（USD / 每 token）。真值表见 U6。 */
const PRICING: Record<string, { in: number; out: number; cacheRead: number }> = {
  default: { in: 15 / 1e6, out: 75 / 1e6, cacheRead: 1.5 / 1e6 },
  sonnet: { in: 3 / 1e6, out: 15 / 1e6, cacheRead: 0.3 / 1e6 },
  haiku: { in: 0.8 / 1e6, out: 4 / 1e6, cacheRead: 0.08 / 1e6 },
};

export function computeCostUsd(model: string, u: Usage): number {
  const key = /haiku/i.test(model) ? "haiku" : /sonnet/i.test(model) ? "sonnet" : "default";
  const p = PRICING[key]!;
  return u.inputTokens * p.in + u.outputTokens * p.out + u.cacheReadTokens * p.cacheRead;
}

/** 测试/累加用：把每次 onUsage 累加，便于断言归账。 */
export function createInMemoryCostHook(): {
  hook: RuntimeHooks;
  records: { jobId: string; model: string; usage: Usage; costUsd: number }[];
} {
  const records: { jobId: string; model: string; usage: Usage; costUsd: number }[] = [];
  return {
    records,
    hook: {
      onUsage(usage, ctx) {
        records.push({ jobId: ctx.jobId, model: ctx.model, usage, costUsd: computeCostUsd(ctx.model, usage) });
      },
    },
  };
}

/**
 * 生产 cost hook：最终 usage 落一行 workflow_costs。
 * db 用 any 以免 U3 强耦合 drizzle 类型；U4/U6 wire 时传入真 db + 真 workflowId。
 */
export function createDbCostHook(
  insertCost: (row: {
    workflowId: string;
    phase: string | null;
    jobId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    costUsd: string;
  }) => Promise<void>,
  meta: { workflowId: string; phase: string | null },
): RuntimeHooks {
  return {
    async onUsage(usage, ctx) {
      await insertCost({
        workflowId: meta.workflowId,
        phase: meta.phase,
        jobId: ctx.jobId,
        model: ctx.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        costUsd: computeCostUsd(ctx.model, usage).toFixed(6),
      });
    },
  };
}
