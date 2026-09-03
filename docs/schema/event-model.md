# Event data model

This turns the prose field list in `OVERVIEW.md` §6 into a concrete schema. The
draft DDL lives in [`0001_initial.sql`](0001_initial.sql); this document explains
_why_ the tables are shaped this way. The DDL is a design draft — the executable
migration lands with Milestone 1 under the project's migration tooling.

## Design rules this schema has to satisfy

Four commitments from `OVERVIEW.md` and `CLAUDE.md` drive almost every choice
below:

1. **Provenance is never lost.** Every stored event traces to one source and one
   URL. Merging never destroys a contributing record.
2. **Imports are idempotent.** Running ingestion twice must not create a second
   copy of anything.
3. **Absence is not cancellation.** A source going down, an event being deleted,
   and an event being cancelled are three different facts and must be
   distinguishable.
4. **Nothing is silently overwritten.** Corrections are recorded, not applied
   destructively.

## Table map

```
sources ──┬── ingestion_runs ──── raw_snapshots
          │
          └── source_events ──┬── duplicate_group_members ──── duplicate_groups
                              │
                              └── organizations
```

### `sources`

The registry of approved sources, and the machine-readable half of the
source-policy checklist in `OVERVIEW.md` §9. `terms_url` and `terms_reviewed_at`
are not decoration: a source with no recorded terms review is a `CLAUDE.md` red
flag, and the admin surface should be able to list those.

`enabled` + `disabled_reason` exist so that honoring a removal request is one
UPDATE, not a deploy.

### `ingestion_runs`

One row per attempt, created when the run starts and updated when it ends. This
is simultaneously the job record (ADR 0004) and the observability record
(`OVERVIEW.md` §7): `id` is the traceable run identifier that appears in every
structured log line for that run.

`records_failed` being non-zero with `status = 'partial'` is the normal, healthy
representation of "a malformed record was logged and skipped" — the behavior
`CLAUDE.md` requires instead of failing the whole batch.

### `raw_snapshots`

Retained source payloads, for debugging and for reprocessing a parser without
re-fetching. Three things make this safe:

- `retain_until` gives every snapshot an expiry, so retention is bounded.
- `payload` is nullable — a source whose terms forbid retention gets metadata
  and a content hash only.
- `content_hash` lets ingestion detect "nothing changed" without storing bytes.

### `source_events`

**One row per event per source.** This is the single most important structural
decision in the schema, so it is worth stating plainly: a deduplicated event is
_not_ a row here. It is a group of rows (see `duplicate_groups`).

Idempotency is enforced by `UNIQUE (source_id, source_event_key)`. Ingestion
upserts on that key. `source_event_key` is whatever the source gives us as a
stable identifier — an iCalendar `UID`, an RSS `guid`, an API id — and if a
source has none, the parser derives one deterministically and documents how.
A parser that cannot produce a stable key produces duplicates on every run, so
this is a required part of onboarding a source, not an afterthought.

The three timestamps do distinct work:

| Column           | Meaning                                                |
| ---------------- | ------------------------------------------------------ |
| `first_seen_at`  | when HoosRadar first imported this event               |
| `last_seen_at`   | when the event was last _present in_ a source response |
| `last_synced_at` | when we last successfully _checked_ the source         |

Rule 3 above falls out of this: `last_synced_at` recent but `last_seen_at` stale
means the event disappeared from a working source. `last_synced_at` also stale
means the source itself is failing, and we must not infer anything about the
event. The UI's "last checked" timestamp is `last_synced_at`.

`status` (`scheduled` / `cancelled` / `postponed`) is only ever set from an
explicit signal in the source. Disappearance never writes `cancelled`.

`content_hash` covers the material fields, so `last_material_change_at` can be
updated only when something a user would care about actually changed — a source
re-publishing an identical event should not look like fresh information.

`search_vector` is a generated `tsvector` with weighted fields (title heaviest,
then organization and venue, then description), maintained by Postgres rather
than by application code so it cannot drift from the row.

### `organizations`

Separate table so events can be filtered and grouped by host. `normalized_name`
is the dedup key (lowercased, punctuation and common suffixes stripped);
`display_name` is what the source called it. Both are kept — normalizing away
"UVA Department of Computer Science" into "cs" and losing the original would be
a provenance loss.

### `duplicate_groups` and `duplicate_group_members`

The join table is what makes merges **reversible**, which `OVERVIEW.md` §10
requires. Grouping never mutates or deletes a `source_events` row; it only adds
membership. Unmerging is deleting a membership row.

`duplicate_group_members.added_by` records which strategy matched — the staged
ladder from §10 (`exact_key`, `canonical_url`, `deterministic_similarity`,
`manual`) — and `match_score` records the score for the similarity stage. This is
exactly the data needed to measure precision and recall against a labeled sample
later, so the project can report dedup quality instead of asserting it.

`primary_event_id` on the group is a _display_ pointer, chosen by deterministic
field-precedence rules. It is not a statement that the other rows are less real.

### `corrections`

Reports of wrong data, from users or admins. Deliberately **not** an edit to
`source_events`. A correction is a separate fact with its own lifecycle
(`open` / `accepted` / `rejected`), and an accepted one changes what is
_displayed_ via an overlay — the imported value stays intact underneath. This is
the "track corrections instead of overwriting imported data" requirement.

## Deliberate omissions at this stage

- **No users or bookmarks table.** MVP bookmarks are anonymous and browser-side
  (`OVERVIEW.md` §5). Accounts are Milestone 5 and gated on evidence.
- **No PostGIS.** `latitude` / `longitude` are plain numerics for now; the
  extension goes in when maps do, and not before.
- **No materialized search index.** Postgres FTS on the generated column until
  measurement says otherwise.

## Open questions

1. **Recurring events.** Are they one row with a recurrence rule, or one row per
   occurrence? Current lean is one row per occurrence, with a shared
   `recurrence_group_key`, because filtering and search operate on occurrences.
   Deferred until a real source forces the answer — this is a Milestone 2
   decision and should get its own ADR.
2. **Category vocabulary.** Source categories are free text and will not agree.
   Whether we map them to a controlled vocabulary, and how, needs real data first.
   `category_raw` is stored now so that mapping is possible later without
   re-ingesting.
