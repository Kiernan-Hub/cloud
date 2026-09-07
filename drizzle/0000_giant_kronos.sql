CREATE TYPE "public"."gate_status" AS ENUM('passed', 'failed', 'timed_out', 'skipped', 'error');--> statement-breakpoint
CREATE TYPE "public"."metric_direction" AS ENUM('higher_is_better', 'lower_is_better');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'passed', 'failed', 'error');--> statement-breakpoint
CREATE TYPE "public"."run_trigger" AS ENUM('manual', 'scheduled', 'watch');--> statement-breakpoint
CREATE TABLE "check_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"commit_sha" text NOT NULL,
	"commit_subject" text,
	"branch" text,
	"dirty" boolean DEFAULT false NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"trigger" "run_trigger" DEFAULT 'manual' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	CONSTRAINT "finished_runs_have_end" CHECK ("check_runs"."status" = 'running' OR "check_runs"."finished_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "gate_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"gate_id" uuid NOT NULL,
	"gate_key" text NOT NULL,
	"project_id" text NOT NULL,
	"commit_sha" text NOT NULL,
	"status" "gate_status" NOT NULL,
	"exit_code" integer,
	"duration_ms" integer NOT NULL,
	"stdout_tail" text,
	"stderr_tail" text,
	"truncated" boolean DEFAULT false NOT NULL,
	"metric_value" numeric,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	CONSTRAINT "non_negative_duration" CHECK ("gate_results"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "gates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"command" text NOT NULL,
	"working_dir" text,
	"timeout_seconds" integer DEFAULT 300 NOT NULL,
	"blocking" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"metric_name" text,
	"metric_pattern" text,
	"metric_direction" "metric_direction",
	"metric_threshold" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positive_timeout" CHECK ("gates"."timeout_seconds" > 0),
	CONSTRAINT "metric_fully_configured" CHECK (("gates"."metric_name" IS NULL AND "gates"."metric_pattern" IS NULL AND "gates"."metric_direction" IS NULL)
          OR ("gates"."metric_name" IS NOT NULL AND "gates"."metric_pattern" IS NOT NULL AND "gates"."metric_direction" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"repo_path" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "check_runs" ADD CONSTRAINT "check_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_results" ADD CONSTRAINT "gate_results_run_id_check_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."check_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_results" ADD CONSTRAINT "gate_results_gate_id_gates_id_fk" FOREIGN KEY ("gate_id") REFERENCES "public"."gates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gates" ADD CONSTRAINT "gates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_project_time_idx" ON "check_runs" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE INDEX "runs_commit_idx" ON "check_runs" USING btree ("project_id","commit_sha");--> statement-breakpoint
CREATE UNIQUE INDEX "one_result_per_gate_per_run" ON "gate_results" USING btree ("run_id","gate_id");--> statement-breakpoint
CREATE INDEX "results_gate_history_idx" ON "gate_results" USING btree ("gate_id","started_at");--> statement-breakpoint
CREATE INDEX "results_flake_idx" ON "gate_results" USING btree ("project_id","gate_key","commit_sha");--> statement-breakpoint
CREATE UNIQUE INDEX "gate_key_unique" ON "gates" USING btree ("project_id","key");--> statement-breakpoint
CREATE INDEX "gates_project_idx" ON "gates" USING btree ("project_id","position");