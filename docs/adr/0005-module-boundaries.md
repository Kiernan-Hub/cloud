# 0005 — Module boundaries by convention, not packages

- **Status:** Accepted
- **Date:** 2026-09-03

## Context

`OVERVIEW.md` §8 commits to a modular monolith with named internal modules, and
`CLAUDE.md` makes "keep source-specific parsing isolated from normalization and
storage logic" a green flag. The open question is *how* to enforce that
isolation.

The usual answer is a workspace with one package per module. That gives real,
compiler-enforced boundaries — and it also gives a build graph, cross-package
type resolution, and version-bumping ceremony, all before a single event has
been ingested.

## Decision

One package. Directory boundaries enforced by lint rules, not by package
manifests.

```
src/
  modules/
    sources/        source registry, terms metadata, enable/disable
    ingestion/      fetch, run lifecycle, retries, raw snapshots
    parsing/        per-source parsers — ONE directory per source
    normalization/  parsed payload -> canonical event candidate
    events/         event + organization persistence and reads
    dedup/          matching, grouping, merge/unmerge, provenance
    search/         query construction, ranking, filters
    admin/          source health, run inspection, duplicate review
  worker/           worker entrypoint and scheduler loop
  app/              Next.js routes (web + API)
  lib/              cross-cutting: db client, logging, config, errors
```

The rules, enforced by `eslint-plugin-boundaries` (or equivalent
`no-restricted-imports` config):

1. `parsing/*` may not import from `events/`, `dedup/`, `search/`, or `lib/db`.
   A parser takes bytes and returns a plain object. It does not know a database
   exists. **This is the load-bearing rule** — it is what makes a bad source
   unable to corrupt storage, and what makes fixture-based parser tests possible
   without a database.
2. `app/` may not import from `parsing/` or `ingestion/` internals. The web layer
   reads through `events/`, `search/`, and `admin/`.
3. Modules import each other only through their `index.ts`. Deep imports into
   another module's internals are a lint error.
4. `lib/` may not import from `modules/`. Dependencies point one way.

## Consequences

**Good**

- The boundaries that matter are enforced today, at close to zero tooling cost.
- Extraction to real packages stays available: a module that already obeys these
  rules is one `package.json` away from being separable, and by then we will know
  whether it is worth it.
- One `npm install`, one test command, one type-check. Fast feedback.

**Costs**

- Lint rules are weaker than compiler boundaries. A determined developer can
  disable a rule. Accepted: the audience is one to three people, and a rule that
  has to be deliberately suppressed still creates a visible decision point in the
  diff.
- No independent versioning or independent deployability. Not wanted yet.

## Revisit if

- A module needs to be deployed or scaled separately from the rest.
- Type-check or test time on the single package becomes a real drag (order of
  minutes, not seconds).
- More than one person needs to own a module independently.

## Alternatives considered

- **pnpm workspace, one package per module.** Rejected as premature: it buys
  enforcement we can approximate with lint, at the cost of build-graph complexity
  before Milestone 1 has shipped. This is the same red flag as reaching for
  microservices early, at a smaller scale.
- **No enforcement, convention only.** Rejected: conventions without a check
  erode, and the parsing/storage boundary is too important to leave to
  discipline.
