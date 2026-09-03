# HoosRadar

A campus event discovery app for the University of Virginia. It pulls events
from scattered public UVA and student-organization calendars into one searchable
place, and keeps a link to the original source plus a visible "last checked"
timestamp on every event.

**Status: pre-implementation.** The architecture is decided and the data model
is drafted; no application code exists yet. Milestone 1 (the walking skeleton)
is the next build.

## Documentation

| Document | What it covers |
| --- | --- |
| [`OVERVIEW.md`](OVERVIEW.md) | Product scope, requirements, roadmap, and success metrics |
| [`CLAUDE.md`](CLAUDE.md) | Working guardrails — green flags, red flags, what needs owner approval |
| [`docs/adr/`](docs/adr/) | Architecture decision records: stack, hosting, jobs, module boundaries |
| [`docs/schema/`](docs/schema/) | Event data model and draft DDL |
| [`docs/sources/`](docs/sources/) | Data-source policy, vetting checklist, and inventory |
| [`docs/discovery/`](docs/discovery/) | Student interview guide and synthesis template |
| [`docs/milestones/`](docs/milestones/) | Per-milestone work breakdowns with acceptance criteria |

## Planned stack

TypeScript, Next.js (App Router), PostgreSQL 16 with Drizzle, and a separate
Node worker process for ingestion. Reasoning and alternatives considered are in
[ADR 0002](docs/adr/0002-technology-stack.md).

Setup instructions land with Milestone 1 — see the
[walking-skeleton breakdown](docs/milestones/milestone-1-walking-skeleton.md).

## Where the project stands

| Milestone | State |
| --- | --- |
| 0 — Discovery and decisions | In progress: architecture decided, schema drafted. **Student interviews and source vetting still outstanding.** |
| 1 — Walking skeleton | Not started; broken into 12 issues with acceptance criteria |
| 2–6 | Not started |

Milestone 0 cannot close until five students have been interviewed and at least
two viable data sources have been vetted. Both require real-world work that
cannot be inferred from the repository.
