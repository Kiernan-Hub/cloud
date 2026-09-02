# HoosRadar handbook

A single place to re-load the whole project: what it is, why each decision was
made, where it stands, and the vocabulary to discuss it. Written to be read
start to finish in about half an hour.

- **Last updated:** 2026-09-02
- **Canonical source:** this file. `OVERVIEW.md` is the authoritative plan; this
  handbook explains and connects it.

## Contents

1. [The one-paragraph version](#1-the-one-paragraph-version)
2. [Honest status](#2-honest-status)
3. [The problem and why it's real](#3-the-problem-and-why-its-real)
4. [Scope: what's in, what's out, and why](#4-scope-whats-in-whats-out-and-why)
5. [Architecture and the reasoning behind it](#5-architecture-and-the-reasoning-behind-it)
6. [The pipeline, stage by stage](#6-the-pipeline-stage-by-stage)
7. [The data model and the hard parts](#7-the-data-model-and-the-hard-parts)
8. [Tools: what's actually in use vs. proposed](#8-tools-whats-actually-in-use-vs-proposed)
9. [Roadmap and where the line is](#9-roadmap-and-where-the-line-is)
10. [Open decisions](#10-open-decisions)
11. [Known risks](#11-known-risks)
12. [Vocabulary](#12-vocabulary)
13. [Talking about this project](#13-talking-about-this-project)
14. [Where everything lives](#14-where-everything-lives)

---

## 1. The one-paragraph version

HoosRadar aggregates public UVA campus events — scattered today across dozens
of departmental calendars, student-org platforms, and mailing lists — into one
searchable place. Every event keeps a link back to its original source and a
visible "last checked" timestamp, so the app never asks to be trusted more than
the source it copied from. A worker process pulls each source on a schedule,
parses it, normalizes it, deduplicates against what's already stored, and writes
to Postgres; an API serves it and a web client renders it. It is deliberately
not a social network, not a chatbot, and not a scraper of sources that disallow
collection.

## 2. Honest status

**The walking skeleton exists and runs.** App, worker, and database run
end-to-end on seeded demo data — no live source is integrated yet, and there
is still no deployment. This matters for how you describe the project: it is
accurate to say "a working full-stack skeleton with a real Postgres schema,"
not "a finished product" or "an app pulling real UVA events."

| Area | State |
| --- | --- |
| Milestone | 1 (walking skeleton) built; Milestone 2 (first real source) next |
| Application code | 4 packages: core, db, web, worker — see §8 |
| Automated tests | 43, all passing; CI runs them on every pull request |
| Student interviews | 0 of 5 conducted |
| Architecture decision records | 3 written (Proposed): schema/lifecycle, sanitization, stack |
| Candidate sources inventoried | 8; one (Hoos Involved) technically verified against a real feed pull |
| Sources approved | 0 — technical verification is not the same as owner approval |
| Stack chosen | Yes — TypeScript end to end, see ADR-0003 |
| Deployment | None — Milestone 4 |

What has been produced: the full plan (`OVERVIEW.md`), working guardrails
(`CLAUDE.md`), a discovery interview protocol, a plan audit, a researched and
partly-verified inventory of candidate data sources, three decision records,
and — new since the audit — a running walking skeleton with a tested schema,
a server-rendered web app, and a database-backed job worker.

## 3. The problem and why it's real

A UVA student who wants to find something to do has to check a departmental
calendar, a student-org platform, several mailing lists, and Instagram — and
still misses things. The four questions the product exists to answer:

- What is happening on Grounds today or this weekend?
- Which events match my interests?
- What can I attend between two classes?
- Where did this event come from, and when was it last checked?

**Supporting evidence found so far:** source research turned up no single
university-wide UVA events calendar. `events.virginia.edu` does not resolve, and
at least eight separate unit calendars exist instead. The fragmentation the
product assumes appears to be real.

**The evidence still missing:** whether students actually experience this as a
problem worth solving. That is what the five discovery interviews are for, and
the interview guide is deliberately written to test the *behavior* ("tell me
about the last event you missed") rather than to ask whether the idea sounds
good. People say yes to ideas; behavior is harder to fake.

This distinction — *validating a problem rather than pitching a solution* — is
one of the more defensible things about the project's method.

## 4. Scope: what's in, what's out, and why

### The MVP

A responsive upcoming-events page; event detail pages with source links and
freshness timestamps; search plus date/category/location filters; at least two
real data sources; a scheduled ingestion job with retries and structured error
reporting; a normalized event model with provenance and duplicate handling;
iCalendar export; anonymous browser-stored bookmarks; proper empty/loading/
stale/error states; automated tests on the critical paths; and setup and
operations documentation.

### Explicitly post-MVP

Accounts, personalized recommendations, notifications, maps, and natural-language
questions. Each is gated on evidence from real usage, not on wanting to build it.

### Explicitly non-goals

Replacing official UVA calendars; scraping sources whose terms forbid it;
guaranteeing complete coverage; private events or messaging; **generating event
details with a language model**; and native mobile apps before the web product
is validated.

The LLM non-goal is worth internalizing: in a product whose entire value is
trustworthy provenance, a model that invents a plausible-sounding event time is
not a feature that occasionally misfires — it destroys the one thing the product
sells. This is why AI sits in the post-MVP section behind a measured baseline
rather than at the center.

## 5. Architecture and the reasoning behind it

Every decision below is really a decision about *what complexity to refuse*.
That framing is the most useful one to carry into a conversation about it.

### Modular monolith plus a separate worker

One deployable application, internally divided into clear modules — sources and
ingestion, parsing and normalization, events and organizations, deduplication
and provenance, search, bookmarks, admin and observability — plus one separate
worker process.

**Why not microservices:** a solo developer cannot operate a distributed system.
Microservices trade local complexity for network complexity — partial failure,
distributed tracing, versioned contracts, independent deploys — and buy team
autonomy and independent scaling, neither of which applies to one person. The
module boundaries are kept clean specifically so a service *could* be extracted
later if scale ever justified it, which is the cheap half of the benefit.

**Why the worker is separate:** ingestion is long-running and bursty. Sharing a
process with request handling means a slow feed parse competes with page loads.
Splitting them is the one distribution boundary that pays for itself immediately.

### Database-backed jobs, not a message queue

Scheduled ingestion runs are rows in Postgres, claimed with `SELECT … FOR UPDATE
SKIP LOCKED`, rather than messages in Redis, RabbitMQ, or SQS.

**Why:** a queue is a whole additional system to run, monitor, back up, and pay
for. Postgres is already a dependency, and this pattern handles far more
throughput than a campus events aggregator will ever produce. The plan commits
to adopting a real queue *only after measurement shows the simple version
failing* — which is the important part, because it converts "we might need a
queue" from a hunch into a testable claim.

### PostgreSQL for storage and search

One datastore. Full-text search via `tsvector` columns and GIN indexes rather
than a separate Elasticsearch or OpenSearch cluster.

**Why:** relevance quality is genuinely worse than a dedicated search engine —
fewer analyzers, cruder ranking. But a second datastore means a second thing to
keep in sync, and sync bugs produce results that silently disagree with the
database. At MVP scale Postgres FTS is adequate, and `ts_headline` even provides
the match highlighting the plan wants.

### Provenance as a hard constraint

Every event permanently retains its source URL, source identifier, and
first-seen / last-seen / last-synchronized timestamps. Merges keep every
contributing source and must be reversible.

**Why:** an aggregator is a copy of someone else's data, and copies go stale. The
product's honest position is not "trust us" but "here is what we saw, here is
where it came from, here is when we last looked." Reversible merges matter
because deduplication *will* be wrong sometimes, and an irreversible merge turns
a ranking mistake into permanent data loss.

### Parsers tested against saved fixtures

Parser tests run against saved copies of real source payloads, never live
network calls. Live-source checks run on a separate schedule, outside ordinary CI.

**Why:** an external site changing its markup should fail a scheduled canary, not
a pull request that has nothing to do with it. A test suite that fails randomly
stops being read, and a test suite nobody reads is worse than no test suite —
it provides false confidence at real cost.

### Staged deduplication

1. Exact match on source-provided IDs
2. Canonical URL match
3. Deterministic similarity — normalized title, organization, start time, venue
4. Human review for ambiguous, high-impact matches
5. Learned ranking **only** once a labeled evaluation set exists

**Why in this order:** cheapest and most certain first. Stages 1 and 2 are free
and nearly always right. Stage 5 is last not because ML is bad but because you
cannot tell whether a model helped without labeled data to measure against — so
the labeled set is the prerequisite, not the model.

## 6. The pipeline, stage by stage

```text
Approved public source
        |
        v
    Fetcher  ──────► raw snapshot (retained briefly, if permitted)
        |
        v
  Source parser   ← the only stage that knows this source's format
        |
        v
 Normalized candidate
        |
        v
Validation + deduplication
        |
        v
   PostgreSQL + search index
        |
        v
      API ────────► web client
```

The load-bearing property is **stage isolation**: each stage has one job and one
failure mode. A source whose HTML changed breaks its parser only. A single
malformed record is logged and skipped — it does not fail the batch. A source
that is down produces a failed run, not deleted events.

That last one is subtle and important: **a source failing to return an event
must never be interpreted as the event being cancelled.** Distinguishing "the
organizer cancelled it," "the source deleted it," "the source is temporarily
broken," and "the event happened and aged out" is a real modeling problem, and
collapsing them is how aggregators start lying to users.

Other properties worth being able to explain:

- **Idempotency.** Running ingestion twice produces one row, not two. This
  requires a defined natural key — `(source_id, source_event_id)` where the
  source provides a stable ID, with a documented fallback hash where it doesn't.
- **Bounded exponential backoff** on retries, so a struggling source is not
  hammered.
- **A traceable run ID** on every ingestion run, so structured logs from one run
  can be pulled together after the fact.
- **Metrics per run:** duration, records processed, changes, failures, and
  source freshness.

## 7. The data model and the hard parts

### Each normalized event carries

A stable internal ID; title and description; start/end with explicit timezone;
venue name, address, optional coordinates; hosting organization; category and
tags; cost; accessibility details; **original URL and source identifier**;
source publication time; first-seen, last-seen, last-synchronized timestamps;
cancellation/stale status; and a duplicate-group ID with merge history.

### The five genuinely hard problems

These are open, and being able to articulate *why they're hard* is more valuable
than having solved them.

**Recurring events.** iCalendar feeds — the format the project prefers — express
weekly club meetings as a single event with an `RRULE`, not as many events. You
must decide whether to expand recurrences into concrete instances at ingest time
or store a series plus materialized instances. The choice touches the stable ID,
idempotency, deduplication, "last seen" semantics, and calendar export. Deciding
after data is loaded means a migration.

**Event status lifecycle.** The states (`active`, `cancelled_by_source`,
`missing_from_source`, `superseded`, `expired`) and the thresholds between them
need to be explicit before the first write. The threshold has a trap in it:
"missing from N consecutive runs" must count only *successful* runs, or a source
outage silently marks every event missing.

**Organization identity.** Organization is currently a text field on an event,
but deduplication wants to use it as a *match key*. Three sources will spell the
same club three ways. This needs organizations to be a real entity with a
normalized name and an alias table — which is also what makes "filter by
organization" work at all.

**The idempotency key.** The fallback hash for sources without stable IDs is
where idempotency quietly breaks: include a description field that the source
reformats, and every run creates duplicates while all the tests still pass.

**Sanitizing imported HTML.** Event descriptions arrive as third-party HTML and
get rendered in a browser. That is textbook stored XSS, and it is the single most
likely real security vulnerability in this product. It needs an explicit tag and
attribute allowlist plus hostile test fixtures — `<script>`, `javascript:` URLs,
event-handler attributes, `srcdoc`.

## 8. Tools: what's actually in use vs. proposed

The stack is decided now (ADR-0003) and the walking skeleton runs on it — this
section changed the most since the plan audit.

### Actually in use today

| Package | Role |
| --- | --- |
| `packages/core` | Event model, Zod schemas, the ADR-0001 natural key and fingerprint, ADR-0002 sanitization — no I/O |
| `packages/db` | `node-pg-migrate` migrations, a hand-written SQL query layer (no ORM — ADR-0003), seed data |
| `packages/web` | Fastify + Eta templates, server-rendered, no client JS required |
| `packages/worker` | The `SELECT ... FOR UPDATE SKIP LOCKED` job queue and poll loop from OVERVIEW.md §8 |

| Tool | Role |
| --- | --- |
| Git + GitHub | Version control, branches, pull requests |
| Claude Code | Agentic development in remote cloud containers |
| npm workspaces | Monorepo; TypeScript project references build packages in dependency order |
| PostgreSQL 16 | Local via `docker-compose.yml`, or a native install — both documented in the README |
| Vitest | 43 tests, real database integration tests, not mocks |
| Biome | Lint + format, one config, zero separate tools |
| GitHub Actions | CI on every pull request — lint, build (which typechecks), migrate, test |
| Markdown in-repo | All planning, decisions, and research |
| ADR practice | Three records written (Proposed) — schema/lifecycle, sanitization, stack |
| `.gitignore` | Enforces the no-secrets and no-raw-interview-notes rules mechanically |

### Still proposed / deferred

| Layer | Status |
| --- | --- |
| `packages/ingest` — real source fetching and parsing | Not started; Milestone 2 |
| Object storage for raw payloads | Deliberately deferred — Postgres is enough at this scale |
| Monitoring beyond structured logs | Proposed |
| Hosting | Deliberately deferred to Milestone 4 in ADR-0003 — the skeleton runs entirely locally |

**Say "proposed," not "chosen"** for anything still in this second table —
that distinction is what survives a follow-up question.

### Candidate data sources

Eight inventoried; none approved. The lead candidate is **Hoos Involved**, which
runs on Anthology Engage and — per the vendor's documentation — supports public
Events RSS and iCal feeds that a campus administrator enables. That makes it a
*sanctioned feed rather than a scrape*, which is exactly what the source policy
prefers.

Two caveats recorded: the feeds may be switched off at UVA, and the platform
migrated from Presence recently, so its URLs and payload shapes aren't settled.

Note the research caveat: this was compiled from web search in an environment
that blocks `virginia.edu`, so no feed URL was actually confirmed. Everything is
tagged unverified, with the verification commands written down.

## 9. Roadmap and where the line is

| # | Milestone | Exit criterion, in one line |
| --- | --- | --- |
| 0 | Discovery | Two viable source strategies, agreed scope, ADRs written |
| 1 | Walking skeleton | A new contributor can clone, run, and see seeded events |
| 2 | First real source | Repeated imports create no duplicates; parser tests need no network |
| 3 | Discovery MVP | All MVP journeys work on mobile and desktop; no critical a11y issues |
| 4 | Deploy + validate | Stable demo, tested ops procedures, five usability sessions |
| 5 | Personalization | Only if Milestone 4 shows real demand |
| 6 | Documentation | Every public claim backed by a reproducible measurement |

**Milestone 1 is a walking skeleton** — app, worker, and database running end to
end on *seeded fake data*, with no live source. This ordering is deliberate: it
proves the entire path works before coupling early progress to an unstable
external website. Debugging a parser and a deployment simultaneously is much
harder than debugging either alone.

A realistic bar: **Milestones 0–3 constitute success.** Milestone 4 is a stretch
goal, and 5–6 are opportunistic. Stopping at 3 with a working, honest,
well-tested aggregator is a good outcome, not a failure.

## 10. Open decisions

Three of the four records that blocked Milestone 2 are written — all status
**Proposed**, meaning drafted with reasoning and ready for review, not yet
formally accepted:

- **ADR-0001, event schema and lifecycle** — recurrence expansion, the status
  enum and its three-run threshold, all-day/multi-day/TBD times, the natural
  key. Checked against a real Hoos Involved feed pull; the addendum records
  what that confirmed and what it left untested (see §7).
- **ADR-0002, imported-content sanitization** — the HTML allowlist, applied
  on write. Implemented and tested against the hostile fixture set in §7.
- **ADR-0003, stack and hosting** — TypeScript end to end, npm workspaces,
  Fastify, `pg` with hand-written SQL, database-backed jobs. Hosting itself
  stays deliberately deferred to Milestone 4 inside this same record.

Still open:

- **Organization identity** — first-class entity with aliases, or drop
  organization from the dedup match. Not urgent; it doesn't bite until
  Milestone 3's deduplication work.
- Whether the seeded demo source counts toward the MVP's "two sources";
  whether the admin surface (assigned to Milestones 2–3 in `OVERVIEW.md`) is
  a CLI, as recommended, or something else.
- Two real bugs the build itself surfaced and fixed, worth knowing the shape
  of even though they're resolved: Postgres never treats `NULL = NULL` as
  equal, so the natural key's uniqueness needed `NULLS NOT DISTINCT` partial
  indexes rather than a plain constraint — a plain one would have silently
  let every re-imported non-recurring event duplicate. And the documented
  setup flow only migrated `hoosradar_dev`, not the separate `hoosradar_test`
  database the test suite needs — found by literally following the README
  from a clean database, fixed by having the test suite migrate itself.

## 11. Known risks

| Risk | Mitigation |
| --- | --- |
| Source format changes | Isolated parsers, fixtures, freshness alerts, fast disablement |
| Collection disallowed | Review terms first, prefer feeds and APIs, honor removal requests |
| Wrong event details | Keep source links, show freshness, never infer, accept reports |
| Duplicate/conflicting records | Retain provenance, reversible merges, measure on labeled examples |
| Scope creep | Treat the MVP list as a boundary; require evidence to cross it |
| No real users | Interview early; validate before personalization |
| Free hosting limits | Keep deployment portable; document a full local demo path |
| AI becomes the product | Build strong conventional search and baselines first |
| Can't explain the system | Decision records, architecture notes, walkthroughs |

Two the audit added: the critical path is gated on human-only work (interviews),
which is the most likely way this stalls; and free Postgres tiers often provide
no automated backups, which collides with Milestone 4's backup and restore
exercise.

## 12. Vocabulary

Terms worth being able to define cold.

| Term | Meaning |
| --- | --- |
| **Idempotent** | Running an operation twice has the same effect as running it once — re-importing creates no duplicates |
| **Provenance** | The recorded origin of a piece of data: which source, which URL, when it was seen |
| **Modular monolith** | One deployable unit with enforced internal module boundaries |
| **Walking skeleton** | A minimal end-to-end implementation of the whole path, before any feature is real |
| **ADR** | Architecture decision record — a short document capturing a decision, its alternatives, and its consequences |
| **Upsert** | Insert-or-update in one atomic operation, keyed on a natural key |
| **Natural key** | The real-world identifier used to recognize a record across runs, e.g. `(source_id, source_event_id)` |
| **Normalization** | Converting source-specific shapes into one internal schema |
| **Canonical URL** | The single authoritative URL for a resource, used to match records across sources |
| **Precision / recall** | Of the pairs we merged, how many should have been (precision); of the pairs that should have merged, how many did (recall) |
| **Fixture** | A saved copy of real input, used so tests are deterministic |
| **iCalendar / `.ics`** | The standard calendar interchange format (RFC 5545) |
| **`RRULE`** | The iCalendar field expressing a recurrence rule |
| **`UID`** | The iCalendar field giving an event a stable identifier across fetches |
| **RSS / Atom** | XML syndication formats many sites publish for listings |
| **ETag / Last-Modified** | HTTP headers enabling conditional requests — "send it only if it changed" |
| **Exponential backoff** | Retrying with geometrically increasing delays, so a struggling source isn't hammered |
| **`SKIP LOCKED`** | Postgres clause letting many workers claim different rows from one queue table without blocking |
| **`tsvector` / GIN** | Postgres full-text search type and the index that makes it fast |
| **Cursor pagination** | Paging by a stable pointer rather than an offset, so results don't shift mid-scroll |
| **Structured logging** | Logs as machine-parseable key/value records rather than prose |
| **Run ID** | An identifier tying every log line and metric from one ingestion run together |
| **p75 / p95** | The value below which 75% / 95% of measurements fall — tail latency, not the average |
| **LCP** | Largest Contentful Paint — how long until the main content is visible |
| **WCAG 2.2 AA** | The accessibility conformance level being targeted |
| **Stored XSS** | Attacker-controlled script persisted by the server and later executed in a victim's browser |

## 13. Talking about this project

The strongest version of this story is not "I built an app." It's **"I made a
series of deliberate engineering decisions and can defend each one, including
the ones I chose not to make yet."** That is genuinely rarer.

Some framings that hold up:

- **On refusing complexity.** "I chose a modular monolith with one worker over
  microservices, and database-backed jobs over a message queue. Both were about
  matching operational complexity to a one-person team. The plan commits to
  adopting a real queue only after measurement shows the simple one failing."

- **On correctness in the pipeline.** "The interesting constraint is that a
  source failing to return an event doesn't mean the event was cancelled. You
  have to distinguish cancellation, deletion, source outage, and aging out —
  otherwise the aggregator starts lying to users during an outage."

- **On testing.** "Parser tests run against saved fixtures rather than live
  sites, so an external site changing its markup fails a scheduled canary
  instead of an unrelated pull request. A flaky suite stops being read."

- **On scope.** "Accounts, recommendations, and notifications are all post-MVP
  and gated on evidence. The MVP list is written as a hard boundary specifically
  so that wanting to build something isn't sufficient reason to."

- **On AI.** "In a product whose value is provenance, a model that invents a
  plausible event time isn't a feature that occasionally misfires — it destroys
  the thing being sold. So generating event details is an explicit non-goal, and
  ranking only comes after a measurable conventional baseline."

- **On what you'd do differently.** The audit found recurrence unmodeled, no
  event status lifecycle, organization identity undefined, and no path to the
  labeled data the dedup metrics require. "I audited my own plan and found the
  schema decisions that get expensive after the first import" is a good answer to
  a question about catching problems early.

Two things to avoid. **Don't overstate what's built** — a working local
skeleton with a tested schema is real and worth saying plainly, but it is not
a deployed product and it ingests no live source yet; one follow-up question
("so it's live?") will surface the gap if the phrasing implied otherwise.
**Don't cite numbers you haven't measured**; the
project's own rules forbid it, and the performance targets in the plan are
explicitly labeled as targets rather than results.

## 14. Where everything lives

| Path | What it is |
| --- | --- |
| `NEXT_STEPS.md` | Status and exact next steps — the short doc, read this before this one |
| `OVERVIEW.md` | The authoritative plan — scope, requirements, architecture, roadmap |
| `CLAUDE.md` | Working guardrails; green flags, red flags, stop-and-ask list |
| `README.md` | Entry point, document map, and the actual setup/run instructions |
| `docs/HANDBOOK.md` | This file |
| `docs/reviews/2026-08-31-plan-audit.md` | Audit of the plan; ~30 findings by severity |
| `docs/discovery/student-interview-guide.md` | Interview protocol for Milestone 0 |
| `docs/decisions/` | Three ADRs (Proposed), plus the index and template |
| `docs/sources/` | Source policy records, the candidate inventory, and the verified Hoos Involved fixture |
| `packages/core`, `db`, `web`, `worker` | The walking skeleton — see §8 |
| `docker-compose.yml`, `.github/workflows/ci.yml` | Local Postgres, and the CI pipeline that runs on every pull request |

### The three rules that shape everything

1. **Provenance is never discarded.** Every event keeps its source and its
   freshness; merges are reversible.
2. **Nothing is invented.** Not event details, not metrics, not user counts.
3. **Simplest reversible thing first.** New infrastructure requires a measured
   reason, not an anticipated one.
