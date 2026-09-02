# HoosRadar

A campus event discovery site for the University of Virginia. It pulls events
from scattered public UVA and student-organization calendars into one
searchable place, and keeps a link back to the original source plus a visible
"last checked" timestamp on every event.

**Status:** pre-code. Milestone 0 (discovery) is in progress — no application,
worker, or database exists yet. See the roadmap in `OVERVIEW.md`.

## Repository map

| Path | What it is |
| --- | --- |
| `OVERVIEW.md` | Product scope, requirements, architecture, roadmap, and testing strategy |
| `CLAUDE.md` | Working guide: guardrails, green/red flags, approval boundaries |
| `docs/discovery/student-interview-guide.md` | Interview script and note template for the five discovery interviews |

## Current work

Milestone 0 — discovery and decisions:

1. Interview five students with the discovery guide and write an anonymized
   synthesis.
2. Inventory candidate event sources and complete the source-policy checklist
   (`OVERVIEW.md` §9) for each.
3. Write architecture decision records for stack, hosting, and job system.
4. Break Milestone 1 (walking skeleton) into issues with acceptance criteria.

Raw interview notes are never committed to this repository.
