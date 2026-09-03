-- Hand-written follow-up to 0000. Drizzle's column builders cannot express a
-- Postgres GENERATED ... STORED column with an arbitrary expression, so the
-- plain tsvector column created by 0000 is replaced here with the real
-- generated one plus its GIN index.
--
-- Weighting: title (A) > venue and category (B) > description (C). Keep this
-- in sync with src/lib/db/schema.ts if the weighted fields change.

ALTER TABLE "source_events" DROP COLUMN IF EXISTS "search_vector";--> statement-breakpoint
ALTER TABLE "source_events" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("venue_name", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("category_raw", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'C')
  ) STORED;--> statement-breakpoint
CREATE INDEX "source_events_search_idx" ON "source_events" USING gin ("search_vector");
