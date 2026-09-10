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
  a code problem. `--repeat` hunts one on demand.
- **Detects regressions and drift**: extracts a number from a gate's output
  (coverage, bundle size, test count) and tells you both when it drops in one
  step and when it is quietly sliding the wrong way over many runs.
- Shows pass rates, p95 durations, and captured output for every run.
- **Surfaces findings across every registered project** on the dashboard home
  page, so a flaky gate or a drifting metric does not wait to be discovered by
  someone opening each project in turn.
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

## Hunting a flaky gate

A gate that fails once and passes on a re-run is the most expensive kind: it
trains everyone to re-run instead of to read. `--repeat` is the deliberate
version of the measurement the tool is built on — run the same gates, the same
number of times, on one commit, and see whether they agree with themselves:

```bash
gatekeeper run --only test --repeat 10
```

```
  ✓ Steady               10/10 passed
  ~ Coinflip              4/10 passed  — disagreed with itself

FLAKY on e37a3de2: 1 gate(s) gave different answers across 10 attempts.
Same commit, same input, different result — that is a gate problem.
```

Exits non-zero when a gate disagrees with itself: finding the flake is the
point, so it is reported as a finding.

**Commit or stash first.** The claim rests on the input being held still, so
if the working tree is dirty Gatekeeper says what it saw but refuses to call
it flakiness — the commit does not identify the code that ran, and those
attempts are excluded from flake detection entirely.

Every attempt is stored, so the burst also feeds the flake rate on the
dashboard rather than being a one-off report.

The dashboard's **Flaky gates** section then lists each commit where a gate
contradicted itself, and links a passing run and a failing run of that same
commit side by side. A flake rate on its own is an accusation without
evidence; the cause is usually visible in the difference between the two
outputs.

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

## Regressions vs drift

These are two different findings and the dashboard reports them separately.

A **regression** is a step: the latest value is worse than the one before it,
or it has crossed a `threshold` you set. One commit is to blame, and you can
usually name it.

**Drift** is a slope: nothing broke in any single run, but the metric has been
sliding. Gatekeeper compares the median of the most recent runs against the
median of the same number before them.

Comparing two adjacent values cannot tell noise from a trend. A coverage
number that jitters a point either way while sliding downward reports no
regression whenever the last hop happens to tick up — and when it does fire,
it reports the size of that one hop rather than the size of the slide.
Medians of two halves see through that, and one bad reading can neither
manufacture a trend nor hide one.

Whatever history exists is used, up to the window — a young project still gets
an answer — but each half must hold at least four points. A trend claimed from
three data points is a guess, and the honest answer is to say nothing rather
than to print something shaped like a finding.

## Retention

Gate results are **never deleted**. They are the flake evidence, the pass
rates and the regression history, and they are tiny.

Their _captured output_ is a different thing: a debugging aid with a short
useful life, and almost all of the bytes — up to 128 KB per result, which on
an hourly schedule is gigabytes a year. So it ages out after 30 days by
default, while the results stay forever.

```bash
gatekeeper prune --dry-run    # how much output is stored, and what would go
gatekeeper prune              # drop output older than OUTPUT_RETENTION_DAYS
gatekeeper prune --days 7     # or a window you pick
```

The worker does this on its own tick too. Set `OUTPUT_RETENTION_DAYS=0` to
keep output forever.

A pruned result says so — the run page and `gatekeeper show` report "output
aged out of retention" rather than "no output captured", because the gate did
print something and it was our housekeeping that discarded it.

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

| Command                                 | What it does                                        |
| --------------------------------------- | --------------------------------------------------- |
| `npm run gk -- <cmd>`                   | CLI: `init`, `sync`, `run`, `show`, `prune`, `list` |
| `npm run dev`                           | Dashboard at localhost:3000                         |
| `npm run worker`                        | Runs projects that set a `scheduleMinutes`          |
| `npm test`                              | Unit + integration tests (needs Postgres)           |
| `npm run lint` / `typecheck` / `format` | Checks                                              |
| `npm run db:migrate`                    | Apply migrations                                    |

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
- **Output that aged out of retention says so**, rather than reading as a gate
  that printed nothing. Results are never deleted — only their output.

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

Design decisions and their costs are recorded as ADRs in
[`docs/adr/`](docs/adr/) — why a partial run is not a pass, why dirty runs are
not evidence of flakiness, why results are never deleted, and why the worker
does nothing until a repo asks it to.

Documentation for the previous project in this repo is archived under
[`docs/archive/`](docs/archive/).
