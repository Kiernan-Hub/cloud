# CLAUDE.md — Working Guide for This Repo

This file is for whoever (or whatever AI) works on this repo next, including
Claude. The full plan lives in `overview` at the repo root — read that first
for details. This file is the short version, plus rules for how to work with
Kiernan, who is a student using this project to **learn software
architecture**, not just to get a finished app.

## What we're building (30-second version)

**HoosRadar** — a web app that pulls campus events from scattered UVA
calendars/sources into one searchable place, with a link back to the original
source and a visible "last checked" timestamp for every event.

- **Not** a social network, not a chatbot, not scraping things we're not
  allowed to scrape.
- MVP = browse/search/filter events, see where they came from, export to a
  calendar file, bookmark anonymously. Accounts, recommendations, and
  notifications come later, only if real usage justifies them.

## Why the architecture looks the way it does

- **Modular monolith + a separate worker process** — not microservices. One
  deployable app, but internally split into clear modules (ingestion, events,
  dedup, search, admin). This is a deliberate "don't over-engineer it"
  choice — it's simpler to build and debug, and can be split apart later only
  if there's a real reason to.
- **Worker pulls events → parses → normalizes → dedupes → stores in
  Postgres → API serves it → web client shows it.** Each step is separated so
  one bad data source can't break the whole pipeline.
- **Provenance matters everywhere.** Every event keeps its source link and
  freshness timestamp. Nothing gets silently overwritten or invented.
- **Tests and fixtures over live network calls in CI.** Source parsers get
  tested against saved sample data, not the live internet, so tests don't
  become flaky because an external site changed.

## The roadmap (milestones, briefly)

0. Discovery — interview students, pick real data sources, write down
   architecture decisions.
1. Walking skeleton — app + worker + database running end-to-end with fake
   seeded data. No real source yet. Goal: prove the whole pipeline works.
2. First real ingestion source — one live source, idempotent imports, tested
   failure handling.
3. Useful discovery MVP — search, filters, second source, dedup, bookmarks,
   calendar export.
4. Deploy + validate — real deployment, monitoring, usability testing with
   real students.
5. Personalization — accounts/recommendations, but only if Milestone 4
   showed real demand for it.
6. Portfolio hardening — write up the results, diagrams, case study.

Full detail, exit criteria, and non-goals for each milestone are in
`overview`.

## Teaching rule — most important part of this file

Kiernan is doing this to learn, not just to ship. **Do not silently
one-shot large chunks of work.** Every so often — after finishing a
meaningful step, hitting a real design decision, or starting a new
milestone — **stop and explain in plain language**:

- what was just built or decided, and why
- what tradeoff or architecture concept it demonstrates
- what's coming next

Keep these explanations short and conversational, aimed at someone learning
architecture for the first time — not a wall of jargon. It's fine (expected)
to ask "want me to explain X before I continue?" rather than assuming.

## Guardrails (from the working agreement in `overview`)

Stop and ask before: spending money, deploying publicly, using any real UVA
private data/credentials, or making an irreversible infrastructure change.
Everything else reversible (code structure, dependencies, test fixtures) can
proceed without asking first.
