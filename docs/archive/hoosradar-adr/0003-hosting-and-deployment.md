# 0003 — Local-first development, deferred deployment

- **Status:** Accepted
- **Date:** 2026-09-03

## Context

`OVERVIEW.md` §16 lists an open question: should the first demonstration
optimize for local development or immediate public deployment? Deployment is
also gated — `CLAUDE.md` requires owner approval before spending money or
deploying publicly.

Deploying early is genuinely tempting: it surfaces environment problems sooner
and makes progress visible. But at Milestone 1 there is nothing to show a user
except seeded fake data, and a public URL serving invented campus events is
actively bad — it is the exact "fabricated event details" failure the project
has committed to avoiding.

## Decision

Develop local-first through Milestone 3. Deploy at Milestone 4, not before.

Specifically:

1. `docker compose up` starts Postgres. Nothing else is containerized during
   development — the app and worker run directly via `npm run dev` / `npm run
worker` so stack traces and reloads stay fast.
2. The app reads all configuration from environment variables with a documented
   `.env.example`. No host-specific APIs, no vendor SDKs in application code.
3. A `Dockerfile` for the app and worker lands in Milestone 1 and is exercised
   in CI, so the deployable artifact is never theoretical — but it is not
   deployed anywhere.
4. Target host is decided at Milestone 4, from evidence. Current expectation is
   a container host with a free or low-cost tier that can run two processes plus
   managed Postgres. **No account will be created and no terms accepted without
   explicit owner approval.**

## Consequences

**Good**

- No spend, no legal terms accepted, no public URL, until there is something
  real to put behind them.
- Portability is maintained by construction rather than by a later migration.
- Milestone 4's exit criteria (backups, monitoring, security review) get done
  properly instead of being retrofitted onto an already-live system.

**Costs**

- Environment-specific problems (TLS, cold starts, connection limits, cron
  reliability) surface later, when they are more expensive to fix. Partly
  mitigated by building and running the container image in CI from Milestone 1.
- "It works on my machine" risk is real and accepted for now.

## Alternatives considered

- **Deploy from Milestone 1.** Rejected: requires owner approval and possibly
  spend for no demonstrable benefit over seeded data, and risks publishing fake
  events.
- **Full Docker Compose for app + worker + database in development.** Rejected:
  slower feedback loop for a marginal fidelity gain. The Dockerfile in CI covers
  the build-correctness half of the benefit.

## Revisit if

- The owner needs a public demo before Milestone 4 (course deadline, advisor
  review). This is an owner decision, not a technical one.
