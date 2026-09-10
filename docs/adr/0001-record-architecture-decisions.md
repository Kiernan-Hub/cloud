# 0001 — Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-09-09

## Context

Gatekeeper is a tool about not overstating what you know, and a surprising
number of its design choices are choices about exactly that: what a run is
allowed to claim, which results count as evidence, what gets deleted. Several
of them look arbitrary from the code alone and obviously wrong to a reader who
has not seen the reasoning.

`CLAUDE.md` already asks for "small, reversible decisions, written down when
non-obvious". This is where they go.

The repository previously held a different project, which kept ADRs under
`docs/adr/`. Those were moved to `docs/archive/hoosradar-adr/` during the
pivot, and the directory was left empty — while `eslint.config.mjs` went on
citing `docs/adr/0005-module-boundaries.md` in four separate error messages
pointing at nothing.

## Decision

Keep ADRs for Gatekeeper in `docs/adr/`, numbered from 0001, following the
conventions in this directory's README.

Write one when a decision is non-obvious, costly to reverse, or likely to look
like a mistake to someone reading only the code. Do not write one for a choice
whose reasoning is legible from the diff.

## Consequences

**Good**

- The "why" survives the person who decided it, and survives a rewrite of the
  code that implemented it.
- A reviewer who disagrees has something specific to argue with.

**Costs**

- ADRs rot if nobody supersedes them. Mitigated by keeping them short and by
  treating a stale ADR as a bug rather than as history.

## Revisit if

The set stops being read — an ADR nobody consults is a cost with no benefit.
