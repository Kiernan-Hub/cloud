# 0004 — What counts as evidence

- **Status:** Accepted
- **Date:** 2026-09-10

## Context

Two of Gatekeeper's headline claims are inferences, not observations:

- **"This gate is flaky"** — inferred from the same gate producing two
  different answers for the same commit.
- **"This metric is drifting"** — inferred from a series of values.

Both were being drawn from evidence that could not support them, and both
produced a confident wrong answer on this project's own data.

**Flakiness.** The claim rests entirely on two runs having had the _same
input_. A commit SHA does not identify the code when there are uncommitted
changes on top of it. Running the gates, editing a file, and running again is
an ordinary development loop — and it was reported as `typecheck` being 100%
flaky, which is a lie that sends someone hunting a problem that is not there.

**Drift.** `findRegressions` compares the two most recent values. Two points
cannot distinguish noise from a trend. A coverage number that jitters a point
either way while sliding downward reports nothing whenever the last hop
happens to tick up, and when it does fire it reports the size of that one hop
rather than the size of the slide.

## Decision

State what each claim requires, and discard evidence that does not meet it.

**Flakiness requires a held-still input.** Results from a run with a dirty
working tree are excluded from flake detection and from the flake evidence
drill-down entirely. Not down-weighted — excluded. The runs are still stored
and still shown; they just do not get a vote on this particular question.

**A trend requires enough points to be a trend.** `metricDrift` compares the
median of the recent half of a window against the median of the earlier half.
Medians rather than means, so one bad reading can neither manufacture a trend
nor hide one. Each half must hold at least four points; below that, nothing is
reported.

Where evidence is insufficient the answer is `null` and the UI shows an em
dash — never `0%`.

## Consequences

**Good**

- The two metrics the product is named for stop producing confident false
  positives.
- "Commit or stash first" becomes a real instruction with a visible reason:
  `gk run --repeat N` on a dirty tree reports what it saw and refuses to call
  it flakiness.

**Costs**

- Fewer findings, and more em dashes. A developer who always works dirty will
  see no flake data at all until they run against a clean tree. That is the
  correct answer, but it will feel like the feature is broken, so the UI says
  why.
- Drift says nothing about a project with fewer than eight runs of a metric.
- Two ways of computing "is this getting worse" now coexist. They answer
  different questions — a step versus a slope — and the dashboard reports them
  as separate findings rather than merging them.

## Revisit if

A cheap way appears to identify the code in a dirty tree — hashing the working
tree, say — which would make dirty runs comparable to each other and let them
back in as evidence.
