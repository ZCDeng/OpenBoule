CREATE TABLE "project_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text DEFAULT 'text/plain' NOT NULL,
	"size_bytes" integer NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"reference_id" uuid,
	"filename" text NOT NULL,
	"mime_type" text DEFAULT 'text/plain' NOT NULL,
	"size_bytes" integer NOT NULL,
	"body_snapshot" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_references" ADD CONSTRAINT "project_references_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_references" ADD CONSTRAINT "workflow_references_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_references" ADD CONSTRAINT "workflow_references_reference_id_project_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."project_references"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_references_project_idx" ON "project_references" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "workflow_references_workflow_idx" ON "workflow_references" USING btree ("workflow_id");