# 0003 — Run verdicts, and always reaching one

- **Status:** Accepted
- **Date:** 2026-09-09

## Context

A run started as three outcomes: `passed`, `failed`, `error`. Two situations
did not fit, and both were being resolved by claiming something untrue.

**A run that checked only part of the gate set.** `gk run --only lint` stored
a `passed` run, byte-identical to a run that had checked everything. The gates
it skipped left no trace, so a project that had checked one of five gates
looked like a project with one gate.

**A run that never finished.** If the process died — an exception, Ctrl-C, a
`SIGKILL` — the row stayed `running` forever. Every statistic filters
`running` out, so the run did not show up as a failure; it did not show up at
all. A crashed run quietly erased itself.

## Decision

Six run statuses: `running`, `passed`, `partial`, `failed`, `error`,
`canceled`.

`partial` means nothing blocking failed but not every enabled gate ran. Gates
excluded by `--only` are stored as `skipped` results. Verdict precedence is
`error` > `failed` > `partial` > `passed`: a run that both failed and skipped
something is `failed`, because the failure is the actionable news and the
skipped gates are still listed on the run.

`canceled` means the run was stopped before reaching a verdict.

A run **always** reaches a terminal status. An exception closes it `error`,
an abort closes it `canceled`, and the worker reconciles rows older than 12
hours that a `SIGKILL` left behind.

Neither `partial` nor `canceled` votes in a pass rate. Both are counted and
named separately so the denominator is visible.

## Consequences

**Good**

- A partial run cannot later be mistaken for a full green one.
- A crashed run reports that it crashed instead of vanishing.
- The pass rate means one thing: of the runs that judged the whole gate set,
  how many passed.

**Costs**

- Two more enum values, and every consumer must decide what to do with them.
  Accepted: collapsing either into `passed` or `failed` invents news in one
  direction or the other, which is the failure mode this project exists to
  avoid.
- A `skipped` result is a row that is not a measurement, so every query over
  `gate_results` has to decide whether to exclude it. `gateReliability` does;
  `gateFlakiness` already did.
- The 12-hour reconciliation bound is arbitrary. It is deliberately far longer
  than any plausible gate suite, because closing a run that is genuinely still
  going would be a worse lie than leaving a dead one open for an afternoon.

## Revisit if

A third "did not reach a verdict" case appears that is neither an abort nor a
crash, or if `partial` turns out to be noise in practice because `--only` is
the normal way people run gates.
