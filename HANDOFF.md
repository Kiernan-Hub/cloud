# Handoff

Working state for picking this up in a new session. Say "resume where we left
off" and start here.

`CLAUDE.md` is the durable guide to _how to work on this repo_ — read that
too. This file is only _where things currently stand_, and it goes stale;
treat anything here older than the git log as suspect and verify.

**Last updated:** 2026-09-10, after PR #7 was pushed and went green.

---

## TL;DR

Everything is pushed and CI is green. **Nothing is in flight and nothing is
broken.** There is one open question that is the user's to answer, in
[The open decision](#the-open-decision) below.

---

## Where the work is

|         |                                                                                    |
| ------- | ---------------------------------------------------------------------------------- |
| Branch  | `claude/project-clarification-06gx7l` (do **not** push elsewhere without asking)   |
| PR      | [#7](https://github.com/Kiernan-Hub/cloud/pull/7) — open, `mergeable_state: clean` |
| Head    | `bd5cad1` — 12 commits, 39 files, +5206 / −221                                     |
| Base    | `main` at `36105d8`, unmoved since the branch started                              |
| CI      | `check` and `docker` both green                                                    |
| Reviews | No review threads. Two comments on the PR, both mine (status notes)                |
| Tests   | 124 passing                                                                        |

A check-in routine re-verifies the PR roughly hourly and re-arms itself
silently while nothing changes. It should stop once the PR is merged or
closed.

---

## Getting the environment working

**Postgres is not running when the container comes back.** This is the single
biggest time-waster — the test suite fails 88 of 124 tests and it looks like
the code is broken. It is not.

```bash
pg_ctlcluster 16 main start     # then pg_isready to confirm
```

The rest of the setup, if starting from a truly fresh container:

```bash
npm install
cp .env.example .env
# Docker is NOT available in this sandbox — docker compose up will not work.
# Postgres 16 is installed locally instead; the .env defaults already match it.
su postgres -c "psql -c \"CREATE USER gatekeeper WITH PASSWORD 'gatekeeper_dev' SUPERUSER;\""
su postgres -c "createdb -O gatekeeper gatekeeper"
npm run db:migrate
```

Useful checks:

```bash
npm run gk -- run          # run Gatekeeper's own gates (dogfooding; best signal)
npx vitest run             # 124 tests, needs Postgres
npm run dev                # dashboard on :3000
```

Screenshots need `executablePath: "/opt/pw-browsers/chromium"`, and the script
must live inside the repo so it can resolve `playwright`.

---

## What this branch did

Full detail is in the PR description. The short version: dogfooding the tool
on itself found several places where it claimed more than its evidence
supported, plus features it was designed around but never offered.

1. `--only` runs recorded as `passed` → now `skipped` results and a `partial` verdict
2. Crashed/interrupted runs sat in `running` and vanished from every stat → runs always reach a terminal status; Ctrl-C also stopped orphaning the gate's process group
3. Flake detection counted dirty runs and flagged this repo's own `typecheck` at 100% flaky → dirty runs are no longer admissible evidence
4. The worker re-ran every project every tick → per-project opt-in `scheduleMinutes`
5. Captured output grew without bound → ages out after 30 days; **results are never deleted**
6. `gk run --repeat N` to hunt a flake deliberately
7. Flaky-gate drill-down linking a passing and a failing run of the same commit
8. Drift detection (medians of two halves) alongside step-change regressions
9. Cross-project findings on the dashboard home page
10. `gk show`, `gk prune`, `gk forget`
11. Fixed the `docker` CI job, which had been red on `main` for two separate reasons
12. `gk init` no longer needs a database it doesn't use
13. A registered repo that goes away no longer error-loops, and is flagged in the UI

`docs/adr/` was re-established with six ADRs recording these decisions and
what each costs. Read those before reversing anything — each has a "revisit
if" section.

---

## The open decision

**I recommended shipping PR #7 rather than growing it further, and the user
has not answered.** 5,200 lines is too much for one careful review, and I did
not want to keep piling on after saying so.

The PR description suggests a split if that helps: _honesty fixes_ (1–5) /
_new capabilities_ (6–10) / _CI and operational_ (11–13). Those groups are
independent.

So the next move is one of:

- **Ship it** (whole, or in those three pieces)
- **Authorize a second branch** for follow-up work — I am pinned to
  `claude/project-clarification-06gx7l` and cannot open another without
  explicit permission
- **Keep going on this branch anyway** — fine if that's the call, just say so

If asked to continue building, the two candidates I'd pick:

- **Per-gate schedules.** A slow build nightly while lint runs hourly. Already
  flagged in ADR 0006 as the likely next question.
- **A coverage metric on Gatekeeper's own gates.** `@vitest/coverage-v8` is
  installed and unused; wiring it up would dogfood the metric and drift
  features on real data.

Neither is started.

---

## Things worth knowing before you touch anything

**Dogfood before trusting green tests.** Every significant bug this session
came from running the thing, not from the suite. The 100%-flake false
positive, the orphaned `sleep 60` surviving Ctrl-C, the worker error-loop —
all found by using it, all invisible to a passing test run.

**Review your own work at the end.** Running `/code-review` on my last commit
caught that I had reintroduced the exact bug the branch exists to fix: I
suppressed a noisy log and thereby made a broken project _silent_, which is
the same failure in a new coat. Worth repeating on the next batch.

**Two of my own assumptions were wrong and the tests caught them.** I claimed
`findRegressions` misses a monotonic slide — it doesn't. And my first drift
window demanded 20 data points, so it said nothing about a project with 12,
which is most young projects. Verify claims against actual behavior before
encoding them in a test comment.

**Watch out for orphaned background processes in your own test harness.**
`kill` on an `npx` parent leaves the `tsx` child running. Four stray workers
accumulated and silently competed for the same project's schedule, which made
several test runs read as a code failure. Use `setsid` + `pkill -f`, and check
`ps -eo pid,args | grep "[w]orker/index.ts"` when worker behavior looks wrong.

**Scratch projects exist in the local dev database** (`drift-demo`,
`flake-demo`, and repos under the scratchpad). They are local only, not in the
repo, and `projectsDueForRun` is global — so a test that asserts on the whole
project list will break. `projects.test.ts` scopes to its own fixtures for
exactly this reason.

---

## The idea to carry forward

Nearly every change here came from one move: **separating what you measured
from what you are entitled to conclude from it.**

A skipped result is a fact about the run, not the gate — stored, but excluded
from the gate's pass rate. A dirty run happened, but is not admissible
evidence of flakiness. A result row is the measurement; its captured output is
a debugging aid — so one is kept forever and the other ages out.

Once that distinction is named, a lot of "should we delete / count / show
this" questions stop being tradeoffs and just have answers. ADR 0004 is the
written-up version.
