/**
 * Boule 数据层 — 真值源（U1）。
 *
 * Drizzle TS schema 是 schema 的唯一真值源；SQL 迁移由 `drizzle-kit generate` 派生
 * （故不手写 schema.sql——避免两份 schema 真值打架）。12 表覆盖状态机、可靠性、
 * 成本、SSE 回放、checkpoint surface、RBAC、签名分享。
 *
 * 相关决策：KTD-3（状态机）/ KTD-12（RBAC）/ KTD-18（surface）/ KTD-19（事件日志）/
 *          KTD-13（opaque token）/ U4（phase_attempts 可靠性）。
 */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  bigserial,
  jsonb,
  timestamp,
  numeric,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ── 枚举 ──
export const workflowStatus = pgEnum("workflow_status", [
  "running",
  "paused_for_approval",
  "approved",
  "rejected",
]);
export const memberRole = pgEnum("member_role", [
  "owner",
  "editor",
  "viewer",
  "external",
]);
export const attemptStatus = pgEnum("attempt_status", [
  "leased",
  "running",
  "completed",
  "failed",
]);
export const surfaceStatus = pgEnum("surface_status", [
  "pending",
  "resolved",
  "timeout",
  "invalidated",
]);
export const artifactStatus = pgEnum("artifact_status", [
  "draft",
  "below_threshold",
  "published",
]);

// ── 1. users ──
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── 2. projects ──
export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ── 3. project_members（RBAC，KTD-12）──
export const projectMembers = pgTable(
  "project_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("project_members_project_user_uniq").on(t.projectId, t.userId),
  ],
);

// ── 4. workflows（状态机真值源，KTD-3）──
export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    currentPhase: text("current_phase").notNull().default("phase0_init"),
    status: workflowStatus("status").notNull().default("running"),
    mode: text("mode"),
    axes: jsonb("axes"),
    checkpointData: jsonb("checkpoint_data"),
    // 创建时固化的不可变快照（U2）：commit_sha + manifest + truth_digest。所有 phase/retry 只读它。
    truthSnapshot: jsonb("truth_snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("workflows_project_idx").on(t.projectId)],
);

// ── 5. phases ──
export const phases = pgTable(
  "phases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    phase: text("phase").notNull(),
    status: text("status").notNull(),
    result: jsonb("result"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("phases_workflow_idx").on(t.workflowId)],
);

// ── 6. phase_attempts（可靠性：lease + heartbeat + 幂等 + recovery，U4）──
export const phaseAttempts = pgTable(
  "phase_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    phase: text("phase").notNull(),
    attemptNumber: integer("attempt_number").notNull().default(1),
    status: attemptStatus("status").notNull().default("leased"),
    owner: text("owner"), // 接管者 worker id（多 worker 并发恢复的 CAS 赢家）
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    bullmqJobId: text("bullmq_job_id"),
    // idempotency_key = workflow_id:phase:attempt_number；写入 ON CONFLICT DO NOTHING
    idempotencyKey: text("idempotency_key").notNull(),
    recoveryReason: text("recovery_reason"), // lease_expired / heartbeat_timeout / daemon_restart
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("phase_attempts_idempotency_uniq").on(t.idempotencyKey),
    index("phase_attempts_workflow_phase_idx").on(t.workflowId, t.phase),
  ],
);

// ── 7. workflow_jobs（fan-out 子 job 追踪）──
export const workflowJobs = pgTable(
  "workflow_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    phase: text("phase").notNull(),
    role: text("role").notNull(),
    bullmqJobId: text("bullmq_job_id"),
    status: text("status").notNull().default("queued"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("workflow_jobs_workflow_idx").on(t.workflowId)],
);

// ── 8. workflow_costs（三层结算真值源 run/phase/job，KTD-22）──
export const workflowCosts = pgTable(
  "workflow_costs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    phase: text("phase"),
    jobId: text("job_id"),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("workflow_costs_workflow_idx").on(t.workflowId)],
);

// ── 9. workflow_events（跨进程 SSE 回放日志，KTD-19）──
// event_id 全局单调 bigserial：worker 写、任意 Fastify 副本按 Last-Event-ID range-scan 补发。
export const workflowEvents = pgTable(
  "workflow_events",
  {
    eventId: bigserial("event_id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    event: text("event").notNull(), // workflow-status-changed / agent-progress / cost-update / surface-*
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("workflow_events_run_event_idx").on(t.runId, t.eventId)],
);

// ── 10. artifacts（带版本，支撑 R3 历史版本 + below_threshold 状态）──
export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    phase: text("phase").notNull(),
    type: text("type").notNull(), // intake-brief / axis / research / report / deck ...
    version: integer("version").notNull().default(1),
    body: text("body").notNull(),
    status: artifactStatus("status").notNull().default("draft"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("artifacts_version_uniq").on(t.workflowId, t.phase, t.type, t.version),
    index("artifacts_workflow_phase_idx").on(t.workflowId, t.phase),
  ],
);

// ── 11. checkpoint_surfaces（KTD-18；越权防线在写授权，responded_by 留痕）──
export const checkpointSurfaces = pgTable(
  "checkpoint_surfaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    phase: text("phase").notNull(),
    schemaDigest: text("schema_digest").notNull(),
    status: surfaceStatus("status").notNull().default("pending"),
    persistTier: text("persist_tier"),
    respondedBy: jsonb("responded_by"), // { user_id, role } —— 谁回填的，审计留痕
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("checkpoint_surfaces_workflow_idx").on(t.workflowId)],
);

// ── 12. share_links（opaque token + 持久化记录，KTD-13）──
export const shareLinks = pgTable(
  "share_links",
  {
    token: uuid("token").primaryKey(), // crypto.randomUUID()，token 本身即 PK
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(), // methodology / report
    expiry: timestamp("expiry", { withTimezone: true }).notNull(),
    nonce: text("nonce").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    accessCount: integer("access_count").notNull().default(0),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    ipAddress: text("ip_address"), // PII —— 留存期/删除路径见 Open Q 11
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("share_links_workflow_idx").on(t.workflowId)],
);
