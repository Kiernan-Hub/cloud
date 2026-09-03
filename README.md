# HoosRadar

A campus event discovery app for the University of Virginia. It pulls events
from scattered public UVA and student-organization calendars into one
searchable place, and keeps a link to the original source plus a visible
"last checked" timestamp on every event.

**Status:** Milestone 1 (walking skeleton) is built — the app, worker, and
database run end-to-end on seeded demo data. No live source is connected yet;
that is Milestone 2.

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
| 2 — First ingestion source  | Not started; blocked on source vetting                                                         |
| 3–6                         | Not started                                                                                    |

The remaining Milestone 0 blocker is vetting at least two real data sources
against the checklist in [`docs/sources/`](docs/sources/), which requires
reading each candidate's actual terms of service.
