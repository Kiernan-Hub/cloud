# Architecture

How HoosRadar is put together and why. The reasoning behind each decision
lives in [`adr/`](adr/) — this document is the map, not the argument.

## Shape

A **modular monolith plus a separate worker process**, sharing one codebase and
one database.

```
                    ┌──────────────────────────────┐
   browser ────────▶│  Next.js app (src/app)       │
                    │  pages + API route handlers  │
                    └──────────────┬───────────────┘
                                   │  reads through
                                   ▼
                    ┌──────────────────────────────┐
                    │  modules (src/modules)       │
                    │  events · search · dedup ·   │
                    │  ingestion · parsing · admin │
                    └──────────────┬───────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │  PostgreSQL 16               │
                    └──────────────▲───────────────┘
                                   │  writes
                    ┌──────────────┴───────────────┐
   public source ──▶│  worker (src/worker)         │
                    │  scheduler loop + ingestion  │
                    └──────────────────────────────┘
```

Two processes, one deployable codebase:

- `npm run dev` — the web app (pages + API).
- `npm run worker` — the scheduler loop.

They share `src/modules/*` and `src/lib/*`. Neither imports the other.

## Ingestion pipeline

```
approved source
      │  fetch (worker, on schedule)
      ▼
raw snapshot ──▶ source parser ──▶ normalized candidate
                                          │
                                          ▼
                            validation and deduplication
                                          │
                                          ▼
                                    PostgreSQL
                                          │
                                          ▼
                                  API ──▶ web client
```

Each stage is isolated so one badly-behaved source cannot break the rest. The
whole path is implemented and tested for iCalendar feeds (ADR 0006):

| Stage     | Where                     | Notes                                                                                                |
| --------- | ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Fetch     | `ingestion/fetch.ts`      | Conditional requests (ETag / If-Modified-Since), bounded backoff with jitter, identifying user agent |
| Snapshot  | `ingestion/ics-source.ts` | Hash always stored; payload only where terms allow, with an expiry                                   |
| Parse     | `parsing/ics/`            | RFC 5545. Pure, fixture-tested, no database access                                                   |
| Normalize | `normalization/`          | Source shape → candidate. Never invents a field                                                      |
| Upsert    | `events/upsert.ts`        | Idempotent on `(source_id, source_event_key)`; freshness stamps kept honest                          |

What is not implemented: recurrence expansion (`RRULE` is recorded, not
expanded), and any non-ICS source format.

## Directory map

| Path                         | What lives here                                   |
| ---------------------------- | ------------------------------------------------- |
| `src/app/`                   | Next.js routes — pages and API route handlers     |
| `src/app/_components/`       | Shared presentation helpers                       |
| `src/modules/sources/`       | Source registry, terms metadata, enable/disable   |
| `src/modules/ingestion/`     | Run lifecycle, source claiming, retries           |
| `src/modules/parsing/`       | Per-source parsers, one directory each            |
| `src/modules/normalization/` | Parsed payload → canonical event candidate        |
| `src/modules/events/`        | Event and organization reads/writes               |
| `src/modules/dedup/`         | Matching, grouping, reversible merges             |
| `src/modules/search/`        | Query construction, ranking, filters              |
| `src/modules/admin/`         | Source health, run inspection, duplicate review   |
| `src/worker/`                | Worker entrypoint and scheduler loop              |
| `src/lib/`                   | Cross-cutting: db client, schema, config, logging |
| `drizzle/`                   | SQL migrations                                    |

## Boundaries that are actually enforced

[ADR 0005](adr/0005-module-boundaries.md) chose lint rules over a package split.
Four rules are configured in `eslint.config.mjs` and each one has been verified
to fail a real import:

1. `parsing/` cannot import `events/`, `dedup/`, `search/`, or `lib/db`.
   **This is the load-bearing one** — a parser takes bytes and returns a plain
   object. It is why a bad source cannot corrupt storage, and why parser tests
   need no database.
2. `app/` cannot import `parsing/` or `ingestion/` internals.
3. Modules are imported through their `index.ts`; deep imports fail.
4. `lib/` cannot import `modules/`. Dependencies point one direction.

## Data model

Full explanation in [`schema/event-model.md`](schema/event-model.md). The three
structural commitments:

- **One row per event per source** (`source_events`). A deduplicated event is a
  _group_ of rows, never a row that overwrote others.
- **`UNIQUE (source_id, source_event_key)`** makes imports idempotent at the
  database level rather than by application convention.
- **Three distinct freshness timestamps** (`first_seen_at`, `last_seen_at`,
  `last_synced_at`) so a source outage can never be misread as a cancelled
  event.

Merges are reversible: `duplicate_group_members` rows are marked `removed_at`,
never deleted. Corrections are separate records, never destructive edits.

## Scheduling

[ADR 0004](adr/0004-job-mechanism.md): jobs live in Postgres, no queue broker.
The worker ticks, claims due sources with `SELECT ... FOR UPDATE SKIP LOCKED`,
and records every attempt in `ingestion_runs`. Two workers racing for the same
source is covered by a test, so scaling out later needs no new infrastructure.

Every run gets a UUID that appears in each structured log line for that run.

## Observability

- Structured JSON logs, one object per line, with secret-looking fields
  redacted (tested).
- `GET /api/health` — process and database reachability only.
- `GET /api/health/sources` — per-source freshness. Returns 200 even when a
  source is stale, because a stale source is information about the world, not
  an outage of this service.

## What does not exist yet

Deliberately, per the milestone boundaries in `OVERVIEW.md`:

- No live source is connected. The pipeline is built and tested; it needs a
  verified feed URL (see the README).
- No recurrence expansion, and no parser for formats other than ICS.
- No search, filters, dedup logic, bookmarks, or calendar export (Milestone 3).
- No deployment, monitoring, or accounts (Milestones 4–5).
