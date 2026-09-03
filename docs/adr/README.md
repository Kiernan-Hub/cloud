# Architecture decision records

Each ADR records one decision: the context that forced it, the options
considered, what was chosen, and what the choice costs. ADRs are written to be
**reversible** — recording a decision is not a commitment to defend it forever.

## How to use these

- One decision per file, numbered sequentially: `NNNN-short-title.md`.
- Status is one of `Proposed`, `Accepted`, `Superseded by NNNN`, `Rejected`.
- When a decision changes, write a **new** ADR that supersedes the old one.
  Do not edit history out of an accepted ADR — the reasoning at the time is the
  point of the record.
- Keep them short. If an ADR needs more than a page, the decision is probably
  two decisions.

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-technology-stack.md) | Technology stack | Accepted |
| [0003](0003-hosting-and-deployment.md) | Local-first development, deferred deployment | Accepted |
| [0004](0004-job-mechanism.md) | Database-backed jobs, no queue broker | Accepted |
| [0005](0005-module-boundaries.md) | Module boundaries by convention, not packages | Accepted |
