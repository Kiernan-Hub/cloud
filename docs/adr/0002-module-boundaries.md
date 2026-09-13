# 0002 — Module boundaries by lint, not packages

- **Status:** Accepted
- **Date:** 2026-09-09
- Adapted from the previous project's
  [ADR 0005](../archive/hoosradar-adr/0005-module-boundaries.md), which
  `eslint.config.mjs` still cited after that project's records were archived.

## Context

Gatekeeper is a modular monolith plus a worker over one database. One boundary
in it is load-bearing: `runner/` executes commands and reports what happened,
and it must not be able to reach storage.

That separation is what keeps "what happened" distinct from "what we recorded
about it". It is also what makes `runner/` testable against real subprocesses
with no database at all — the timeout, process-group kill, and output-cap
tests all spawn real processes and never touch Postgres.

The usual way to enforce a boundary is a package per module. That buys real
compiler enforcement and costs a build graph, cross-package type resolution
and version ceremony, for a codebase one person is working on.

## Decision

One package. Directory boundaries enforced by `no-restricted-imports`.

```
src/
  modules/
    runner/     execute a command, report what happened — NO storage
    runs/       orchestrate a run, store results
    analysis/   stored results -> flakiness, reliability, regressions, drift
    projects/   registry of repos and their gates
  worker/       scheduler loop
  cli/          the gatekeeper command
  app/          Next.js routes (dashboard + API)
  lib/          cross-cutting: db client, logging, config
```

The rules:

1. `runner/` may not import `runs/`, `projects/`, `analysis/`, or `lib/db`.
   **This is the load-bearing rule.**
2. `app/` may not import `runner/`. The web layer reads results through
   `runs/` and `analysis/`; it does not execute gates.
3. Modules import each other only through their `index.ts`.
4. `lib/` may not import from `modules/`. Dependencies point one way.

## Consequences

**Good**

- The boundary that matters is enforced today at near-zero tooling cost.
- Extraction to real packages stays available if it is ever worth it.
- One install, one test command, one typecheck.

**Costs**

- Lint is weaker than a compiler. A rule can be suppressed — but suppressing
  one is a visible line in a diff, which is most of the value.

## Revisit if

`runner/` needs to run somewhere the rest of the code does not, or typecheck
and test time become a real drag.

## Alternatives considered

- **Workspace, one package per module.** Rejected as premature: it buys
  enforcement lint approximates, at the cost of build-graph complexity.
- **Convention only, no check.** Rejected: conventions without a check erode,
  and this is the one boundary the testing story depends on.
