ALTER TYPE "public"."run_status" ADD VALUE 'partial' BEFORE 'failed';--> statement-breakpoint
ALTER TYPE "public"."run_status" ADD VALUE 'canceled';--> statement-breakpoint
CREATE INDEX "runs_unfinished_idx" ON "check_runs" USING btree ("started_at") WHERE status = 'running';