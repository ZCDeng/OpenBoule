ALTER TABLE "artifacts" ADD COLUMN "input_artifact_versions" jsonb;--> statement-breakpoint
ALTER TABLE "artifacts" ADD COLUMN "stale" boolean DEFAULT false NOT NULL;