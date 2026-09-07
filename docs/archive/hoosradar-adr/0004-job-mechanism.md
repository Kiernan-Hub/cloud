# 0004 — Database-backed jobs, no queue broker

- **Status:** Accepted
- **Date:** 2026-09-03

## Context

Ingestion is scheduled work: fetch a source on an interval, parse it, normalize
it, upsert events. That needs a scheduler and some notion of a job with retries.

`OVERVIEW.md` §8 already leans this way ("begin with database-backed jobs to
minimize operational complexity"), and `CLAUDE.md` names "reaching for a message
queue before the simple version has been tried and measured" as a red flag. This
ADR makes the decision explicit and, importantly, writes down the threshold at
which it should be reversed.

## Decision

The worker owns scheduling. Jobs live in Postgres.

- An `ingestion_runs` table records every run with a traceable run ID, status,
  counts, and timings. This is both the job record and the observability record.
- The worker polls on a fixed tick (default 60s), selects sources whose next
  scheduled run is due, and claims them with `SELECT ... FOR UPDATE SKIP LOCKED`
  so a second worker instance is safe without any extra infrastructure.
- Retries are bounded exponential backoff, tracked per source, capped. A source
  that exhausts retries is marked failing and surfaced to the admin view — it is
  not silently retried forever.
- No Redis, no BullMQ, no SQS, no external cron service.

## Consequences

**Good**

- Zero new infrastructure. Postgres is already required, and one fewer service
  is one fewer thing to deploy, monitor, secure, and pay for.
- Job state is queryable with plain SQL, which makes the admin surface in
  Milestone 2 nearly free.
- `SKIP LOCKED` makes horizontal scaling possible later without a rewrite.

**Costs**

- Polling adds up to one tick of scheduling latency. Irrelevant for a pipeline
  whose sources update hourly at best.
- Postgres carries load it would not otherwise carry. At our scale (tens of
  sources, hourly) this is noise.
- No fan-out, no priorities, no delayed-job UI. We do not need these yet.

## Revisit if — explicit thresholds

Adopt a real queue only when one of these is **measured**, not anticipated:

- Job table contention shows up in query latency (p95 claim query > 50 ms).
- Scheduling latency needs to drop below the tick interval for a user-facing
  reason.
- Job volume exceeds roughly 10 000 runs/day, where table growth and vacuum
  behavior start to need attention.

Until then, "we might need a queue later" is not a reason to add one.

## Alternatives considered

- **System cron / hosted cron triggering an HTTP endpoint.** Rejected: splits
  scheduling logic out of the codebase and into host configuration, which makes
  it invisible in the repo and host-specific (see ADR 0003 on portability).
- **BullMQ + Redis.** Rejected on the reasoning above. It is the right answer for
  a system with real fan-out; we do not have one.
