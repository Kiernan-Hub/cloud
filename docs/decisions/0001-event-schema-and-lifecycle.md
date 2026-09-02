# ADR-0001: Event schema and ingestion lifecycle

- **Status:** Proposed
- **Date:** 2026-09-01
- **Affects:** Milestone 2 (first ingestion path), Milestone 3 (deduplication)

## Context

The plan audit found four modeling questions that are cheap to decide now and
become data migrations once real events are stored: recurring events, the event
status lifecycle, time representation, and the key that makes imports
idempotent. All four are load-bearing for Milestone 2's exit criterion —
"repeated imports do not create duplicates, and a failed source does not remove
valid events."

These decisions are deliberately **independent of the stack**. They assume only
a relational database. Settling them before the stack ADR means the first
ingestion code has a target to hit rather than inventing one under pressure.

Two constraints from `OVERVIEW.md` shape everything below: provenance is never
discarded, and a source failing to return an event must never be read as that
event being cancelled.

## Decision

### 1. Recurring events are expanded into instances over a rolling horizon

Store an `event_series` row carrying the source's recurrence rule, and expand it
into concrete `event` rows for each occurrence within a **120-day forward
horizon**. Each instance keeps `series_id` and its own `occurrence_start`. A
scheduled job extends the horizon as time passes.

Single events are simply instances with no `series_id`, so every query path has
one shape.

`EXDATE` exclusions and per-instance overrides (iCalendar `RECURRENCE-ID`) must
be honored during expansion — a cancelled or moved single occurrence of a weekly
meeting is common and is exactly the case that makes naive expansion wrong.

**Why:** the alternative — storing the rule and expanding at query time — makes
every "what's on Tuesday" query an exercise in evaluating recurrence rules in
SQL, makes cross-source deduplication nearly impossible (you cannot compare a
rule to a concrete event from another source), and makes calendar export
awkward. Expansion costs storage, which is the cheapest thing to spend.

**The cost:** the horizon has to be maintained by a job, and a change to a
series requires re-expanding it. Both are ordinary work; getting the query path
wrong is not.

### 2. Event status is an explicit enum with a successful-runs threshold

```
active                 seen in the most recent successful run of its source
cancelled_by_source    the source explicitly says cancelled
missing_from_source    absent from N consecutive successful runs
superseded             merged into another event by deduplication
```

**`N = 3`.** A single absence can be a partial fetch or a paging bug; three
consecutive *successful* runs missing an event is real evidence. On a daily
schedule that is a three-day lag before an event is marked missing, which is an
acceptable trade against wrongly hiding a real event.

Three rules make this correct:

- **Only successful runs advance the counter.** A failed or partial run leaves
  every event untouched. This is the specific mechanism that keeps a source
  outage from looking like mass cancellation, and it is the easiest thing in
  this ADR to implement wrongly.
- **`missing_from_source` is not `cancelled_by_source`,** and must not be
  displayed as one. The honest rendering is "no longer listed at the source,"
  with the last-seen date shown.
- **Transitions are recorded, not overwritten.** An `event_status_history` row
  per transition, carrying the ingestion run ID that caused it. This is what
  makes a wrong transition diagnosable instead of invisible.

"Past" is **derived** from `end_at < now()`, never stored. A stored flag needs a
sweeper, and a sweeper that stalls silently makes past events look current.

### 3. Time is stored as an instant plus its original zone

| Column | Purpose |
| --- | --- |
| `start_at`, `end_at` | `timestamptz` — normalized, for range queries |
| `start_tz` | IANA zone name, e.g. `America/New_York` |
| `is_all_day` | Time components are meaningless when true |
| `start_time_unknown` | The source gave a date but no time |

**Why store the zone separately** when `timestamptz` already normalizes: the
original zone is needed to display "7pm local," and to expand recurrences
correctly across a DST boundary. A weekly 7pm meeting is 7pm before and after
the clocks change, which is not a fixed UTC offset. Discarding the zone makes
that unrecoverable.

Two query rules follow, both easy to get wrong:

- **"Events today" is an overlap test**, `start_at < day_end AND end_at >
  day_start` — not `start_at::date = today`, which silently drops every
  multi-day event already in progress.
- **All-day events must never render as midnight**, and events with
  `start_time_unknown` sort *after* timed events on the same date rather than at
  00:00.

### 4. The idempotency key is source UID plus occurrence start

Primary natural key:

```
(source_id, source_uid, occurrence_start)
```

`occurrence_start` is in the key because **iCalendar shares one `UID` across
every instance of a recurring series** — RFC 5545 identifies an instance by
`UID` *plus* `RECURRENCE-ID`. Keying on `UID` alone would collapse a weekly
meeting into a single row that thrashes on every import.

For sources with no stable identifier, fall back to a content fingerprint:

```
sha256(normalized_title ‖ start_at ‖ venue_name ‖ organization_name)
```

**The excluded fields matter more than the included ones.** Description and URL
are deliberately out, because sources reformat descriptions and add tracking
parameters to URLs. Including either means every import creates duplicates while
every test still passes — the failure mode is silent, which is why the field
list is written down here and changing it is treated as a migration.

Store both `source_uid` and `content_fingerprint` on every event, so a source
that later starts publishing stable IDs can be migrated without re-importing.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Store recurrence rules only, expand at query time | Recurrence evaluation in SQL on every query; cross-source dedup becomes intractable |
| Expand recurrences with no horizon | Unbounded rows for open-ended series; a weekly meeting with no end date never terminates |
| Boolean `is_cancelled` instead of an enum | Cannot distinguish cancelled from missing from merged — the exact conflation the plan forbids |
| Mark missing after one absent run | A single failed page of results wrongly hides real events |
| `timestamptz` alone, no zone column | DST-incorrect recurrence expansion; cannot display the source's local time |
| Fingerprint over all fields including description | Silent duplicate creation whenever a source reformats text |

## Consequences

Easier: every discovery query is a plain range scan over `event`; deduplication
compares concrete instances; calendar export is a direct mapping; a source
outage is visibly distinct from a cancellation.

Harder: recurrence expansion is real code with real edge cases, and the horizon
job is a moving part that must be monitored. Storage grows with the horizon
rather than with the number of series.

Committed to: the natural key and the fingerprint field list. Changing either
after data exists is a migration plus a re-import, so they are the two things in
this record to challenge hardest before accepting it.

## Revisit when

- A source publishes recurrence in a form that does not map onto iCalendar
  semantics.
- The 120-day horizon proves wrong in either direction — events routinely
  announced further out, or storage growth becoming a real cost.
- Measured evidence that `N = 3` is too slow to reflect genuine removals, or too
  fast and hiding events during flaky-but-successful runs.

## Addendum: checked against a real feed (2026-09-02)

A real pull of the Hoos Involved iCal feed (63 events; see
`docs/sources/hoosinvolved-engage.md` and its fixture) tested the decisions
above against live data rather than assumption.

**Confirmed, and load-bearing:** the feed carries no `TZID` at all — every
timestamp is a bare UTC instant. Storing `start_tz` separately (§3) is not
optional polish; without it there is no way to recover local time, and a naive
`DTSTART date = DTEND date` same-day check misclassifies ordinary evening
events that cross UTC midnight as multi-day. That bug is real, not
hypothetical, in this exact feed.

**Confirmed:** `UID` is a stable, full URL per event, and unique across all 63
— the primary natural key in §4 is sufficient for this source with no need for
the content-fingerprint fallback.

**Not exercised by this sample:** zero `RRULE`, `RECURRENCE-ID`, or `EXDATE`
appeared in 63 events — either none were in this window, or Engage expands
recurring series server-side before publishing. §1's expansion strategy is
unfalsified but also untested by this pull; re-check against a longer window,
and treat a source that ships raw `RRULE` (an arts or library calendar is more
likely to) as the real test.
