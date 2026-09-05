# HoosRadar

A campus event discovery app for the University of Virginia. It pulls events
from scattered public UVA and student-organization calendars into one
searchable place, and keeps a link to the original source plus a visible
"last checked" timestamp on every event.

**Status:** The ingestion pipeline is built and tested end to end — fetch,
parse, normalize, deduplicate-safe upsert — for any iCalendar (ICS) feed.
No real UVA source is connected yet: that needs one feed URL and a terms
check. See [Adding a real source](#adding-a-real-source).

## Requirements

- Node.js 22 (LTS)
- Docker (for local Postgres)

## Setup

```bash
git clone <this repo>
cd cloud
npm install

cp .env.example .env        # defaults match docker-compose.yml
docker compose up -d        # starts Postgres 16 on :5432

npm run db:migrate          # apply schema
npm run db:seed             # load ~30 demo events

npm run dev                 # http://localhost:3000
```

In a second terminal, to run the ingestion worker:

```bash
npm run worker
```

The worker currently ticks, claims due sources, and records a run with a
no-op handler. Real fetching arrives with the first source in Milestone 2.

> **No Docker?** Any local Postgres 16 works — create a `hoosradar` database
> and point `DATABASE_URL` at it.

## Scripts

| Command               | What it does                                      |
| --------------------- | ------------------------------------------------- |
| `npm run dev`         | Web app in development                            |
| `npm run worker`      | Ingestion worker (scheduler loop)                 |
| `npm run build`       | Production build                                  |
| `npm test`            | Unit + integration tests (needs Postgres running) |
| `npm run lint`        | ESLint, including module-boundary rules           |
| `npm run typecheck`   | Next typegen + `tsc --noEmit`                     |
| `npm run format`      | Prettier                                          |
| `npm run db:migrate`  | Apply migrations                                  |
| `npm run db:seed`     | Load demo data (idempotent)                       |
| `npm run db:generate` | Generate a migration from schema changes          |
| `npm run source:add`  | Register an ICS source (created disabled)         |
| `npm run source:run`  | Run one source now, ignoring its schedule         |

All checks together, the same set CI runs:

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

## Demo data

`npm run db:seed` inserts ~30 events under a source called `demo-seed`, every
title prefixed `[DEMO]`, so seeded data can never be mistaken for a real UVA
event. It deliberately includes awkward cases the UI has to handle: an all-day
event, an event with no end time, a cancelled event, one with no venue, and one
that is stale.

Running it twice yields 30 events, not 60 — that idempotency is the same
guarantee real ingestion depends on.

## Adding a real source

Registering an ICS feed takes two commands. The source is created **disabled**
so you can inspect a dry run before it goes live.

```bash
npm run source:add -- \
  --id uva-arts \
  --name "UVA Arts" \
  --owner "UVA Office of the Provost for the Arts" \
  --homepage https://arts.virginia.edu/calendar \
  --feed https://arts.virginia.edu/calendar/ics \
  --terms-note "Public ICS feed; robots.txt checked; reviewed 2026-09-05"

npm run source:run -- --id uva-arts     # dry run, prints what it found
```

If the dry run looks right, enable it:

```bash
psql "$DATABASE_URL" -c "UPDATE sources SET enabled = true WHERE id = 'uva-arts';"
```

`--terms-note` is required, and the database refuses to enable a source with no
recorded terms review — the source policy in [`docs/sources/`](docs/sources/)
is enforced, not just documented. Complete that checklist too.

**Finding a feed URL:** on a Localist calendar, look for a subscribe or export
link, or the ICS option under the filter menu. LibCal and most departmental
calendars expose one similarly.

## Endpoints

| Route                 | Purpose                                     |
| --------------------- | ------------------------------------------- |
| `/`                   | Upcoming events                             |
| `/events/[id]`        | Event detail with source link and freshness |
| `/api/events`         | Cursor-paginated JSON, page size clamped    |
| `/api/health`         | Process + database reachability             |
| `/api/health/sources` | Per-source freshness                        |

## Documentation

| Document                                       | What it covers                                   |
| ---------------------------------------------- | ------------------------------------------------ |
| [`OVERVIEW.md`](OVERVIEW.md)                   | Product scope, requirements, roadmap, metrics    |
| [`CLAUDE.md`](CLAUDE.md)                       | Working guardrails and what needs owner approval |
| [`docs/architecture.md`](docs/architecture.md) | How the system fits together                     |
| [`docs/adr/`](docs/adr/)                       | Architecture decisions and their tradeoffs       |
| [`docs/schema/`](docs/schema/)                 | Event data model, explained                      |
| [`docs/sources/`](docs/sources/)               | Source policy and vetting checklist              |
| [`docs/discovery/`](docs/discovery/)           | Interview guide and findings                     |
| [`docs/milestones/`](docs/milestones/)         | Per-milestone work breakdowns                    |

## Where the project stands

| Milestone                   | State                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| 0 — Discovery and decisions | Architecture decided, schema drafted, 5/5 interviews complete. **Source vetting outstanding.** |
| 1 — Walking skeleton        | Built: app + worker + database on seeded data                                                  |
| 2 — First ingestion source  | Pipeline built and tested for any ICS feed; awaiting one verified UVA feed URL                 |
| 3–6                         | Not started                                                                                    |

The remaining blocker is confirming a real UVA feed URL and its terms — see
[`docs/sources/vetting-findings-2026-09.md`](docs/sources/vetting-findings-2026-09.md).
Once one is verified, connecting it is the two commands above.
