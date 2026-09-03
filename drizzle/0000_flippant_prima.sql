CREATE TYPE "public"."collection_method" AS ENUM('ics', 'rss', 'atom', 'json_api', 'html');--> statement-breakpoint
CREATE TYPE "public"."correction_status" AS ENUM('open', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('scheduled', 'cancelled', 'postponed');--> statement-breakpoint
CREATE TYPE "public"."match_strategy" AS ENUM('exact_key', 'canonical_url', 'deterministic_similarity', 'manual');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'succeeded', 'partial', 'failed');--> statement-breakpoint
CREATE TABLE "corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"field" text NOT NULL,
	"reported_value" text,
	"reason" text,
	"status" "correction_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolution_note" text
);
--> statement-breakpoint
CREATE TABLE "duplicate_group_members" (
	"group_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"added_by" "match_strategy" NOT NULL,
	"match_score" numeric(4, 3),
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_reason" text,
	CONSTRAINT "duplicate_group_members_group_id_event_id_pk" PRIMARY KEY("group_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "duplicate_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"primary_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"review_note" text
);
--> statement-breakpoint
CREATE TABLE "ingestion_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"records_seen" integer DEFAULT 0 NOT NULL,
	"records_created" integer DEFAULT 0 NOT NULL,
	"records_updated" integer DEFAULT 0 NOT NULL,
	"records_skipped" integer DEFAULT 0 NOT NULL,
	"records_failed" integer DEFAULT 0 NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"error_kind" text,
	"error_summary" text,
	CONSTRAINT "finished_runs_have_end" CHECK ("ingestion_runs"."status" = 'running' OR "ingestion_runs"."finished_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"normalized_name" text NOT NULL,
	"display_name" text NOT NULL,
	"homepage_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_normalized_name_unique" UNIQUE("normalized_name")
);
--> statement-breakpoint
CREATE TABLE "raw_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"http_status" integer,
	"content_type" text,
	"content_hash" text NOT NULL,
	"byte_size" integer,
	"payload" text,
	"retain_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"source_event_key" text NOT NULL,
	"canonical_url" text NOT NULL,
	"first_run_id" uuid,
	"last_run_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"timezone" text NOT NULL,
	"is_all_day" boolean DEFAULT false NOT NULL,
	"venue_name" text,
	"venue_address" text,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"organization_id" uuid,
	"category_raw" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"cost_text" text,
	"is_free" boolean,
	"accessibility_notes" text,
	"status" "event_status" DEFAULT 'scheduled' NOT NULL,
	"source_published_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_material_change_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_hash" text NOT NULL,
	"search_vector" "tsvector",
	CONSTRAINT "ends_after_starts" CHECK ("source_events"."ends_at" IS NULL OR "source_events"."ends_at" >= "source_events"."starts_at"),
	CONSTRAINT "coords_together" CHECK (("source_events"."latitude" IS NULL) = ("source_events"."longitude" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"owner" text NOT NULL,
	"homepage_url" text NOT NULL,
	"feed_url" text,
	"method" "collection_method" NOT NULL,
	"terms_url" text,
	"terms_reviewed_at" timestamp with time zone,
	"terms_notes" text,
	"retain_raw_payload" boolean DEFAULT false NOT NULL,
	"raw_retention_days" integer DEFAULT 7 NOT NULL,
	"contact_email" text,
	"interval_seconds" integer DEFAULT 3600 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"disabled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enabled_requires_terms_review" CHECK ("sources"."enabled" = false OR "sources"."terms_reviewed_at" IS NOT NULL),
	CONSTRAINT "positive_interval" CHECK ("sources"."interval_seconds" > 0)
);
--> statement-breakpoint
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_event_id_source_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."source_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_group_members" ADD CONSTRAINT "duplicate_group_members_group_id_duplicate_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."duplicate_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_group_members" ADD CONSTRAINT "duplicate_group_members_event_id_source_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."source_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_groups" ADD CONSTRAINT "duplicate_groups_primary_event_id_source_events_id_fk" FOREIGN KEY ("primary_event_id") REFERENCES "public"."source_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_snapshots" ADD CONSTRAINT "raw_snapshots_run_id_ingestion_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_snapshots" ADD CONSTRAINT "raw_snapshots_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_events" ADD CONSTRAINT "source_events_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_events" ADD CONSTRAINT "source_events_first_run_id_ingestion_runs_id_fk" FOREIGN KEY ("first_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_events" ADD CONSTRAINT "source_events_last_run_id_ingestion_runs_id_fk" FOREIGN KEY ("last_run_id") REFERENCES "public"."ingestion_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_events" ADD CONSTRAINT "source_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "corrections_open_idx" ON "corrections" USING btree ("event_id") WHERE "corrections"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "duplicate_members_one_active_group_idx" ON "duplicate_group_members" USING btree ("event_id") WHERE "duplicate_group_members"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "ingestion_runs_source_time_idx" ON "ingestion_runs" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE INDEX "raw_snapshots_expiry_idx" ON "raw_snapshots" USING btree ("retain_until");--> statement-breakpoint
CREATE INDEX "raw_snapshots_run_idx" ON "raw_snapshots" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotent_import" ON "source_events" USING btree ("source_id","source_event_key");--> statement-breakpoint
CREATE INDEX "source_events_upcoming_idx" ON "source_events" USING btree ("starts_at") WHERE "source_events"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "source_events_org_idx" ON "source_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "source_events_stale_idx" ON "source_events" USING btree ("source_id","last_synced_at");--> statement-breakpoint
CREATE INDEX "sources_due_idx" ON "sources" USING btree ("next_run_at") WHERE "sources"."enabled";