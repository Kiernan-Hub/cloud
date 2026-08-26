# Architecture decision records

This folder holds short records of decisions that are costly to reverse or
that a future contributor (including future-you) would otherwise have to
reconstruct from git history: the stack, hosting, the job system, the
database, and similar structural choices. It is not for routine or easily
reversible implementation choices — see `CLAUDE.md` for what does and does
not need one.

## Process

1. Copy `template.md` to a new file named `NNNN-short-title.md`, where `NNNN`
   is the next zero-padded number (`0001-`, `0002-`, ...).
2. Fill in Context, Decision, and Consequences. Write the context as of the
   time of the decision — don't edit it later to match hindsight.
3. Set Status to `Proposed` while still deciding, `Accepted` once settled.
4. If a later decision replaces this one, set this record's status to
   `Superseded by ADR-NNNN` and link to the new record. Don't delete or
   silently rewrite old records — the history of why is the point.

## Index

| ADR | Title | Status |
| --- | --- | --- |
| — | — | No decisions recorded yet |
