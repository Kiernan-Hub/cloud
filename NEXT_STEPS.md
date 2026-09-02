# Where things stand, and what's next

A short status/handoff doc — read this first when picking the project back up.
For the deep explanation of any of this, see `docs/HANDBOOK.md`. For the full
plan, `OVERVIEW.md`.

- **Last updated:** 2026-09-02, after building the Milestone 1 walking skeleton
- **Current branch:** `claude/hoosradar-plan-audit-xrurqf`, pushed, PR not yet opened

## Where we are

**Milestone 1 (walking skeleton) is built and verified.** App, worker, and
database run end to end on seeded demo data. 43 tests pass; CI runs them on
every pull request. The stack is decided (ADR-0003, TypeScript end to end) and
running, not just proposed.

**Milestone 2 (first real ingestion source) has not started.** `packages/ingest`
does not exist. The worker honestly fails any non-`seed` source rather than
faking success — see `packages/worker/src/processors.ts`.

**What's real vs. not**, precisely, since this matters for how to describe it:

- Real: the schema, the query layer, the sanitizer (tested against hostile
  fixtures), the job queue, the web app rendering seeded events.
- Real but not yet used for anything live: a verified real feed pull from Hoos
  Involved, saved as `docs/sources/fixtures/hoosinvolved-engage-2026-09-02.ics`
  — 63 real events, confirmed no `RRULE`, confirmed no `TZID`, confirmed stable
  `UID`s. Nothing in the app has parsed it yet.
- Not real: any live source integration, any deployment, any of the five
  student interviews.

## Immediate next steps, in order

1. **Build `packages/ingest`** — the first real parser, against the saved
   Hoos Involved fixture. Concretely: parse the `.ics` fixture with `ical.js`,
   normalize each `VEVENT` into a `NormalizedCandidate` (from
   `packages/core/src/event.ts`), assume `America/New_York` for this source
   specifically (the fixture has no `TZID` — see ADR-0001's addendum), and
   upsert through the natural key already built in `packages/db`. Test against
   the fixture, never a live network call, per `OVERVIEW.md` §12.
2. **Register the source properly** — add a real `Source` row with
   `method: 'ical'` and the real feed URL, and complete
   `docs/sources/hoosinvolved-engage.md` before flipping its status to
   `approved`. That still needs: the owner contact, a terms review, and the
   `robots.txt` / conditional-request checks listed at the bottom of that file
   — none resolvable from an environment that can't reach `virginia.edu`.
3. **Wire it into the worker** — `packages/worker/src/processors.ts` currently
   has one branch (`seed`); add the `ical` branch calling the new parser.
4. **Prove idempotency for real** — the walking skeleton's tests prove the
   *mechanism* (`constraints.test.ts`); Milestone 2's exit criterion needs a
   test that imports the real fixture twice and asserts one row per event.
5. Only after that: the discovery interviews (they gate scope changes and the
   second source, not the skeleton — see `OVERVIEW.md`'s Milestone 1
   sequencing note) and the organization-identity ADR (needed before
   Milestone 3's deduplication work, not before this).

## Open decisions

- **Organization identity** (docs/decisions/README.md) — not urgent, doesn't
  block Milestone 2.
- Whether the seeded demo source counts toward the MVP's "two sources" —
  doesn't block anything yet either.
- The three written ADRs (0001, 0002, 0003) are status **Proposed**, not
  **Accepted** — a deliberate choice so they're recorded and reviewable, not
  rubber-stamped. Mark them Accepted in `docs/decisions/README.md` once
  reviewed, or supersede them if reality disagrees.

## Known gotchas (already fixed, but worth knowing about)

- `npm run build` after manually deleting a `dist/` folder can report
  "everything is up to date" and be wrong — TypeScript's incremental cache
  doesn't notice a manually deleted output. Run `npm run clean` first.
- Tests run against `hoosradar_test`, never `hoosradar_dev` — the test suite
  truncates and re-migrates itself on every run (`vitest.global-setup.ts`).
  Never point `.env.test` at the same database as `.env`.
- `dev:web`, `dev:worker`, and `seed` all load `.env` themselves now; if you
  add a new CLI entry point later, it needs the same `dotenv.config(...)` line
  near the top or it'll silently fail to see `DATABASE_URL`.

## How to verify any of this yourself

```sh
npm run lint && npm run build && npm test
```

All three are also what CI runs on every pull request. If they're green here,
they're green there.
