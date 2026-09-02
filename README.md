# HoosRadar

A web app that pulls campus events from scattered UVA calendars and
organization pages into one searchable place — with a link back to the original
source and a visible "last checked" timestamp on every event.

**Current stage: Milestone 1, walking skeleton.** The app, worker, and database
run end-to-end on seeded demo data — there is no live source integrated yet
(that is Milestone 2). See [`docs/decisions/`](docs/decisions/) for the
architecture behind what's here.

**Picking this back up? Read [`NEXT_STEPS.md`](NEXT_STEPS.md) first** — status
and the exact next steps, kept short on purpose.

## Setup

Requires Node.js 22+ and a PostgreSQL 16 server.

### 1. Database

Either run Postgres via Docker:

```sh
docker compose up -d
```

This creates both `hoosradar_dev` and `hoosradar_test` databases automatically
(user `hoosradar`, password `hoosradar_dev`, port 5432 — see
`docker/postgres-init/`).

Or point at a Postgres instance you already have running — create a role
matching `.env.example`'s default `DATABASE_URL`, and the two databases:

```sh
psql -c "CREATE ROLE hoosradar WITH LOGIN PASSWORD 'hoosradar_dev' CREATEDB;"
createdb -O hoosradar hoosradar_dev
createdb -O hoosradar hoosradar_test
```

(Or skip this and just edit `DATABASE_URL` in `.env`/`.env.test` after step 2
to match whatever role your own Postgres setup already uses.)

### 2. Environment

```sh
cp .env.example .env
cp .env.test.example .env.test
```

Edit `DATABASE_URL` in each if your Postgres isn't at the default
`postgres://hoosradar:hoosradar_dev@localhost:5432/...`. `.env` points at
`hoosradar_dev` (what you'll browse); `.env.test` points at `hoosradar_test`
(what the test suite uses — kept separate on purpose, see the comment in
`vitest.setup.ts`).

### 3. Install, migrate, seed

```sh
npm install
npm run build
npm run migrate
npm run seed
```

### 4. Run it

```sh
npm run dev:web
```

Visit `http://localhost:3000` — you should see the seeded demo events. In a
second terminal, the worker (optional for just browsing, but this is where
scheduled ingestion runs happen):

```sh
npm run dev:worker
```

## Checks

```sh
npm run lint       # biome, format + lint
npm run build      # typescript, all packages, in dependency order
npm test           # vitest, against hoosradar_test
```

All three run in CI on every pull request (`.github/workflows/ci.yml`) against
a fresh Postgres service container. If your build ever looks stuck reporting
"everything is up to date" after you deleted a `dist/` folder by hand, run
`npm run clean` first — TypeScript's incremental build cache doesn't notice a
manually deleted output directory.

## Documents

| Document | What it is |
| --- | --- |
| [`NEXT_STEPS.md`](NEXT_STEPS.md) | Status and exact next steps — read this first when resuming work |
| [`OVERVIEW.md`](OVERVIEW.md) | Product scope, requirements, architecture, roadmap, and the working agreement |
| [`CLAUDE.md`](CLAUDE.md) | Working summary and guardrails for contributors and coding agents |
| [`docs/HANDBOOK.md`](docs/HANDBOOK.md) | Study reference: the whole project, the reasoning, and the vocabulary |
| [`docs/discovery/`](docs/discovery/) | Student interview guide for Milestone 0 |
| [`docs/decisions/`](docs/decisions/) | Architecture decision records |
| [`docs/sources/`](docs/sources/) | Per-source policy records; required before a source is integrated |
| [`docs/reviews/`](docs/reviews/) | Point-in-time reviews of the plan and the codebase |

## Structure

An npm workspaces monorepo (see ADR-0003 for why):

| Package | What it is |
| --- | --- |
| `packages/core` | Event model, sanitization (ADR-0002), and the natural key (ADR-0001) — no I/O |
| `packages/db` | Migrations, the query layer, and seed data |
| `packages/web` | Fastify server, server-rendered pages, no client JS required |
| `packages/worker` | The database-backed job queue and its poll loop (OVERVIEW.md §8) |

`packages/ingest` (real source fetching and parsing) doesn't exist yet — that's
Milestone 2.

## Ground rules

Every event keeps its source link and freshness timestamp, nothing is
invented, imports are safe to re-run, and parsers are tested against saved
fixtures rather than live network calls. The full set is in
[`CLAUDE.md`](CLAUDE.md).

## Status

This is a personal learning project and is not affiliated with or endorsed by
the University of Virginia.
