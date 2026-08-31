# HoosRadar

A web app that pulls campus events from scattered UVA calendars and
organization pages into one searchable place — with a link back to the original
source and a visible "last checked" timestamp on every event.

**Current stage: planning and discovery.** There is no application code in this
repository yet. The first implementation task is a walking skeleton running on
seeded data (Milestone 1); setup and run instructions will land with it.

## Documents

| Document | What it is |
| --- | --- |
| [`OVERVIEW.md`](OVERVIEW.md) | Product scope, requirements, architecture, roadmap, and the working agreement |
| [`CLAUDE.md`](CLAUDE.md) | Working summary and guardrails for contributors and coding agents |
| [`docs/discovery/`](docs/discovery/) | Student interview guide for Milestone 0 |
| [`docs/decisions/`](docs/decisions/) | Architecture decision records |
| [`docs/sources/`](docs/sources/) | Per-source policy records; required before a source is integrated |
| [`docs/reviews/`](docs/reviews/) | Point-in-time reviews of the plan and the codebase |

## Ground rules

Every event keeps its source link and freshness timestamp, nothing is
invented, imports are safe to re-run, and parsers are tested against saved
fixtures rather than live network calls. The full set is in
[`CLAUDE.md`](CLAUDE.md).

## Status

This is a personal learning project and is not affiliated with or endorsed by
the University of Virginia.
