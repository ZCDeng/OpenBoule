/**
 * 执行器（U3）。消费**归一化事件流**——记账 / hooks / 超时 watchdog / finalText 累积，
 * 与具体 runtime 无关（claude-sdk 还是 messages-api 都走这一份）。只写一遍。
 */

import { selectRuntime, type BouleRoleRuntime } from "./runtime.ts";
import { classifyError, type AgentErrorCode } from "./errors.ts";
import { emptyCounts } from "./event-types.ts";
import type { RuntimeHooks, Usage } from "./hooks.ts";
import type { RoleContext, RoleResult, RuntimeKind } from "./types.ts";

export interface RunRoleOptions {
  runtime?: RuntimeKind; // 默认 claude-sdk
  hooks?: RuntimeHooks;
  timeoutMs?: number; // 无事件 watchdog（默认 300s；生产由 agent-runner 按 role 策略覆盖）
  /** 注入 runtime（测试用 mock；省略则按 runtime kind 选）。 */
  runtimeImpl?: BouleRoleRuntime;
}

const TIMEOUT = Symbol("timeout");

function raceNext<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(TIMEOUT), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export async function runRole(ctx: RoleContext, opts: RunRoleOptions = {}): Promise<RoleResult> {
  const runtime = opts.runtimeImpl ?? (await selectRuntime(opts.runtime ?? "claude-sdk"));
  const timeoutMs = opts.timeoutMs ?? 300_000;

  const counts = emptyCounts();
  const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  let finalText = "";
  let ok = false;
  let errorCode: AgentErrorCode | undefined;

  const it = runtime.run(ctx)[Symbol.asyncIterator]();
  try {
    while (true) {
      let step: IteratorResult<import("./event-types.ts").NormalizedEvent> | typeof TIMEOUT;
      try {
        step = await raceNext(it.next(), timeoutMs);
      } catch (err) {
        errorCode = classifyError(err);
        break;
      }
      if (step === TIMEOUT) {
        errorCode = "TERMINATED_UNKNOWN";
        // 不可 await：若 runtime 卡在永不 resolve 的 await，it.return() 也永不 resolve。
        // fire-and-forget 清理，executor 立即返回（watchdog 的全部意义）。
        void Promise.resolve(it.return?.(undefined as never)).catch(() => {});
        break;
      }
      if (step.done) break;

      const ev = step.value;
      counts[ev.type]++;
      if (ev.type === "text_delta") finalText += ev.text;
      else if (ev.type === "usage") {
        usage.inputTokens = Math.max(usage.inputTokens, ev.inputTokens);
        usage.outputTokens = Math.max(usage.outputTokens, ev.outputTokens);
        usage.cacheReadTokens = Math.max(usage.cacheReadTokens, ev.cacheReadTokens);
      } else if (ev.type === "status") {
        if (ev.phase === "completed") ok = true;
        else if (ev.phase === "failed") {
          ok = false;
          errorCode = classifyError({
            type: "result",
            error: ev.detail?.errorEnum,
            subtype: ev.detail?.subtype,
            status: ev.detail?.status,
          });
        }
      }
      await opts.hooks?.onEvent?.(ev, ctx);
    }
  } finally {
    // 最终 usage 一次归账（不管成功失败，已花的 token 都要记）
    await opts.hooks?.onUsage?.(usage, ctx);
  }

  return { jobId: ctx.jobId, runtime: runtime.kind, ok, finalText, counts, usage, errorCode };
}
