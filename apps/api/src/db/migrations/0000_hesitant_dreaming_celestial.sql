CREATE TYPE "public"."artifact_status" AS ENUM('draft', 'below_threshold', 'published');--> statement-breakpoint
CREATE TYPE "public"."attempt_status" AS ENUM('leased', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'editor', 'viewer', 'external');--> statement-breakpoint
CREATE TYPE "public"."surface_status" AS ENUM('pending', 'resolved', 'timeout', 'invalidated');--> statement-breakpoint
CREATE TYPE "public"."workflow_status" AS ENUM('running', 'paused_for_approval', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"phase" text NOT NULL,
	"type" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"body" text NOT NULL,
	"status" "artifact_status" DEFAULT 'draft' NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkpoint_surfaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"phase" text NOT NULL,
	"schema_digest" text NOT NULL,
	"status" "surface_status" DEFAULT 'pending' NOT NULL,
	"persist_tier" text,
	"responded_by" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phase_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"phase" text NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"status" "attempt_status" DEFAULT 'leased' NOT NULL,
	"owner" text,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"bullmq_job_id" text,
	"idempotency_key" text NOT NULL,
	"recovery_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"phase" text NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"token" uuid PRIMARY KEY NOT NULL,
	"workflow_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"expiry" timestamp with time zone NOT NULL,
	"nonce" text NOT NULL,
	"created_by" uuid NOT NULL,
	"access_count" integer DEFAULT 0 NOT NULL,
	"last_accessed_at" timestamp with time zone,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workflow_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"phase" text,
	"job_id" text,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_events" (
	"event_id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"event" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"phase" text NOT NULL,
	"role" text NOT NULL,
	"bullmq_job_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"current_phase" text DEFAULT 'phase0_init' NOT NULL,
	"status" "workflow_status" DEFAULT 'running' NOT NULL,
	"mode" text,
	"axes" jsonb,
	"checkpoint_data" jsonb,
	"truth_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoint_surfaces" ADD CONSTRAINT "checkpoint_surfaces_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_attempts" ADD CONSTRAINT "phase_attempts_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phases" ADD CONSTRAINT "phases_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_costs" ADD CONSTRAINT "workflow_costs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_run_id_workflows_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_jobs" ADD CONSTRAINT "workflow_jobs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_version_uniq" ON "artifacts" USING btree ("workflow_id","phase","type","version");--> statement-breakpoint
CREATE INDEX "artifacts_workflow_phase_idx" ON "artifacts" USING btree ("workflow_id","phase");--> statement-breakpoint
CREATE INDEX "checkpoint_surfaces_workflow_idx" ON "checkpoint_surfaces" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "phase_attempts_idempotency_uniq" ON "phase_attempts" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "phase_attempts_workflow_phase_idx" ON "phase_attempts" USING btree ("workflow_id","phase");--> statement-breakpoint
CREATE INDEX "phases_workflow_idx" ON "phases" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_project_user_uniq" ON "project_members" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "share_links_workflow_idx" ON "share_links" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_costs_workflow_idx" ON "workflow_costs" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_events_run_event_idx" ON "workflow_events" USING btree ("run_id","event_id");--> statement-breakpoint
CREATE INDEX "workflow_jobs_workflow_idx" ON "workflow_jobs" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflows_project_idx" ON "workflows" USING btree ("project_id");