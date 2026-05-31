CREATE TYPE "public"."link_mode" AS ENUM('gitUrl', 'localDir');--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "link_mode" SET DATA TYPE link_mode USING "link_mode"::text::link_mode;