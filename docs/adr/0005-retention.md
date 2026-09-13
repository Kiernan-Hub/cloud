# 0005 — Retention: prune bytes, keep results

- **Status:** Accepted
- **Date:** 2026-09-09

## Context

Once scheduled runs became real (ADR 0006), storage grew without bound. Each
gate result stores up to 64 KB of stdout and 64 KB of stderr. A project with
five gates on an hourly schedule produces on the order of 15 MB a day in the
worst case — gigabytes a year, on somebody's laptop.

The obvious fix is to delete old runs. That fix is unavailable here: every
attempt stored is the flake evidence, and deleting repeated runs of the same
commit destroys the only trace a flaky gate leaves. It is the first red flag
in `CLAUDE.md`.

## Decision

Treat the row and its bytes as different things.

- **Gate results are never deleted.** The status, duration and metric value
  are what flakiness, pass rates, regressions and drift are computed from, and
  they are tiny.
- **Captured output ages out**, after `OUTPUT_RETENTION_DAYS` (default 30).
  `0` keeps it forever. The worker prunes on its tick; `gk prune` does it by
  hand, with `--dry-run` to see how much is stored first.

A pruned result sets `output_pruned`. Without that flag it would be
indistinguishable from a gate that printed nothing, and the run page and
`gk show` would report "no output captured" — blaming the gate for our
housekeeping. They say it aged out of retention instead.

`OUTPUT_RETENTION_DAYS=0` means keep forever, but `gk prune --days 0` is
rejected rather than read as "delete everything", because the two would
otherwise mean opposite things one keystroke apart.

## Consequences

**Good**

- Bounded growth without touching the measurement.
- The expensive thing to keep and the valuable thing to keep turn out to be
  different things, so there is no tradeoff to make.

**Costs**

- Debugging a failure older than the window means re-running it. Acceptable:
  captured output has a short useful life, and the result still says what
  happened.
- A default that discards user data is a real decision. Chosen because
  unbounded growth on a local tool is worse, and because it is one environment
  variable to turn off.
- One more boolean column that every output-rendering path must check.

## Revisit if

Someone wants per-project retention, or wants failing runs kept longer than
passing ones — plausible, since failures are what people go back to read.
