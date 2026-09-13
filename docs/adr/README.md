# Architecture decision records

Each ADR records one decision: the context that forced it, what was chosen, and
what the choice costs. ADRs are written to be **reversible** — recording a
decision is not a commitment to defend it forever.

## How to use these

- One decision per file, numbered sequentially: `NNNN-short-title.md`.
- Status is one of `Proposed`, `Accepted`, `Superseded by NNNN`, `Rejected`.
- When a decision changes, write a **new** ADR that supersedes the old one. Do
  not edit history out of an accepted ADR — the reasoning at the time is the
  point of the record.
- Keep them short. If an ADR needs more than a page, the decision is probably
  two decisions.

## Index

| ADR                                           | Title                                   | Status   |
| --------------------------------------------- | --------------------------------------- | -------- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions           | Accepted |
| [0002](0002-module-boundaries.md)             | Module boundaries by lint, not packages | Accepted |
| [0003](0003-run-verdicts.md)                  | Run verdicts, and always reaching one   | Accepted |
| [0004](0004-what-counts-as-evidence.md)       | What counts as evidence                 | Accepted |
| [0005](0005-retention.md)                     | Retention: prune bytes, keep results    | Accepted |
| [0006](0006-scheduled-runs-opt-in.md)         | Scheduled runs are opt-in per project   | Accepted |

Records from the project that previously occupied this repository are kept
under [`../archive/hoosradar-adr/`](../archive/hoosradar-adr/). They describe a
different product and do not apply here, but some of the reasoning was carried
forward — ADR 0002 in particular is adapted from that project's 0005.
