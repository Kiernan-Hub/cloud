# Milestone 1 — walking skeleton: work breakdown

**Goal (from `OVERVIEW.md` §11):** the app, worker, and database run end-to-end
on seeded fake data. No live source.

**Exit criteria:** a new contributor can follow the README, start the system,
view seeded events, run all checks, and understand the architecture.

**Explicitly out of scope:** any live network source, search ranking, filters,
dedup logic, bookmarks, calendar export, deployment. Those are Milestones 2–4.
Pulling any of them forward is scope creep, not progress.

---

## Why this milestone first

The skeleton is deliberately the thinnest possible slice that touches every
layer: HTTP request → route → module → database → back. It is worth building
before anything interesting because it converts a pile of assumptions into facts
— about the stack, the module boundaries in ADR 0005, and whether the schema in
`docs/schema/` survives contact with real queries. Every later milestone is
cheaper once this exists, and any of the ADRs that turn out to be wrong are
cheapest to reverse right now.

---

## Issues

### M1-01 — Project scaffold and tooling

**Do:** Initialize the Next.js + TypeScript project per ADR 0002. Configure
strict TypeScript, ESLint, Prettier, and Vitest. Add `npm` scripts: `dev`,
`build`, `worker`, `test`, `lint`, `typecheck`, `format`.

**Acceptance:**
- `npm run lint`, `npm run typecheck`, and `npm run test` all pass on a clean
  checkout with zero warnings.
- TypeScript runs in `strict` mode with `noUncheckedIndexedAccess`.
- One trivial passing test exists, so the test command is proven wired up.

---

### M1-02 — Local Postgres via Docker Compose

**Do:** `docker-compose.yml` with Postgres 16 only (ADR 0003). Add
`.env.example` with `DATABASE_URL` and nothing secret. Document startup in the
README.

**Acceptance:**
- `docker compose up -d` gives a reachable database with a documented connection
  string.
- `.env` is gitignored; `.env.example` is committed and contains no real values.
- README states how to start, stop, and reset the database volume.

---

### M1-03 — Schema and migrations

**Do:** Implement `docs/schema/0001_initial.sql` as a Drizzle schema plus a
generated migration. Add `npm run db:migrate` and `db:reset`.

**Acceptance:**
- Migration applies cleanly to an empty database and is idempotent to re-run.
- The `UNIQUE (source_id, source_event_key)` constraint exists — an integration
  test asserts a duplicate insert is rejected.
- The `enabled_requires_terms_review` check constraint exists and is tested:
  enabling a source with no `terms_reviewed_at` must fail.
- Generated `search_vector` column is present and populated on insert.
- Any deviation from the design draft is reflected back into
  `docs/schema/0001_initial.sql` in the same PR.

---

### M1-04 — Module skeleton and boundary enforcement

**Do:** Create the directory structure from ADR 0005 with an `index.ts` per
module. Configure the ESLint boundary rules.

**Acceptance:**
- A test fixture proving the rules bite: an import from `parsing/` to `lib/db`
  fails lint. (Verify manually, then remove — or keep as a lint-rule test if the
  tooling supports it.)
- Deep imports across module internals fail lint.
- `docs/adr/0005-module-boundaries.md` matches the directory names actually used.

---

### M1-05 — Config and structured logging

**Do:** Zod-validated environment config loaded once at startup, failing loudly
on a missing variable. A structured JSON logger with a `run_id` field available
for ingestion contexts.

**Acceptance:**
- Starting either process with a missing required env var exits non-zero with a
  message naming the variable.
- Log output is one JSON object per line with `level`, `time`, `msg`.
- A test asserts that a value registered as a secret is redacted in log output.
  (`CLAUDE.md`: no secrets in logs.)

---

### M1-06 — Seed data

**Do:** A seed script inserting one clearly-marked demo source and ~30 fake
events spread across the next few weeks, including deliberate edge cases: an
all-day event, an event with no end time, a cancelled event, one with a missing
venue, and one that is stale (`last_synced_at` well in the past).

**Acceptance:**
- `npm run db:seed` is idempotent — running it twice yields the same 30 events,
  not 60. This is the first real test of the idempotency design.
- The demo source is named so no one can mistake seeded data for real UVA events
  (e.g. `demo-seed`, with events titled `[DEMO] ...`).
- Seeded events exercise every nullable column in `source_events`.

---

### M1-07 — Events module and read API

**Do:** `events/` module with a `listUpcoming({ limit, cursor })` function.
A route handler at `GET /api/events` returning cursor-paginated JSON.

**Acceptance:**
- Response includes, per event: title, start, timezone, venue, source id,
  `canonical_url`, and `last_synced_at`. Provenance is present from day one, not
  retrofitted.
- Pagination is cursor-based with an enforced maximum page size; requesting a
  larger size is clamped, not honored.
- Past events are excluded by default.
- Integration test covers ordering, the page-size clamp, and cursor stability.

---

### M1-08 — Events list and detail pages

**Do:** Server-rendered upcoming-events list and an event detail page. Every
event shows its source link and "last checked" timestamp. Responsive, semantic
HTML, no client-side data fetching.

**Acceptance:**
- Both pages render from the real API/database — no hardcoded fixtures in the
  view layer.
- Empty state and error state are implemented, not deferred.
- Keyboard navigation works and focus states are visible.
- Detail page links to `canonical_url` and displays the freshness timestamp.
- Stale events (old `last_synced_at`) are visibly marked as such.

---

### M1-09 — Worker process and scheduler loop

**Do:** Worker entrypoint with the tick loop from ADR 0004: claim due sources
with `FOR UPDATE SKIP LOCKED`, open an `ingestion_runs` row, execute a no-op
handler, close the run. No real fetching yet.

**Acceptance:**
- `npm run worker` starts, ticks, and shuts down cleanly on SIGTERM (in-flight
  run marked, not orphaned in `running`).
- Every run writes an `ingestion_runs` row with a run ID that appears in the
  process's log lines for that run.
- Test proves two concurrent workers do not both claim the same source.
- A handler that throws marks the run `failed` with an `error_summary` and does
  not kill the loop. Silent failure is the thing being designed out here.

---

### M1-10 — Health endpoints

**Do:** `GET /api/health` (process + database reachability) and
`GET /api/health/sources` (per-source freshness). Keep them distinct per
`OVERVIEW.md` §7 — the web process being healthy and the sources being healthy
are different questions and must not be conflated.

**Acceptance:**
- `/api/health` returns 200 only when the database is reachable; 503 otherwise.
- `/api/health/sources` reports last successful run and staleness per source
  and returns 200 even when a source is stale (staleness is data, not an
  outage of *this* service).

---

### M1-11 — CI

**Do:** GitHub Actions running lint, typecheck, unit tests, and integration
tests against a Postgres service container. Build the Dockerfile (ADR 0003) to
prove the deployable artifact compiles.

**Acceptance:**
- CI passes on a pull request from a clean checkout.
- No step reaches an external network host other than the package registry —
  `CLAUDE.md` forbids tests that depend on a live external site.
- Total run under ~5 minutes.

---

### M1-12 — Documentation pass

**Do:** Rewrite the README for setup and architecture. Add `docs/architecture.md`
with the module map and the request/ingestion flow.

**Acceptance:**
- A contributor with only Node and Docker installed can go from clone to seeded
  events in the browser using the README alone, with no undocumented steps.
- Verify this by actually following it on a clean clone — not by assuming it.
- Architecture doc links to the relevant ADRs rather than restating them.

---

## Suggested order

`M1-01 → M1-02 → M1-03 → M1-04 → M1-05 → M1-06 → M1-07 → M1-08` gets a visible
page on real data as early as possible. `M1-09 → M1-10 → M1-11 → M1-12` closes
out the skeleton. M1-11 (CI) can be pulled forward any time after M1-01 and
probably should be.

## Definition of done for the milestone

- [ ] All twelve issues meet their acceptance criteria.
- [ ] `npm run lint && npm run typecheck && npm run test` is green.
- [ ] Seed → browse → detail works end-to-end from a clean clone.
- [ ] The worker runs, logs traceable run IDs, and survives a failing handler.
- [ ] Any ADR contradicted by what was actually built has a superseding ADR.
