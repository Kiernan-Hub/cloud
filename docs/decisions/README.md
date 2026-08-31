# Architecture decision records

Milestone 0 requires decision records for the stack, hosting, and job system,
and `CLAUDE.md` asks for "small, reversible, well-documented decisions." This
directory is where those live.

## How to use this

Copy `adr-template.md` to `NNNN-short-title.md`, using the next free number.
Keep each record to roughly one page. A record is written when the decision is
made, not after it is implemented, and it is never edited to hide a change of
mind — supersede it with a new record and mark the old one `Superseded by
ADR-NNNN`.

## Index

| ADR | Title | Status |
| --- | --- | --- |
| _none yet_ | | |

## Records currently owed

Identified by the plan audit (`docs/reviews/2026-08-31-plan-audit.md`) as
blocking Milestone 2:

1. **Stack and hosting** — language/framework, CI provider, deployment target,
   what triggers a scheduled ingestion run, the reference dataset used for
   performance measurement, and the backup/restore story.
2. **Event schema and lifecycle** — recurring events, event status states and
   the thresholds between them, all-day/multi-day/TBD times, and the
   idempotency key used for upserts.
3. **Organization identity** — whether organizations are a first-class entity
   with aliases; required before deduplication uses organization as a match key.
4. **Imported-content sanitization** — the HTML tag and attribute allowlist
   applied to source-provided content before rendering.
