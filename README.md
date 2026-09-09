# Gatekeeper

Run your project's quality gates and keep the history. Gatekeeper tells you
which gates block you, which ones are **flaky**, and which metrics are
**drifting** — from your own repos, on your own machine, with nothing sent
anywhere.

It is not a hosted CI service. It is the thing that tells you what your gates
have actually been doing.

## What it does

- Runs the commands you define (lint, typecheck, tests, build, anything) and
  records every result with the commit it ran against.
- **Detects flaky gates**: the same gate on the same commit producing both a
  pass and a fail. Same input, different answer — that is a gate problem, not
  a code problem.
- **Detects regressions**: extracts a number from a gate's output (coverage,
  bundle size, test count) and tells you when it moves the wrong way.
- Shows pass rates, p95 durations, and captured output for every run.
- Exits non-zero on failure, so `gatekeeper run` works as a pre-push hook.

## Requirements

- Node.js 22 (LTS)
- Docker (for local Postgres), or any Postgres 16

## Setup

```bash
npm install
cp .env.example .env
docker compose up -d       # Postgres on :5432
npm run db:migrate
```

## Using it

From inside any repo on your machine:

```bash
cd ~/code/your-project
npm run gk --prefix ~/code/gatekeeper -- init   # writes gatekeeper.json
# edit the gates to match your project
npm run gk --prefix ~/code/gatekeeper -- sync   # register it
npm run gk --prefix ~/code/gatekeeper -- run    # run the gates
```

Then start the dashboard:

```bash
npm run dev     # http://localhost:3000
```

To read a run's output without leaving the terminal:

```bash
gatekeeper show              # the latest run, gates that did not pass
gatekeeper show 3a148aa9     # a specific run
gatekeeper show --all        # include the gates that passed
```

## Scheduled runs

Gatekeeper can re-run a project's gates on a cadence, so slow-moving problems
— a dependency bump, an expiring certificate, a bundle creeping upward — get
caught even when nobody pushed anything.

This is **opt-in per project**. Add a cadence to `gatekeeper.json`:

```json
"project": { "id": "my-app", "name": "My App", "scheduleMinutes": 60 }
```

then `gatekeeper sync` and run the worker:

```bash
npm run worker
```

Without `scheduleMinutes`, the worker never touches the project. Scheduled
runs execute the repo's own commands on your machine, so they happen only
where the repo's config asked for them — never as a default.

`WORKER_TICK_SECONDS` is how often the worker _looks_, not how often it runs
anything; each project keeps its own cadence. `gatekeeper list` shows which
repos the worker will run unprompted:

```
  my-app        every 1h       /home/you/code/my-app
  scratch       manual only    /home/you/code/scratch
```

A project is due when its last run that **judged the full gate set** is older
than its interval. A `partial` run does not reset that clock — it left gates
unchecked, so it is not a substitute for the scheduled sweep — and neither
does a `canceled` or still-running one. The minimum interval is 5 minutes: a
gate suite slower than its own cadence would run back-to-back forever, which
is a busy loop wearing a schedule's clothes.

## Configuring gates

`gatekeeper.json` in the repo root:

```json
{
  "project": { "id": "my-app", "name": "My App" },
  "gates": [
    { "key": "lint", "name": "Lint", "command": "npm run lint" },
    {
      "key": "test",
      "name": "Tests",
      "command": "npm test -- --coverage",
      "timeoutSeconds": 600,
      "metric": {
        "name": "coverage",
        "pattern": "All files\\s+\\|\\s+([\\d.]+)",
        "direction": "higher_is_better",
        "threshold": 80
      }
    },
    {
      "key": "build",
      "name": "Build",
      "command": "npm run build",
      "blocking": false
    }
  ]
}
```

| Field                     | Meaning                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `project.scheduleMinutes` | Opt in to worker-run gates at this cadence. Omit and the worker never touches the project. Minimum 5.                                 |
| `blocking`                | `false` runs and records the gate but does not fail the run. Good for a check you are trialling.                                      |
| `timeoutSeconds`          | The gate is killed (whole process group) and recorded as `timed_out`, which is distinct from `failed`.                                |
| `metric.pattern`          | Regex with one capture group, applied to the gate's output. Invalid regexes are rejected when the config loads, not silently ignored. |
| `metric.direction`        | Required with a metric. Without it, a coverage drop and a bundle-size drop look the same.                                             |

## Scripts

| Command                                 | What it does                               |
| --------------------------------------- | ------------------------------------------ |
| `npm run gk -- <cmd>`                   | CLI: `init`, `sync`, `run`, `show`, `list` |
| `npm run dev`                           | Dashboard at localhost:3000                |
| `npm run worker`                        | Runs projects that set a `scheduleMinutes` |
| `npm test`                              | Unit + integration tests (needs Postgres)  |
| `npm run lint` / `typecheck` / `format` | Checks                                     |
| `npm run db:migrate`                    | Apply migrations                           |

## How it reports things

A few deliberate choices that make the numbers trustworthy:

- **Every attempt is stored**, including repeat runs of the same commit. That
  repetition is the only evidence a flaky gate leaves, so it is never
  deduplicated.
- **A gate never run twice shows `—`, not `0%` flake rate.** No evidence is not
  evidence of reliability.
- **A dirty working tree is labeled**, and its runs are left out of flake
  detection entirely. Flakiness means the same input gave a different answer,
  and a commit SHA does not identify the code when there are uncommitted
  changes on top of it — otherwise editing a file between two runs would be
  reported as the gate contradicting itself.
- **A gate that could not execute is `error`, not `failed`**, and makes the
  whole run `error` rather than being quietly counted as a pass.
- **A run that checked only some gates is `partial`, not `passed`.** The gates
  it left out are recorded as `skipped`, so `--only lint` cannot later be
  mistaken for a full green run.
- **An interrupted run is `canceled`.** It established nothing, so it counts
  neither for nor against the gates, and Ctrl-C kills the running gate's whole
  process group rather than leaving a test runner going in the background.
- **Truncated output says it was truncated.** The tail is kept, since that is
  where the failure is.

### Run statuses

| Status     | Meaning                                                        |
| ---------- | -------------------------------------------------------------- |
| `passed`   | Every enabled gate ran, and nothing blocking failed.           |
| `partial`  | Nothing failed, but not every enabled gate ran (`--only`).     |
| `failed`   | A blocking gate ran and failed or timed out.                   |
| `error`    | A blocking gate could not run at all — the verdict is unknown. |
| `canceled` | Interrupted before reaching a verdict.                         |

`partial` and `canceled` runs are excluded from the pass rate rather than
counted as passes or failures, and the dashboard says how many there were so
the denominator is never a mystery. Likewise, a `skipped` result does not
touch a gate's own pass rate or duration percentiles — being left out of
someone else's `--only` run says nothing about the gate.

## A note on trust

Gate commands come from `gatekeeper.json` and are executed on your machine —
the same trust level as a Makefile or a CI workflow in the same repo. **Only
point Gatekeeper at repos you trust.**

## Architecture

See [`CLAUDE.md`](CLAUDE.md). The short version: a modular monolith plus a
worker over one Postgres database, where `runner/` (which executes commands)
is prevented by lint from importing storage — keeping "what happened" separate
from "what we recorded about it".

Documentation for the previous project in this repo is archived under
[`docs/archive/`](docs/archive/).
