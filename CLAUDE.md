# CLAUDE.md — Working Guide for This Repo

## What we're building

**Gatekeeper** — a local tool that runs your project's quality gates (lint,
typecheck, tests, build, anything else) and keeps the history, so you can see
which gates block you, which ones lie to you, and which metrics are drifting.

- Runs entirely on your own machine against your own repos. No external APIs,
  no accounts, no data leaves the machine.
- Not a hosted CI service and not a replacement for one. It is the thing that
  tells you what your gates have actually been doing.

## Architecture, briefly

Modular monolith plus a worker, one Postgres database.

```
CLI / dashboard ──▶ runs ──▶ runner ──▶ your repo's commands
                     │
                     ▼
                 PostgreSQL ──▶ analysis ──▶ dashboard
```

- **`runner/`** executes a command and reports what happened. It cannot import
  storage — enforced by lint. That keeps "what happened" separate from "what
  we recorded", and lets it be tested against real subprocesses with no
  database.
- **`runs/`** orchestrates a run and stores results.
- **`analysis/`** turns stored results into flakiness, reliability, and
  regressions.
- **`projects/`** is the registry of repos and their gates.

## The three ideas the design rests on

1. **Repetition is the measurement.** The same gate on the same commit can be
   run many times, and every attempt is stored. Deduplicating those would
   destroy the only evidence a flaky gate leaves. The claim rests on those
   attempts having had the _same input_, so runs from a dirty working tree are
   not admissible: a commit SHA does not identify the code when there are
   uncommitted changes on top of it. `gk run --repeat N` is the deliberate
   version of this — gather the evidence on purpose rather than waiting for it.
2. **Distinguish kinds of failure.** `failed` (ran, found a problem),
   `timed_out` (never finished), and `error` (could not run at all) need
   different responses from a human, so they are different statuses. A gate
   that could not run makes the verdict `error`, never a silent pass.
3. **Absence of data is not good news.** A gate never run twice has a flake
   rate of `null`, not `0%`. A project with no runs has a pass rate of `null`,
   not `0`. The UI shows an em dash.

## Green flags — keep doing these

- Every behavior change ships with a test. The analysis queries especially:
  they are the product, and a wrong one is worse than none.
- Keep `runner/` free of storage imports. If that rule ever feels
  inconvenient, that is the rule doing its job.
- Report honestly: a run with skipped records is `partial`, an interrupted one
  is `canceled`, a dirty working tree is labeled, truncated output says it was
  truncated. Neither `partial` nor `canceled` votes in a pass rate — they
  established nothing, and counting them either way invents news.
- A run always reaches a terminal status. A row left in `running` is filtered
  out of every statistic, so a crashed run would erase itself rather than
  report that it failed to finish.
- Bound everything that touches the outside world — timeouts on commands,
  caps on captured output, kills that take the whole process group.
- Small, reversible decisions, written down when non-obvious.
- Structured logs with a run ID on every line.

## Red flags — stop or rethink

- Deduplicating gate results by commit, or "cleaning up" repeated runs.
- Reporting a metric without a direction — a coverage drop and a bundle-size
  drop are opposite news.
- Treating a gate that failed to execute as a pass.
- Storing whole command output unbounded.
- Inventing data to make a chart look better, or showing `0%` where the honest
  answer is "no data".
- Reaching for a queue, a container runtime, or a hosted service before the
  simple local version has been measured.
- Running gates from a repo you do not trust — see below.

## Security note, stated plainly

Gate commands come from `gatekeeper.json` in a repo you point at, and
Gatekeeper executes them on your machine. That is the same trust level as a
Makefile or a CI workflow in the same repo. **Only point it at repos you
trust.** This is inherent to what the tool is, not a bug to be fixed, but it
should never be made worse — no fetching gate definitions from a network, and
no running gates from a source the user did not explicitly register.

The same reasoning makes **scheduled runs opt-in per project**
(`project.scheduleMinutes` in the repo's own config). A worker executing
someone's test suite on a loop, unasked, is exactly the kind of surprise this
trust model exists to prevent — so it happens only where the repo asked.

## Stop and ask before

- Spending money or provisioning a paid service.
- Making the tool execute anything it did not get from a local, user-registered
  config file.
- Sending any project data off the machine.
- Irreversible data or infrastructure changes.
- Deploying publicly.

Reversible implementation choices — dependencies, refactors, test fixtures —
don't need approval first.

## Learning note

Kiernan is building this to learn architecture, not just to ship it. When
finishing a meaningful step or making a real design call, pause and explain
what it demonstrates — briefly, not a wall of text.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
