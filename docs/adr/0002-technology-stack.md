# 0002 — Technology stack

- **Status:** Accepted
- **Date:** 2026-09-03
- **Supersedes:** the provisional stack sketch in `OVERVIEW.md` §8, which
  explicitly deferred confirmation to an ADR.

## Context

HoosRadar needs a server-rendered web client, a typed HTTP API, a relational
store with full-text search, and a **separate long-running worker process** for
scheduled ingestion. `OVERVIEW.md` §8 proposed "server-rendered TypeScript +
PostgreSQL + a worker" but left the concrete choices open.

Constraints that actually drive the choice:

1. One deployable codebase, two processes (modular monolith + worker) — see ADR 0005.
2. Postgres full-text search and deterministic dedup queries are core product
   logic, not incidental. Whatever we pick must not hide SQL from us.
3. The owner is building this to learn architecture. A stack that makes the data
   flow visible is worth more than one that makes the first screen fastest.
4. Free or near-free to run, and portable between hosts (see ADR 0003).

## Decision

| Layer                    | Choice                                                     |
| ------------------------ | ---------------------------------------------------------- |
| Language                 | TypeScript (strict mode), Node.js 22 LTS                   |
| Web + API                | Next.js (App Router), server components by default         |
| Database                 | PostgreSQL 16                                              |
| DB access / migrations   | Drizzle ORM + `drizzle-kit` SQL migrations                 |
| Validation               | Zod, at every trust boundary (source payloads, API inputs) |
| Unit / integration tests | Vitest                                                     |
| End-to-end tests         | Playwright                                                 |
| Lint / format            | ESLint + Prettier                                          |
| CI                       | GitHub Actions                                             |
| Local services           | Docker Compose (Postgres only)                             |

The worker is a plain Node entrypoint (`src/worker/index.ts`) in the same
codebase, sharing the `src/modules/*` code with the web process but started
separately.

## Rationale

**Next.js** gives server-rendered HTML with progressive enhancement and route
handlers for the API in one process, so the MVP is one deployable. It is the
most widely documented option in this space, which matters for a solo learner.

**Drizzle over Prisma** is the least obvious call here, so: Prisma has better
day-one ergonomics, but it owns the schema definition and pushes raw SQL to the
margins. Our two hardest problems — a `tsvector` search column with weighted
ranking, and deterministic duplicate matching — are SQL problems. Drizzle's
migrations _are_ SQL files we write and read, so the schema stays legible and
Postgres-specific features are first-class rather than escape hatches.

The cost is real: more boilerplate, and no Prisma Studio.

**Postgres over SQLite** because full-text search, `tstzrange` handling, and
later PostGIS for maps are all things we have committed to in `OVERVIEW.md`.
SQLite would be simpler now and wrong by Milestone 3.

## Consequences

**Good**

- Single language across web, worker, and tests; one type definition for an
  event from database row to rendered page.
- SQL stays visible, which serves both the dedup work and the learning goal.
- Every tool here has a free tier or is free outright.

**Costs**

- Next.js's App Router has real complexity (caching semantics, server vs. client
  boundaries) that will cost time to learn.
- Running the worker as a second process means Vercel-style serverless hosting is
  not sufficient on its own. ADR 0003 addresses this.
- Drizzle is younger than Prisma; expect rougher edges and thinner Stack Overflow
  coverage.

## Alternatives considered

- **SvelteKit.** Genuinely simpler and a better rendering model. Rejected only on
  ecosystem depth and available learning material for a solo first-timer.
- **Separate Fastify API + separate frontend.** Cleaner boundaries, but three
  processes and a CORS/auth surface at Milestone 1 for no measured benefit.
  This is the "microservices too early" red flag in `CLAUDE.md`.
- **Django or Rails.** Both are excellent for this exact shape of problem and
  have better batteries for admin surfaces. Rejected to keep one language across
  the whole system.

## Revisit if

- App Router caching becomes a recurring source of correctness bugs.
- Drizzle blocks a query we need and the workaround is worse than switching.
