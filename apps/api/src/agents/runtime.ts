/**
 * Role 执行器抽象（U3 / KTD-17）。
 *
 * 抽象边界 = "产出归一化事件流"，不在"如何调后端"。SDK 不稳时切 messages-api 是换 def，
 * executor / 记账 / 超时 / 落库只消费 NormalizedEvent，与 runtime 无关。
 */

import type { NormalizedEvent } from "./event-types.ts";
import type { RoleContext, RuntimeKind } from "./types.ts";

export interface BouleRoleRuntime {
  readonly kind: RuntimeKind;
  /** 按需执行一次 role，吐归一化事件流。每次调用是独立会话（按需 spawn，无连接池）。 */
  run(ctx: RoleContext): AsyncIterable<NormalizedEvent>;
}

/** 工厂：按 kind 懒加载对应 runtime（避免用 messages-api 时也加载 SDK）。 */
export async function selectRuntime(kind: RuntimeKind): Promise<BouleRoleRuntime> {
  if (kind === "claude-sdk") {
    const { ClaudeSdkRuntime } = await import("./runtimes/claude-sdk.ts");
    return new ClaudeSdkRuntime();
  }
  const { MessagesApiRuntime } = await import("./runtimes/messages-api.ts");
  return new MessagesApiRuntime();
}
