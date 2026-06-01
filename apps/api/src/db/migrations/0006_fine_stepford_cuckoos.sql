CREATE TYPE "public"."reference_parse_source" AS ENUM('local-js', 'anthropic');--> statement-breakpoint
CREATE TYPE "public"."reference_parse_status" AS ENUM('parsed', 'failed', 'partial');--> statement-breakpoint
ALTER TABLE "project_references" ADD COLUMN "original_binary" "bytea";--> statement-breakpoint
ALTER TABLE "project_references" ADD COLUMN "parse_status" "reference_parse_status" DEFAULT 'parsed' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_references" ADD COLUMN "parse_source" "reference_parse_source";--> statement-breakpoint
ALTER TABLE "project_references" ADD COLUMN "parse_error" text;