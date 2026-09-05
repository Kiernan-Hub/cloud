ALTER TABLE "sources" ADD COLUMN "last_etag" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "last_modified_header" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "default_timezone" text DEFAULT 'America/New_York' NOT NULL;