# Source: Hoos Involved (Anthology Engage)

- **Slug:** hoosinvolved-engage
- **Status:** candidate — technically verified, owner review still needed
- **Status date:** 2026-09-02
- **Reviewed by:** _pending owner review_

## Ownership

- **Owner / publishing body:** UVA Student Engagement, Division of Student
  Affairs [searched, unconfirmed with the owner directly]
- **Authoritative URL:** `https://virginia.campuslabs.com/engage/events`
- **Contact for questions or removal requests:** _not yet identified_ — find via
  UVA Student Engagement before this source moves to `approved`
- **Removal-request handling:** disable the source, record the date and reason
  in this file, and retain existing records' provenance.

## Collection

- **Method:** iCalendar feed. **Confirmed live** — a "iCal Feed" link is present
  on the public events page at the URL above, alongside a separate "RSS Feed"
  link (RSS not yet pulled).
- **Endpoint / feed URL:** captured 2026-09-02; not recorded verbatim in this
  file since it may carry a session-specific token — re-derive it from the
  "iCal Feed" link on the page above.
- **Authentication required:** no — the link was public, no sign-in prompted.
- **Requested collection frequency:** unstated by the source. Propose starting
  at once per hour and adjusting based on `DTSTAMP` freshness observed across
  runs.
- **Caching / conditional-request support:** **unverified** — requires an
  `HTTP HEAD` against the feed URL, checking for `ETag` or `Last-Modified`.
  Not done in this pass; egress to `virginia.edu` is unavailable from this
  environment. See `candidate-inventory.md` for the exact command.
- **User agent identifying HoosRadar:** to be set once a worker exists.

## Terms and permissions

- **Usage terms reviewed:** not yet — **do not integrate this source before
  this is done.** The feed being technically live is not the same as
  reviewing Engage's or UVA's terms for it.
- **`robots.txt` directives relevant to this path:** unverified — egress
  blocked from this environment. Check `https://virginia.campuslabs.com/robots.txt`
  before integration.
- **Rate limits stated or inferred:** none observed; assume conservative
  polling until stated otherwise.
- **Raw payload retention permitted:** undetermined — depends on the terms
  review above.
- **Anything requiring owner sign-off before proceeding:** confirming this
  specific integration is acceptable use, since "the link exists publicly" is
  not the same as "collection for this purpose is authorized."

## Data shape

Verified directly against a real feed snapshot pulled 2026-09-02 (see
`fixtures/hoosinvolved-engage-2026-09-02.ics`, 63 events).

- **Expected event volume:** the source page reported "81" events in its
  current window at capture time; the pulled feed carried 63 — the feed and
  the paginated web view may not be in perfect sync, or the feed may be
  windowed differently. Worth re-checking on a second pull.
- **Fields provided:** `SUMMARY`, `DESCRIPTION` (plain text, escaped
  newlines — not HTML), `DTSTART`/`DTEND` (UTC instants), `LOCATION` (free
  text), `GEO` (present on roughly half of events), `CATEGORIES`
  (multi-valued, up to 3 per event), `URL`, `UID`, `STATUS`, `SEQUENCE`,
  `X-HOSTS` (non-standard field carrying the organization name as plain text).
- **Required fields missing from this source:** no explicit timezone
  (`TZID`) anywhere in the feed — see the timezone note below. No cost/price
  field. No accessibility field.
- **Timezone representation:** **all timestamps are UTC (`Z` suffix), with no
  `TZID` anywhere in the file.** This source alone gives no way to recover
  the original local time programmatically; since every event in this feed is
  a UVA/Charlottesville event, the safe assumption is `America/New_York` for
  this source specifically, applied at parse time rather than read from the
  feed. This must not be assumed for a future source without checking.
- **Recurring events present:** **no** — zero `RRULE`, `RECURRENCE-ID`, or
  `EXDATE` lines in 63 events. Either genuinely no recurring events were in
  this window, or Engage expands recurring series into individual `VEVENT`s
  before publishing the feed. Re-check on a pull spanning a longer window
  before concluding recurrence never appears here.
- **Stable per-event identifier available:** **yes.** `UID` is a full,
  dereferenceable URL of the form `https://hoosinvolved.virginia.edu/event/<id>`.
  All 63 UIDs in the sample were unique. The content-fingerprint fallback in
  ADR-0001 is not needed for this source.

## Testing and failure behavior

- **Fixture file(s):** `fixtures/hoosinvolved-engage-2026-09-02.ics`
- **Fixture captured on:** 2026-09-02
- **Expected behavior on parse failure:** per `OVERVIEW.md` §9/§14 — a
  malformed record is logged and skipped; it must not fail the whole batch.
- **Expected behavior on source outage:** events must not be marked cancelled;
  see ADR-0001's `missing_from_source` status and its three-successful-run
  threshold.

## Notes for whoever reviews this next

- `DESCRIPTION` embeds `Hosted by: <org>` and
  `Additional information can be found at: <url>` as literal trailing text,
  duplicating the structured `X-HOSTS` and `URL` fields. The normalizer should
  strip this boilerplate rather than showing it twice.
- Because there is no `TZID`, a naive same-day check (`DTSTART date =
  DTEND date`) misclassifies ordinary UVA evening events as multi-day — an
  18:00Z–03:00Z event is a single evening in `America/New_York` that merely
  crosses UTC midnight. This is exactly the trap ADR-0001 §3 names, and this
  feed is the proof it's real, not hypothetical.
- Still blocking `status: approved`: the owner contact, the terms review, and
  the `robots.txt` and conditional-request checks. None of these need the
  feed again — they need a browser session with `virginia.edu` access, which
  this environment does not have.
