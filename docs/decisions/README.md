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
| [0001](0001-event-schema-and-lifecycle.md) | Event schema and ingestion lifecycle | Proposed |
| [0002](0002-imported-content-sanitization.md) | Sanitizing imported content | Proposed |

Both are **Proposed**, not Accepted: they are drafted with a recommendation and
its reasoning so the decision can be reviewed and changed, not rubber-stamped.
Mark them Accepted once reviewed.

## Records currently owed

Identified by the plan audit (`docs/reviews/2026-08-31-plan-audit.md`) as
blocking Milestone 2:

1. **Stack and hosting** — language/framework, CI provider, deployment target,
   what triggers a scheduled ingestion run, the reference dataset used for
   performance measurement, and the backup/restore story. *Still owed; blocked
   on choosing a stack.*
2. **Organization identity** — whether organizations are a first-class entity
   with aliases; required before deduplication uses organization as a match key.
   *Still owed; follows ADR-0001.*

Drafted: event schema and lifecycle (ADR-0001) and imported-content
sanitization (ADR-0002). Both were written first because they are independent
of the stack, so they did not need to wait on it.
