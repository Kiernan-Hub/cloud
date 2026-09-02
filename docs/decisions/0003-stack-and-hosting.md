# ADR-0003: Stack and hosting

- **Status:** Proposed
- **Date:** 2026-09-01
- **Affects:** Milestone 1 onward

## Context

`OVERVIEW.md` §8 proposed a server-rendered TypeScript application, a typed API,
PostgreSQL, and a separate worker, but deliberately left the stack unconfirmed
pending a spike. Milestone 1 cannot start without it. The owner has chosen
**TypeScript end to end**, and this record fixes the concrete choices that
follow.

Three constraints drive every choice below: one person maintains this; the
project exists partly to *learn* architecture, so transparent beats magic; and
the plan forbids new infrastructure without a measured reason.

Hosting is deliberately deferred — see the last section.

## Decision

### Runtime and language

Node.js 22 LTS, TypeScript in `strict` mode, ES modules. One language across the
web app, the API, and the worker, so a shared `core` package holds the event
model, normalization, and dedup logic used by both processes.

### Repository layout

An npm workspaces monorepo — one install, one lockfile, one `tsc` project
graph. The module boundaries `OVERVIEW.md` §8 asks for become real package
boundaries, so an accidental import across them is a build error rather than a
convention nobody enforces.

```
packages/
  core/      event model, normalization, dedup, sanitization
  db/        migrations, queries, connection handling
  ingest/    source fetchers and parsers  (depends on core, db)
  web/       Fastify server, routes, templates  (depends on core, db)
  worker/    scheduled runs, job claiming  (depends on core, db, ingest)
```

`web` must not depend on `ingest`. That single rule is what keeps the "one bad
source cannot break the site" property structural rather than aspirational.

### Web framework: Fastify with Eta templates

Server-rendered HTML from Fastify, templated with Eta, progressively enhanced.

**Why not Next.js or Remix:** both are competent and both would work. But a
framework that owns routing, data loading, bundling, and rendering hides exactly
the layers this project exists to understand, and it makes the app/worker split
awkward. Browse, search, and filter are links and GET forms — they work with no
JavaScript at all, which *is* progressive enhancement, achieved by not needing a
framework to provide it.

**The cost:** more wiring written by hand, and no ecosystem of framework
conventions to fall back on.

### Database access: `pg` with hand-written SQL

The `pg` driver, SQL in a repository layer, migrations via `node-pg-migrate`.
No ORM.

**Why:** ADR-0001's queries are the interesting part of this system — overlap
tests for multi-day events, recurrence horizons, `SELECT … FOR UPDATE SKIP
LOCKED` for job claiming, `tsvector` search. An ORM obscures all of them, and
these are precisely the things worth being able to explain. A typed query
builder (Kysely, Drizzle) is a reasonable middle ground if raw SQL becomes
tedious.

### Libraries

| Need | Choice | Why |
| --- | --- | --- |
| iCalendar parsing | `ical.js` | Mozilla's, most spec-complete on `RRULE` and `RECURRENCE-ID`, both of which ADR-0001 depends on |
| RSS/Atom parsing | `feedparser` or `fast-xml-parser` | Decide when the first RSS source is real |
| HTML sanitization | `sanitize-html` | Server-side, allowlist-configured — maps directly onto ADR-0002. `DOMPurify` needs a DOM shim on the server |
| Validation | `zod` | Parse source payloads at the boundary; a malformed record fails one row, not the batch |
| Testing | `vitest` | TypeScript-native, fast, no separate transform step |
| End-to-end | `@playwright/test` | Milestone 3's critical-path and keyboard tests |
| Lint + format | `biome` | One tool and one config instead of ESLint plus Prettier |
| Logging | `pino` | Structured JSON, fast, integrates with Fastify |

### Jobs and scheduling

Ingestion runs are Postgres rows claimed with `SELECT … FOR UPDATE SKIP
LOCKED`, per `OVERVIEW.md` §8. No queue until measurement demands one.

**What triggers a run** is a separate question, and the audit flagged it because
free hosting tiers suspend idle processes, which silently breaks an in-process
scheduler:

- **Production:** an external cron (the host's scheduler, or a GitHub Actions
  schedule) calls a protected trigger endpoint that enqueues due runs. Survives
  the worker being asleep.
- **Local development:** an in-process interval, so nothing external is needed
  to work on it.

Both paths enqueue through the same code; only the trigger differs.

### CI

GitHub Actions — the repository is already on GitHub and it is free for public
repositories. On every pull request: `biome` check, `tsc --noEmit`, `vitest`,
and migrations applied against a Postgres service container. Live-source checks
run on a separate schedule, never on pull requests, per `OVERVIEW.md` §12.

### Reference dataset for performance claims

The audit noted that §7's latency targets are unfalsifiable without a defined
dataset. Fixing it: **5,000 events across two sources**, seeded deterministically,
with p95 search latency measured against that dataset and the environment and
method recorded alongside any number reported.

## Hosting: deferred

Milestone 1 runs entirely locally with Postgres in Docker, so hosting is not
needed until Milestone 4. Deciding now would mean guessing at requirements the
project has not measured.

Candidates when it matters: Neon or Supabase for Postgres, Render or Fly.io for
the app. Two things to settle then, both flagged by the audit: free Postgres
tiers frequently have **no automated backups**, which collides with Milestone
4's backup and restore exercise — a scripted `pg_dump` and restore into a local
database is an acceptable demonstration of the procedure; and any tier requiring
payment or a card triggers the "stop and ask before spending money" rule in
`OVERVIEW.md` §15.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Python backend + TypeScript frontend | Excellent parsing libraries, but two toolchains and two test setups for one maintainer |
| Go backend | Single-binary deploys and good concurrency, but the smallest ecosystem of the three for iCalendar and sanitization — more fiddly parsing to write and test |
| Next.js / Remix | Capable, but hide the layers this project exists to understand, and fit the app/worker split poorly |
| An ORM (Prisma, TypeORM) | Obscures the queries that are the interesting part of the system |
| Serverless functions | No long-running worker, and cold starts on a scheduled ingestion job are a poor fit |

## Consequences

Committed to: Node and TypeScript across every process, and a monorepo whose
package boundaries enforce the module boundaries. Both are reversible early and
expensive to reverse once real code exists.

Accepted cost: more hand-wiring than a batteries-included framework, in exchange
for a system whose layers stay visible.

Not committed to: hosting, the RSS parser, and whether raw SQL stays raw.

## Revisit when

- Hand-written SQL becomes a maintenance burden — adopt a typed query builder,
  not an ORM.
- The server-rendered approach fails a real interaction need that progressive
  enhancement cannot cover.
- Measurement shows database-backed jobs failing under real ingestion load.
