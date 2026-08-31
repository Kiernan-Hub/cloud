# HoosRadar plan audit — 2026-08-31

Scope of this review: everything currently in the repository — `OVERVIEW.md`,
`CLAUDE.md`, `README.md`, `docs/discovery/student-interview-guide.md` — plus
repository structure and history. No application code exists yet, so this
audits the plan and the repo's readiness to receive code, not an
implementation.

## Verdict

The plan is unusually strong for a pre-code project. Provenance, idempotency,
fixture-based parser tests, reversible merges, and "measure before you claim"
are all correct instincts, stated early, in the right places. Nothing here
needs to be torn up.

What it is *not* yet is **ready to receive code**. Three things stand out:

1. The plan requires artifacts (architecture decision records, per-source
   policy records, a prioritized backlog) that have **no home in the repo** and
   no template. Milestone 0 cannot be exited as written.
2. Several **schema-level decisions get much more expensive after the first
   real import** — recurring events, event status lifecycle, organization
   identity, and the idempotency key — and none of them are decided.
3. A few **internal contradictions** in `OVERVIEW.md` will cause arguments or
   rework later: what counts toward "two sources," whether error reporting is
   in the MVP, where the admin surface lives, and what actually gates
   Milestone 1.

Findings are grouped below and rated **High** (fix before writing code),
**Medium** (fix before the milestone it affects), **Low** (worth a line of
text).

---

## A. Repository hygiene and structure

| ID | Sev | Finding |
| --- | --- | --- |
| A1 | High | No `.gitignore` existed — **fixed in this pass** |
| A2 | Medium | Stray `testing1` file at repo root — **removed in this pass** |
| A3 | Medium | `README.md` was a stub — **rewritten in this pass** |
| A4 | Medium | No `LICENSE` — owner decision, not made here |
| A5 | Low | Repo is named `cloud`; the project is HoosRadar |
| A6 | High | Milestone 0 requires ADRs; no ADR directory or template — **scaffolded in this pass** |
| A7 | High | §9 requires a per-source policy record; no template — **scaffolded in this pass** |
| A8 | Medium | No backlog anywhere; zero GitHub issues |
| A9 | Medium | No CI configuration, no `.github/` |
| A10 | Low | Local `main` branch is stale at the initial commit |
| A11 | Medium | `CLAUDE.md` and `OVERVIEW.md` restate the same rules, and have already diverged on the MVP boundary |

**A1 — missing `.gitignore` (High).** The project has two explicit rules that a
missing ignore file directly undermines: "no secrets in logs or code" and, in
the interview guide, "do not commit raw interview notes to this public
repository." Both are currently enforced only by memory. A `.gitignore`
covering `.env*`, dependency directories, build output, and
`docs/discovery/notes/` has been added. This costs nothing now and prevents the
one class of mistake that is genuinely hard to undo in a public repo.

**A2 — `testing1` (Medium).** A connectivity-test file with trivia about
flamingos, committed to the root of the project repo. Removed; recoverable
from history at `0a9db59` if it is still wanted.

**A3 — README stub (Medium).** It read "Playing around with cloud." Milestone 1's
exit criterion is "a new contributor can follow the README, start the system,
view seeded events, run all checks, and understand the architecture" — the
README is load-bearing for a milestone gate. Rewritten to identify the project
and map the docs; the setup and run instructions land with Milestone 1, since
there is nothing to run yet.

**A4 — no license (Medium).** The repo is public and the plan intends to
publish a case study and invite reading. Without a license, the default is "all
rights reserved," which conflicts with that intent. This is a decision for the
owner, so nothing was added: MIT or Apache-2.0 are the conventional picks
(Apache-2.0 if patent-grant language matters to you, MIT otherwise).

**A5 — repo name (Low).** `cloud` vs HoosRadar. GitHub keeps redirects on
rename, so the cost only rises as links accumulate. Cheapest now if you want it.

**A6 / A7 — required artifacts have no home (High).** Milestone 0's exit
criteria and §16 items 2 and 4 both require documents the repo has no place to
put. The interview guide exists as a template; its two peers did not. Added as
empty scaffolding only:

- `docs/decisions/` with an ADR template and an index
- `docs/sources/` with a source-policy record template and an index

No decisions were made inside them — those are yours to write. See §F for the
four ADRs the rest of this audit says you owe.

**A8 — nothing tracks state (Medium).** Milestone 0's exit criteria include "a
prioritized backlog," and §16 item 5 says "convert Milestone 1 into small
issues," but there are zero issues on the repo and no backlog file. Right now
the only record of what is done is the git log. Recommendation: create one
GitHub milestone per roadmap milestone and file Milestone 1 as issues with the
acceptance criteria copied in. This also gives the "one milestone in progress
at a time" rule in `CLAUDE.md` something to point at.

**A9 — no CI (Medium).** Milestone 1 requires "formatting, linting, type
checking, unit tests, and CI." Adding a workflow *before* there is code to
check would be noise, so this is correctly deferred — but the CI provider and
the exact check list belong in the stack ADR, not discovered later.

**A11 — duplicated normative rules, already drifting (Medium).** The
"stop and ask before" lists in `CLAUDE.md` and `OVERVIEW.md` §15 are currently
identical, which is good but fragile — two copies of a rule drift the first
time one is edited. There is already one real divergence: `CLAUDE.md` states the
MVP as "browse/search/filter events, see where each one came from, export to a
calendar file, bookmark anonymously," while `OVERVIEW.md` §5 states a twelve-item
MVP that additionally requires two data sources, a scheduled ingestion job,
automated tests, documentation, and a demonstration. `CLAUDE.md` tells the
reader to treat the MVP list as "a hard boundary" — but a contributor or agent
reading only `CLAUDE.md` enforces a materially narrower boundary than the one in
`OVERVIEW.md`. Recommendation: make `OVERVIEW.md` §5 the single normative MVP
definition and have `CLAUDE.md` link to it rather than paraphrase it.

---

## B. Internal contradictions and ambiguity in the plan

**B1 — the critical path to any code is gated entirely on offline human work
(High).** Milestone 1 (walking skeleton) depends on no data source and no
interview finding — it is seeded fake data, scaffolding, and CI. But Milestone
0's exit criteria formally precede it, and §16 lists "build the walking
skeleton" as action six of six, behind five student interviews and a source
inventory. As written, the project cannot start writing code until scheduling,
recruiting, and interviewing five students is complete. That is the single most
likely way this plan stalls.

The plan's own closing paragraph already contains the resolution — "the first
implementation task should be the walking skeleton with seeded data, because it
validates the full application path without coupling early progress to an
unstable external source" — it just is not reflected in the milestone
dependencies. Recommendation: state explicitly that Milestone 1 runs **in
parallel** with Milestone 0, and that only **Milestone 2** is gated on the
source-vetting half of Milestone 0. Interviews gate scope changes, not
scaffolding.

**B2 — "two sources" is ambiguous, in a hard boundary (High).** §5 requires "at
least two approved public data sources, including a seeded/demo source for
reliable development." Read literally, one real source plus the demo fixture
satisfies the MVP. But Milestone 2 integrates one real source and Milestone 3
adds "a second approved source," implying two real ones — and deduplication,
which §5 and §10 both treat as MVP, is close to meaningless against a single
real source. Since `CLAUDE.md` instructs everyone to treat the MVP list as a
hard boundary, an ambiguous line in it will be argued about. Recommendation:
"two real external sources; the seed/demo source does not count toward this."

**B3 — error reporting is a journey and a metric but not a feature (Medium).**
§4's "verify information" journey ends with "the user can report an error
without directly overwriting imported data," and §13 measures "correction
reports per 100 displayed events." Neither §5's MVP list nor any milestone
builds a reporting path. Milestone 3's exit criterion is "all stated MVP
journeys work" — so the exit criterion references a feature that does not
exist. Recommendation: either scope the minimum honest version into Milestone 3
(a `mailto:` link with the event ID prefilled is a completely legitimate MVP
answer and preserves the "never overwrite imported data" property for free), or
move the journey and the metric to post-MVP.

**B4 — the admin surface is required but unassigned (Medium).** §6 specifies
five admin capabilities: view source health, disable a failing source,
reprocess a stored payload, review duplicate groups, and mark corrections. None
appear in §5's MVP list and none are assigned to a milestone — yet Milestone 2's
failure handling effectively needs "disable a source" and "reprocess a
fixture," and Milestone 3's dedup needs "review duplicate groups." Unassigned
scope tends to either get built ad hoc under time pressure or silently skipped.
Recommendation: assign the first three to Milestone 2 and the last two to
Milestone 3, and state that a protected CLI satisfies all five — §6 already
permits this, so make it the plan of record rather than an option.

**B5 — the Milestone 5 gate is circular (Medium).** Accounts are added "only if
validation shows durable bookmark demand." But MVP bookmarks live in
`localStorage`, and measuring durable demand implies usage analytics, which §7
says require a published privacy statement and consent design first — work not
scoped in any milestone. So the gate cannot currently be satisfied, which means
in practice it will either be skipped or waved through on vibes. Recommendation:
name the admissible evidence now. The cheapest honest option is qualitative:
"three or more of the five Milestone 4 usability participants independently
describe wanting their saved events on another device." That is measurable,
needs no analytics, and needs no privacy review.

**B6 — a promised question the MVP will not answer (Low).** §1 lists "What can I
attend between two classes or near my current location?" as a question the
product should answer, but geographic coordinates are optional in §6 and maps
are explicitly post-MVP in §5. Mark that clause as post-MVP so it does not
quietly become implied scope.

**B7 — standing PR instruction (Low).** §15 item 6 says to "commit coherent
changes with descriptive messages and create a pull request" as a standing
rule, which conflicts with how sessions are actually being run (pull requests on
request). Minor, but it is a normative line in the working agreement; align the
wording with actual practice.

---

## C. Schema and pipeline gaps that get expensive after the first import

These are the findings I would prioritize. Every one of them is cheap to decide
now and becomes a data migration plus a correctness review once real events are
in the database.

**C1 — recurring events are not mentioned anywhere (High).** The event model in
§6 has a single start and end. Real campus data is full of recurring events:
weekly club meetings, office hours, semester-long series — and iCalendar feeds,
which §9 explicitly says to prefer, carry them as `RRULE` rather than as
individual events. The decision you have to make is whether to expand a
recurrence into concrete instances at ingest time or store a series plus
materialized instances. It touches the stable identifier, idempotency, dedup,
"last seen" semantics, and calendar export — that is, nearly everything. Decide
before Milestone 2. My recommendation is expand to bounded instances (e.g. a
rolling horizon) with a `series_id` retained on each instance: it keeps the
query and dedup paths simple, and the `series_id` preserves the option to add
proper series handling later.

**C2 — no event status lifecycle (High).** §6 gets the hard part right —
"imported absence must not automatically mean an event was cancelled" and "the
pipeline should distinguish deletion, cancellation, temporary source failure,
and an event naturally aging out" — but never enumerates the states or the
thresholds. Without an explicit enum written down before the first upsert, this
becomes two or three ad hoc booleans discovered one bug at a time. Decide the
state set (something like `active`, `cancelled_by_source`, `missing_from_source`,
`superseded`, `expired`), the transition rules, and the specific threshold
("missing from N consecutive successful runs" — note *successful*, so a source
outage never triggers it). ADR-sized, one page.

**C3 — organization identity is undefined (High).** §6 treats the hosting
organization as a field on the event. §8 lists an "Events and organizations"
module. §10 stage 3 uses organization as a **match key** for deduplication. You
cannot match on organization while it is a free-text string that three sources
spell three ways. Either dedup stage 3 needs to drop the organization term, or
organizations need to be a first-class entity with a normalized name and an
alias table. Recommend the latter, decided before Milestone 3, because the
alias table is also what makes "filter by organization" work at all.

**C4 — all-day, multi-day, and TBD-time events (Medium).** Timezone handling is
called out explicitly, which is the right instinct and the usual source of pain
— but its close relatives are not. All-day events have no meaningful time and
must not be rendered as midnight; multi-day events break "what's happening
today" queries that assume a single start date; sources routinely publish
"time TBD." Same argument as C1: cheap as a nullable flag and a documented
convention now, a migration later.

**C5 — HTML sanitization deserves more than one line (Medium).** §7 says
"validate and sanitize imported content before rendering it," which is correct
but buried. This is the most likely real security bug in this specific product:
you are rendering attacker-influenceable HTML from third-party feeds, which is
textbook stored XSS. Recommendation: make the sanitization policy an explicit
allowlist decision (which tags and attributes survive), write it down, and add
unit tests with hostile fixtures — script tags, `javascript:` hrefs, event
handler attributes, `srcdoc` — to the parser fixture set. This fits neatly into
the existing fixture-based testing approach at no extra structural cost.

**C6 — raw payload retention is undefined (Medium).** "Retained for a limited
debugging window when allowed" — "limited" needs a number, because it drives
storage cost, the privacy posture, and whether object storage is needed at all.
Pick something like 30 days. Related: §8 item 6 lists object storage as
"optional," and it should stay optional for a long time — for MVP volumes,
payloads on disk or in a Postgres table are entirely adequate, and adding a
storage service early is exactly the kind of premature infrastructure the red
flags list warns about.

**C7 — the idempotency key is not specified (Medium).** §6 requires a "stable
internal identifier" and imports must be idempotent, but the natural key that
makes an upsert idempotent is never defined. In practice it needs to be
`(source_id, source_event_id)` where the source provides a stable ID, with a
documented fallback for sources that do not — typically a hash over a fixed
field set. That fallback is where idempotency silently breaks: if the hash
includes a description that the source reformats, every run creates duplicates
and the "running ingestion twice must not create duplicates" green flag fails
quietly. Write down the key and the fallback field set, and make "import the
same fixture twice, assert one row" a Milestone 2 test.

**C8 — how the scheduler actually runs (Low).** §8 item 5 chooses database-backed
jobs, which is the right call, but nothing says what *triggers* a run in
production: an in-process scheduler in the worker, or a platform cron hitting an
endpoint. On free hosting tiers, worker processes are commonly suspended when
idle, which silently breaks the in-process option. Fold this into the hosting
ADR rather than discovering it during Milestone 4.

---

## D. Measurement gaps — metrics with no path to being measured

The plan is admirably strict that "vanity metrics and invented numbers are not
acceptable." These are the places where it currently asks for a number it has
no way to produce, which is how invented numbers happen.

**D1 — nothing creates the labeled duplicate set (High).** §10 requires
tracking "precision and recall on a manually labeled duplicate test set before
claiming that deduplication is effective," and §13 lists it as a data-quality
metric. No milestone task builds that set. Recommendation: add to Milestone 3 —
"label roughly 100 candidate pairs drawn from the two live sources, stored as a
fixture" — and report precision/recall against it. Without this, dedup either
ships unmeasured or the exit criterion is quietly dropped.

**D2 — performance targets have no reference dataset (Medium).** "p75 LCP below
2.5s" and "p95 search below 500ms on the MVP dataset" are unfalsifiable while
"the MVP dataset" is undefined — 500ms at 500 events and at 50,000 events are
different claims. §13 itself demands that metrics be reported with sample size,
environment, and method, so the plan already knows the rule; §7 just does not
follow it. Fix the reference dataset (e.g. "5,000 events across two sources, on
the deployed free tier, measured with a named tool") when the stack ADR lands.

**D3 — most product metrics need analytics the MVP does not have (Medium).**
"Search-to-event-detail conversion," "exports per active user," "percentage of
searches returning at least one useful result," and "repeat usage" all require
event analytics, which §7 gates behind a published privacy statement, which no
milestone schedules. Recommendation: split §13's product metrics into two
labeled groups — those measurable at MVP without instrumentation (usability-session
success rate, plus all of the data-quality metrics, which come from your own
pipeline and need no user tracking) and those blocked on the privacy and consent
step. Otherwise the honest answer at Milestone 6 is "most product metrics are
unmeasured," discovered late.

**D4 — "no known critical issues" has no severity scale (Low).** Milestone 3's
accessibility exit criterion needs a definition to be a gate. Name the tool and
the rule: e.g. zero axe-core violations at "serious" or "critical" on the five
critical journeys, plus a manual keyboard pass. §12 already commits to automated
scans, so this is just making the threshold explicit.

**D5 — "a new contributor can understand the architecture" is unverifiable solo
(Low).** Milestone 1's exit criterion has no observer. A workable proxy: clone
the repo into a clean container with nothing preinstalled, follow the README
verbatim without touching anything else, and record the wall-clock time to
seeded events rendering. If it does not work from a clean clone, the criterion
is not met — and that is checkable by one person.

---

## E. Risks the plan under-weights

**E1 — free hosting vs. Milestone 4's operational exit criteria (Medium).** §14
correctly lists "free hosting limitations" as a risk, but Milestone 4 requires
backups, monitoring, source-freshness alerts, and §12 requires a backup
restoration exercise. Free Postgres tiers frequently provide no automated
backups at all, and free web tiers sleep. These collide. Recommendation: decide
hosting in an ADR early, and state up front that the backup/restore exercise may
be demonstrated as a scripted `pg_dump`/restore into a local database. That is a
perfectly legitimate demonstration of the procedure — it just needs to be the
plan rather than an improvisation under deadline.

**E2 — name and branding (Low).** "Hoos" is closely associated with UVA, and the
plan involves a public deployment carrying that name alongside aggregated UVA
content. Not a blocker for a student project, and not a reason to change
anything today — but worth one line in the plan to check institutional naming
and trademark guidance before public launch, since §15 already requires stopping
before "accepting legal terms on the owner's behalf."

**E3 — no time budget and no stated minimum success (Medium).** Six milestones,
solo, alongside coursework, with no effort estimates and no statement of what
"done enough" means. The practical risk is not overrun — it is that stopping at
Milestone 3 or 4, which would be a genuinely good outcome, reads as failure
against a six-milestone plan. Recommendation: state explicitly that Milestones
0–3 constitute the successful outcome, Milestone 4 is the stretch goal, and
Milestones 5–6 are opportunistic. This also reinforces the existing scope-creep
guardrail from the other direction.

**E4 — source-owner relations have no recorded path (Low).** The plan commits to
honoring removal requests and identifying the application in requests, but names
no contact address, no response expectation, and no place to log a request or a
disablement. The source record template added in this pass includes contact and
removal-request fields; the decision about what contact address to publish is
yours.

---

## F. Changes made in this pass

Deliberately limited to items that are unambiguous, reversible, and directly
serve "clean, organized, ready for future development." No decisions about the
product, the stack, or the license were made.

- Added `.gitignore` covering environment files, dependency and build
  directories, editor and OS noise, and `docs/discovery/notes/`.
- Removed `testing1` (recoverable at commit `0a9db59`).
- Rewrote `README.md` to identify the project, state the current stage
  honestly, and map the documents.
- Added `docs/decisions/` — ADR index and template, no content.
- Added `docs/sources/` — source-record index and template, matching the
  §9 checklist field for field, no content.
- Added this audit.

### The four ADRs this audit says you owe

Empty templates are not decisions. Based on the findings above, these are the
records that block Milestone 2, in priority order:

1. **Stack and hosting** — resolves A9 (CI provider), C8 (scheduler trigger),
   D2 (reference dataset and measurement environment), E1 (backup story).
2. **Event schema and lifecycle** — resolves C1 (recurrence), C2 (status
   states and thresholds), C4 (all-day/multi-day/TBD), C7 (idempotency key).
3. **Organization identity** — resolves C3; can follow the schema ADR but must
   precede Milestone 3's dedup work.
4. **Imported-content sanitization** — resolves C5; must precede rendering any
   real source content.

---

## G. Recommended order of work

1. Apply the `OVERVIEW.md` edits from §B — B1 (unblock Milestone 1 in parallel),
   B2 (define "two sources"), B3 (scope or drop error reporting), B4 (assign the
   admin surface). These are text edits and they unblock everything else.
2. Reconcile `CLAUDE.md` with `OVERVIEW.md` §5 per A11 — one normative MVP
   definition, linked rather than paraphrased.
3. Write ADR 1 (stack and hosting) and ADR 2 (event schema and lifecycle).
4. Create the GitHub milestones and file Milestone 1 as issues with acceptance
   criteria (A8).
5. Build the walking skeleton — which, after step 1, no longer waits on the
   interviews.
6. Run the five interviews in parallel; they gate Milestone 2's source work and
   any MVP scope change, not the skeleton.

## What this audit did not cover

There is no application code, no schema, no dependency manifest, and no
deployment configuration in the repository, so nothing was reviewed for
implementation correctness, dependency health, or security posture beyond what
the plan text asserts. The findings above are about the plan and the repository
structure only.
