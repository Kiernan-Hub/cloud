# 0006 — Scheduled runs are opt-in per project

- **Status:** Accepted
- **Date:** 2026-09-09

## Context

The worker was documented as running projects "on a schedule" and had none.
Every tick it ran every registered project's full gate suite; with the default
60-second tick that is every gate, on every repo, forever.

Fixing the cadence raises the real question, which is not "how often" but
"who asked". Gatekeeper executes commands out of a repo's `gatekeeper.json` on
the user's machine. Registering a project is an explicit act with a visible
result — you run `gk run` and watch it. A background process running your test
suite on a loop is a different thing, and discovering it by noticing your fans
are on is not the way to find out.

## Decision

Scheduled runs are opt-in per project, via `project.scheduleMinutes` in the
repo's own `gatekeeper.json`. A project that sets none is never run by the
worker, no matter how long the worker has been running.

`WORKER_TICK_SECONDS` becomes what it always claimed to be: how often the
worker _looks_.

Supporting choices:

- **Due-ness is measured from the last run that judged the full gate set.** A
  `partial` run does not reset the clock — it left gates unchecked, so it is
  not a substitute for the scheduled sweep — and neither does a `canceled` or
  still-running one. This falls out of ADR 0003 for free.
- **The clock counts any trigger, not just scheduled runs.** A manual full run
  ten minutes ago is fresh data; re-running it on the hour would burn CPU for
  nothing.
- **Minimum interval is 5 minutes.** A gate suite slower than its own cadence
  would run back-to-back forever, which is a busy loop wearing a schedule's
  clothes.
- **`gk sync` and `gk list` say which repos the worker will run unprompted**,
  so it is answerable without opening a config file.

## Consequences

**Good**

- Consistent with the trust model in `CLAUDE.md`: no running gates from a
  source the user did not explicitly ask to have run.
- Each project picks a cadence matched to how long its gates take.

**Costs**

- Scheduled runs do not work until you configure them, so the feature is
  invisible by default and someone will wonder why the worker does nothing.
  Mitigated by `gk sync` printing the state every time.
- The cadence lives in the repo, not in Gatekeeper, so changing it means
  editing the repo and re-syncing. That is the right place — it is a fact
  about the project — but it is a second step.

## Revisit if

Per-project schedules turn out to be the wrong granularity — a per-gate
cadence would let a slow build run nightly while lint runs hourly, which is
plausibly what people actually want.
