-- Milestone 1 walking-skeleton schema, implementing ADR-0001 (event schema
-- and lifecycle) and OVERVIEW.md section 8 (database-backed jobs).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- sources
-- ---------------------------------------------------------------------------

CREATE TABLE sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('ical', 'rss', 'seed')),
  feed_url TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- ingestion_runs — also the job queue: a worker claims a `pending` row with
-- `SELECT ... FOR UPDATE SKIP LOCKED` (OVERVIEW.md section 8), moves it to
-- `running`, then `succeeded` or `failed`. Only a `succeeded` run may ever
-- advance an event's consecutive_absences (ADR-0001 section 2).
-- ---------------------------------------------------------------------------

CREATE TABLE ingestion_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES sources (id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  records_seen INTEGER NOT NULL DEFAULT 0,
  records_upserted INTEGER NOT NULL DEFAULT 0,
  records_failed INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

-- Claiming query: SELECT * FROM ingestion_runs WHERE status = 'pending'
-- ORDER BY scheduled_at FOR UPDATE SKIP LOCKED LIMIT 1;
CREATE INDEX ingestion_runs_claim_idx ON ingestion_runs (scheduled_at)
  WHERE status = 'pending';

CREATE INDEX ingestion_runs_source_idx ON ingestion_runs (source_id, scheduled_at DESC);

-- ---------------------------------------------------------------------------
-- event_series — recurrence expansion, ADR-0001 section 1. Not populated by
-- the seed data; present so the events table can reference it from day one
-- rather than needing a migration when the first recurring source arrives.
-- ---------------------------------------------------------------------------

CREATE TABLE event_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES sources (id),
  source_uid TEXT NOT NULL,
  recurrence_rule TEXT NOT NULL,
  horizon_expanded_through TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, source_uid)
);

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  series_id UUID REFERENCES event_series (id),
  occurrence_start TIMESTAMPTZ,

  source_id UUID NOT NULL REFERENCES sources (id),
  source_uid TEXT,
  content_fingerprint CHAR(64),

  title TEXT NOT NULL,
  description_html TEXT NOT NULL DEFAULT '',

  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  start_tz TEXT NOT NULL,
  is_all_day BOOLEAN NOT NULL DEFAULT false,
  start_time_unknown BOOLEAN NOT NULL DEFAULT false,

  venue_name TEXT,
  venue_address TEXT,
  geo_lat DOUBLE PRECISION,
  geo_lng DOUBLE PRECISION,

  organization_name TEXT,
  categories TEXT[] NOT NULL DEFAULT '{}',

  cost_text TEXT,
  accessibility_text TEXT,

  source_url TEXT NOT NULL,
  source_published_at TIMESTAMPTZ,

  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled_by_source', 'missing_from_source', 'superseded')),
  consecutive_absences INTEGER NOT NULL DEFAULT 0,
  duplicate_group_id UUID,

  search_vector TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(organization_name, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(venue_name, '')), 'C')
  ) STORED,

  CHECK (end_at >= start_at)
);

-- ADR-0001 section 4: the natural key. A source-identified event is unique
-- per occurrence; a fallback-fingerprinted event likewise. Two things make
-- these partial indexes rather than plain table UNIQUE constraints:
--
-- 1. NULLS NOT DISTINCT is required: standard SQL never treats NULL = NULL
--    as a match, so without it, a plain UNIQUE constraint silently fails to
--    catch duplicates whenever occurrence_start is NULL — which is every
--    non-recurring event, i.e. the common case. ON CONFLICT would then never
--    fire for a non-series event and re-running an import would duplicate
--    every row. Caught by constraints.test.ts, not reasoned out in advance.
--
-- 2. Each index is scoped with WHERE to only the rows that use that identity
--    path. Applying NULLS NOT DISTINCT across the *whole* table would create
--    the opposite bug: every event identified by source_uid leaves
--    content_fingerprint NULL, and NULLS NOT DISTINCT would then treat every
--    such event from one source as a collision on (source_id, NULL, NULL) —
--    rejecting the second event ever inserted for that source. The WHERE
--    clause keeps the two identity paths from colliding with each other.
CREATE UNIQUE INDEX events_source_uid_occurrence_uq
  ON events (source_id, source_uid, occurrence_start) NULLS NOT DISTINCT
  WHERE source_uid IS NOT NULL;

CREATE UNIQUE INDEX events_fingerprint_occurrence_uq
  ON events (source_id, content_fingerprint, occurrence_start) NULLS NOT DISTINCT
  WHERE content_fingerprint IS NOT NULL;

-- "Events on this day" is an overlap test (start_at, end_at), not a
-- date-string comparison — see core's overlapsDay() and ADR-0001's addendum.
CREATE INDEX events_range_idx ON events (start_at, end_at);
CREATE INDEX events_status_idx ON events (status) WHERE status = 'active';
CREATE INDEX events_search_idx ON events USING GIN (search_vector);
CREATE INDEX events_source_idx ON events (source_id);

-- ---------------------------------------------------------------------------
-- event_status_history — transitions are recorded, not overwritten
-- (ADR-0001 section 2), so a wrong transition is diagnosable, not invisible.
-- ---------------------------------------------------------------------------

CREATE TABLE event_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events (id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  ingestion_run_id UUID REFERENCES ingestion_runs (id),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX event_status_history_event_idx ON event_status_history (event_id, occurred_at);
