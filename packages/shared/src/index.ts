/**
 * @boule/shared — 前后端共享类型。
 *
 * 占位：具体类型随其消费 IU 落地——
 *   types/workflow.ts (U4) / phase.ts (U4) / agent.ts (U3) / cost.ts (U6) / share.ts (U10)
 * U1 仅建包，使 pnpm workspace 解析通过。
 */

/** workflow 状态机四态（与 DB workflow_status enum 对齐，真值源在 apps/api/src/db/schema.ts）。 */
export type WorkflowStatus =
  | "running"
  | "paused_for_approval"
  | "approved"
  | "rejected";

/** 项目 RBAC 四级角色（KTD-12）。 */
export type MemberRole = "owner" | "editor" | "viewer" | "external";
