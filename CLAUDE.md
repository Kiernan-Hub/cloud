# CLAUDE.md — Working Guide for This Repo

Full detail lives in `OVERVIEW.md` at the repo root. This file is the working
summary: what we're building, the guardrails, and what counts as a
green/red flag while building it.

## What we're building

**HoosRadar** — a web app that pulls campus events from scattered UVA
calendars/sources into one searchable place, with a link back to the
original source and a visible "last checked" timestamp on every event.

- Not a social network, not a chatbot, not a scraper for sources that
  disallow it.
- MVP = browse/search/filter events, see where each one came from, export
  to a calendar file, bookmark anonymously.
- Accounts, recommendations, and notifications are post-MVP — only pursued
  if real usage shows demand for them.

## Architecture, briefly

- **Modular monolith + a separate worker process.** Not microservices. One
  deployable app, internally split into clear modules (ingestion, events,
  dedup, search, admin). Split further only if there's a proven reason to.
- **Pipeline:** worker pulls a source → parses → normalizes → dedupes →
  stores in Postgres → API serves it → web client renders it. Each stage is
  isolated so one bad source can't break the whole thing.
- **Provenance is non-negotiable.** Every event keeps its source link and
  freshness timestamp. Nothing gets silently overwritten or invented.
- **Parsers are tested against saved fixtures, not live network calls**, so
  CI doesn't get flaky when an external site changes.

## Roadmap (milestones)

0. Discovery — interview students, vet real data sources, write architecture
   decisions.
1. Walking skeleton — app + worker + database running end-to-end on seeded
   fake data, no live source yet.
2. First real ingestion source — one live source, idempotent imports, tested
   failure handling.
3. Useful discovery MVP — search, filters, second source, dedup, bookmarks,
   calendar export.
4. Deploy + validate — real deployment, monitoring, usability testing with
   real students.
5. Personalization — accounts/recommendations, only if Milestone 4 showed
   real demand.
6. Documentation + evaluation — write-up, diagrams, measured results.

Exit criteria and non-goals per milestone are in `OVERVIEW.md`.

## Green flags — keep doing these

- Treat the MVP list in `OVERVIEW.md` as a hard boundary; require evidence
  before adding anything past it.
- Every behavior change ships with tests and a doc/comment update if it
  changes how something is used.
- Idempotent imports — running ingestion twice must not create duplicates.
- Keep source-specific parsing isolated from normalization/storage logic.
- Retain provenance on every merge/dedup — merges must be reversible.
- Use fixtures for parser tests; keep live-source tests separate from CI.
- Small, reversible, well-documented decisions — make them and move on.
- Structured logs, traceable ingestion-run IDs, no secrets in logs or code.
- Commit with descriptive messages; keep one milestone/scope in progress
  at a time.

## Red flags — stop or rethink

- A source without a documented owner, terms, and collection method.
- Any code that fabricates event details instead of pulling from a source.
- Deleting/overwriting imported data instead of tracking corrections.
- An import that isn't safe to re-run (non-idempotent writes).
- Reaching for microservices, a message queue, or a new infra dependency
  before the simple version has been tried and measured.
- Tests that depend on a live external site to pass.
- Scope creep toward accounts, notifications, or maps before the MVP is
  validated.
- Committing secrets, credentials, or real UVA private data.
- Silent failures — a bad record should be logged and skipped, not allowed
  to fail the whole ingestion batch or fail invisibly.

## Stop and ask before

- Spending money or provisioning a paid service.
- Accepting legal terms on the owner's behalf.
- Using private UVA data or credentials.
- Publishing personal information.
- Making an irreversible data or infrastructure change.
- Changing the core product audience or MVP boundary.
- Deploying publicly without standing permission to do so.

Reversible implementation choices — dependencies, internal refactors, test
fixtures — don't need approval first.

## Learning note

Kiernan is building this to learn architecture, not just to ship it. When
finishing a meaningful step or making a real design call, pause and explain
what it demonstrates before moving on — briefly, not a wall of text.
