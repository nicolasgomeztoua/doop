ALTER TABLE "canvases" ADD COLUMN "published_at" bigint;--> statement-breakpoint
ALTER TABLE "canvases" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "canvases" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "canvases" ADD COLUMN "copy_count" integer DEFAULT 0 NOT NULL;