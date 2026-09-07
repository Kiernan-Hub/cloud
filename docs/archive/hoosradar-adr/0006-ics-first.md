# 0006 — Implement iCalendar (ICS) before any vendor-specific API

- **Status:** Accepted
- **Date:** 2026-09-05

## Context

`docs/sources/vetting-findings-2026-09.md` found that several UVA calendars
appear to run on **Localist**, which reportedly exposes both a public JSON API
and ICS feeds. That gives two possible first parsers.

There is a practical constraint on top of it: the environment doing this work
is blocked by network egress policy from reaching any `virginia.edu` host, so
no real UVA payload could be inspected before writing a parser. Whatever was
built first had to be correct without seeing the target.

## Decision

Implement an **iCalendar (RFC 5545) parser** first. Defer the Localist JSON
API until there is a reason to prefer it.

## Rationale

**ICS is a published standard; a vendor API is one company's shape.** RFC 5545
specifies line folding, escaping, timezone parameters, and value types
precisely enough to implement and test correctly without access to any
particular feed. Guessing at Localist's exact JSON schema without a sample
would have produced a parser that compiles, passes invented tests, and fails on
first contact.

**One parser covers many publishers.** ICS is emitted by Localist, LibCal,
Google Calendar, Outlook, 25Live, and most departmental calendars. A second UVA
source — which the MVP requires — is far more likely to share ICS than to share
Localist's API.

**ICS carries a stable UID.** `UID` is required by the spec and is exactly the
`source_event_key` that idempotent import depends on. A format without a
reliable per-event identifier would have undermined the central guarantee in
`docs/schema/event-model.md`.

## Consequences

**Good**

- The parser was implemented and tested against fixtures with no network
  access at all, which is the testing posture `OVERVIEW.md` §12 requires
  anyway.
- Adding a second ICS source is configuration, not code.
- Timezone handling — the genuinely hard part — is solved once, in one place,
  with DST gap and overlap behavior pinned by tests.

**Costs**

- ICS carries less than a rich JSON API. `LOCATION` is one free-text field, so
  venue name and address cannot be separated without guessing; `CATEGORIES` is
  uncontrolled text; there is no cost or accessibility field at all. Those
  columns stay null rather than being invented.
- Recurrence (`RRULE`) is recorded but not expanded, so a weekly event appears
  once rather than as each occurrence. This is a known gap, not an oversight —
  see the open question in `docs/schema/event-model.md`.

## Revisit if

- A UVA feed's ICS output proves materially poorer than its JSON API for the
  same events (missing descriptions, missing URLs, truncated listings).
- Recurring events turn out to be common enough that expansion matters more
  than breadth of source support.

## Alternatives considered

- **Localist JSON API first.** Richer data and native pagination, but requires
  a real sample to build against, and only serves publishers running Localist.
  Worth adding later as a second parser once a real payload can be inspected.
- **HTML scraping.** Rejected outright: last-resort per `docs/sources/`, most
  fragile, and unnecessary while feeds exist.
