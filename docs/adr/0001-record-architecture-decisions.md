# 0001 — Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-09-03

## Context

`OVERVIEW.md` states a project goal of being able to *explain* the system, not
just run it, and lists "student cannot explain the system" as a named risk.
Design decisions made silently in code are hard to recover later: the reasoning
disappears and only the result remains, which makes it impossible to tell a
deliberate tradeoff from an accident.

## Decision

Record every non-obvious architecture decision as a numbered ADR in
`docs/adr/`, following the format in this directory's README.

A decision is "non-obvious" if a competent contributor could reasonably have
chosen differently. Adding a lint rule is not an ADR. Choosing the database is.

## Consequences

**Good**

- The reasoning survives even when the decision is later reversed.
- Reviewing an ADR is cheaper than reviewing the implementation it implies, so
  bad ideas can be caught before they cost code.
- Milestone 6 (technical case study) has real source material instead of
  reconstructed memory.

**Costs**

- Writing overhead on every meaningful decision.
- ADRs go stale if superseding records are not written. Mitigated by requiring
  the index table in the README to be updated in the same commit.

## Alternatives considered

- **Document decisions in `OVERVIEW.md`.** Rejected: `OVERVIEW.md` describes the
  intended end state. Mixing time-ordered decisions into it makes both harder to
  read, and there is no natural place to record a reversal.
- **Rely on commit messages and PR descriptions.** Rejected: these are scattered
  across the history and are not discoverable by someone reading the repo cold.
