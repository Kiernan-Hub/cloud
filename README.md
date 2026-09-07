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

| Field              | Meaning                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `blocking`         | `false` runs and records the gate but does not fail the run. Good for a check you are trialling.                                      |
| `timeoutSeconds`   | The gate is killed (whole process group) and recorded as `timed_out`, which is distinct from `failed`.                                |
| `metric.pattern`   | Regex with one capture group, applied to the gate's output. Invalid regexes are rejected when the config loads, not silently ignored. |
| `metric.direction` | Required with a metric. Without it, a coverage drop and a bundle-size drop look the same.                                             |

Commands run under `/bin/sh`, not bash. Bash-only syntax (`$RANDOM`, `[[ ]]`,
arrays) will not behave as you expect — wrap it in `bash -c "..."` if you need it.

## Scripts

| Command                                 | What it does                                |
| --------------------------------------- | ------------------------------------------- |
| `npm run gk -- <cmd>`                   | CLI: `init`, `sync`, `run`, `flake`, `list` |
| `npm run dev`                           | Dashboard at localhost:3000                 |
| `npm run worker`                        | Runs every registered project on a schedule |
| `npm test`                              | Unit + integration tests (needs Postgres)   |
| `npm run lint` / `typecheck` / `format` | Checks                                      |
| `npm run db:migrate`                    | Apply migrations                            |

## Hunting a flaky gate

When you suspect a gate is unreliable, make it prove it:

```bash
npm run gk -- flake --gate test --times 10
```

It re-runs that gate on the current commit and stops as soon as it catches a
disagreement:

```
   1 ✗ test    6ms
   2 ✗ test    5ms
   3 ✓ test    5ms

FLAKY  Tests: passed 1/3 on the same commit.
       Same input, different answer — that is a gate problem,
       not a code problem.
```

If it never disagrees, the tool says so precisely — _"no flakiness observed in
10 attempts, which does not rule it out"_ — because ten passes cannot rule out
a one-in-fifty flake. Exits non-zero when flakiness is observed. `--all` runs
every attempt instead of stopping early.

## How it reports things

A few deliberate choices that make the numbers trustworthy:

- **Every attempt is stored**, including repeat runs of the same commit. That
  repetition is the only evidence a flaky gate leaves, so it is never
  deduplicated.
- **A gate never run twice shows `—`, not `0%` flake rate.** No evidence is not
  evidence of reliability.
- **A dirty working tree is labeled.** That result cannot be reproduced from
  the commit alone, and the run page says so.
- **A gate that could not execute is `error`, not `failed`**, and makes the
  whole run `error` rather than being quietly counted as a pass.
- **Truncated output says it was truncated.** The tail is kept, since that is
  where the failure is.

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
