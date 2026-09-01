# Candidate source inventory

Covers §16 action 2 of `OVERVIEW.md`: "inventory candidate event sources and
complete the source-policy checklist for each one."

- **Compiled:** 2026-09-01
- **Method:** desk research via web search only
- **Status:** **no source here is approved.** Approval requires the owner to
  review a completed record in this directory.

## Read this before using anything below

The environment this inventory was compiled in **blocks outbound network access
to `virginia.edu` and related hosts.** Nothing below was fetched. No
`robots.txt` was read, no feed URL was confirmed to exist, no payload was
inspected, and no field list was observed.

Every factual claim is therefore tagged:

- **[searched]** — from a search result or vendor documentation. Plausible,
  not confirmed.
- **[unverified]** — must be checked against the live site before it is
  relied on.

The verification commands in the last section close this gap in about twenty
minutes from any machine with normal internet access. Do not promote a source
to `approved` until they have been run and the results recorded.

## Headline finding

**There does not appear to be a single university-wide UVA events calendar.**
`events.virginia.edu` does not resolve, and searching surfaced at least eight
separate departmental and unit calendars instead of one central feed
[searched, unverified].

This cuts both ways, and both directions matter to the plan:

- It is direct evidence for the product premise in `OVERVIEW.md` §1 — events
  genuinely are scattered across calendars a student would have to check
  individually. This is worth raising in the discovery interviews as a thing to
  confirm rather than assume.
- It means there is no cheap "one feed covers campus" ingestion path. Coverage
  will be a function of how many sources are integrated, which makes the
  per-source cost in Milestone 2 the number that determines whether the MVP is
  useful. That argues strongly for making the first parser generic over a
  standard format (iCalendar or RSS) rather than bespoke to one site.

## Candidates

Ordered by how good a Milestone 2 first source they look. "Overlap" matters
because two sources covering the same events are what make deduplication
testable — see finding D1 in the plan audit.

### 1. Hoos Involved — recommended first source

| Field | Value |
| --- | --- |
| Owner | UVA Student Engagement, Division of Student Affairs [searched] |
| Public URL | `hoosinvolved.virginia.edu` [searched] |
| Underlying platform | Anthology Engage, formerly Campus Labs, at `virginia.campuslabs.com/engage/events` [searched] |
| Method | Public Events RSS feed and public Events iCal feed [searched] |
| Also available | Engage REST API v2/v3, `/events` endpoint — **contract-gated** [searched] |
| Scale | Reported as 995+ organizations and ~12,000 events/year [searched, unverified — do not cite this number anywhere until confirmed] |
| Status | **candidate** |

Why it leads: Anthology's own documentation states that Engage "offers public
Events and public News data feeds through RSS as well as an additional public
Events data feed through iCal," configurable from the Data Sharing page in a
campus's Engage admin area [searched]. That is exactly the sanctioned,
owner-controlled collection method `OVERVIEW.md` §9 says to prefer, and it
avoids scraping entirely. It is also the broadest single source found — student
org events are the bulk of what the target persona is looking for.

Two things to know before committing to it:

- **The feeds may simply be switched off.** They are admin-configurable per
  campus, so their existence at UVA is unconfirmed. If they are off, the ask is
  small and well-defined: UVA Student Engagement can enable the public feed in
  Engage admin. That is a far easier conversation than requesting API
  credentials, and it is the first thing to check.
- **This platform changed recently.** UVA moved Hoos Involved from Presence to
  Engage, with student org leaders told to keep using Presence for events until
  July 2026 [searched]. A source that changed vendors within roughly the last
  year is a source whose URL structure and feed shape are not yet settled. This
  is precisely the risk `OVERVIEW.md` §14 mitigates with isolated parsers and
  fixtures — worth stating in the record so nobody is surprised.

The Engage API is a deliberate non-starter for now: it needs a contract key,
which means an institutional request, which is exactly the kind of thing §15
says to stop and ask about. The public feed needs none of that.

### 2. Hoos Doing What — Student Affairs events

| Field | Value |
| --- | --- |
| Owner | UVA Division of Student Affairs [searched] |
| Public URL | `studentaffairs.virginia.edu/events` [searched] |
| Method | Unknown; appears to be a rendered site page, feed unconfirmed [unverified] |
| Status | **candidate** |

Confirmed to be live and current — September 2026 listings surfaced in search,
naming events at the LGBTQ Center, the Latinx Student Center, and several
recruiting fairs [searched]. Its value is less about volume than about
**overlap**: these are student-facing events very likely to also appear in Hoos
Involved. That makes this the natural second source for Milestone 3, because a
pair of sources that genuinely describe the same events is what turns
deduplication from a hypothetical into something measurable — which is what
audit finding D1 says the plan currently has no path to.

### 3–8. Additional unit calendars

All **candidate**, all method-unknown and unverified. Listed so the inventory is
complete rather than because any is a near-term integration:

| Source | URL | Owner |
| --- | --- | --- |
| Student Engagement calendar | `studentengagement.virginia.edu/calendar` | UVA Student Engagement |
| UVA Arts | `arts.virginia.edu/calendar` | UVA Arts |
| UVA Global | `global.virginia.edu/events` | UVA Global |
| Community Partnerships | `communitypartnerships.virginia.edu/events` | UVA Community Partnerships |
| Office of Major Events | `majorevents.virginia.edu` | UVA Office of Major Events |
| UVA Library | `library.virginia.edu` | UVA Library |

Many UVA sites are Drupal-based, and Drupal event listings commonly expose an
RSS view — but this is a guess and must be checked per site [unverified].

### Deliberately deprioritized

- **UVA Athletics (`virginiasports.com`)** — likely on SideArm Sports, a
  commercial vendor whose terms govern the site rather than UVA's [searched,
  unverified]. High-volume and high-interest, but the terms review is heavier
  and athletics schedules are already well served elsewhere. Not a good first
  source.
- **UVA Alumni Association (`uvaalumni.org`)** — a legally separate
  organization from the University, and alumni events are largely off-target
  for the exploring-student persona.
- **Eventbrite** — commercial API with its own terms, and its UVA-area listings
  are mostly not campus events. Out of scope for the MVP.

## Recommended path

1. Verify the Hoos Involved public RSS and iCal feeds (commands below).
2. If they exist, complete `docs/sources/` records for Hoos Involved and Hoos
   Doing What, and integrate Hoos Involved as the Milestone 2 source.
3. If the feeds are disabled, ask UVA Student Engagement to enable public feeds
   in Engage before considering any scraping alternative. Do not scrape a source
   whose owner has a supported feed switch they have simply not flipped.
4. Build the Milestone 2 parser against the iCalendar or RSS **format**, not
   against Hoos Involved specifically. Given that no central calendar exists,
   most future sources will arrive as one of these two formats, and a
   format-level parser turns each additional source into configuration rather
   than code.

Note that step 4 interacts with audit finding C1: iCalendar feeds carry
recurring events as `RRULE`, and recurrence is currently unmodeled. If the
first source is an iCal feed, the recurrence decision is not deferrable.

## Verification commands

Run from any machine with normal internet access, then record the results in the
per-source record files. These are read-only, single requests — they are
themselves ordinary polite use, not collection.

```sh
# 1. Terms and crawl directives — read before anything else
curl -s https://virginia.campuslabs.com/robots.txt
curl -s https://studentaffairs.virginia.edu/robots.txt

# 2. Does the Engage public events RSS feed exist and return items?
curl -sI https://virginia.campuslabs.com/engage/events.rss
curl -s  https://virginia.campuslabs.com/engage/events.rss | head -60

# 3. Does the Engage public iCal feed exist?
curl -sI https://virginia.campuslabs.com/engage/events.ics

# 4. Conditional-request support — decides whether polling is cheap and polite
curl -sI https://virginia.campuslabs.com/engage/events.rss | grep -iE 'etag|last-modified|cache-control'

# 5. Recurrence and stable IDs — the two fields that drive schema decisions
curl -s https://virginia.campuslabs.com/engage/events.ics | grep -cE '^RRULE'
curl -s https://virginia.campuslabs.com/engage/events.ics | grep -m5 '^UID'
```

Exact feed paths are informed guesses from Anthology's documentation and are
themselves unverified; if they 404, the Engage site's own Subscribe or Calendar
Actions link is the authoritative place to find the real paths.

Record for each source: whether the feed exists, whether `robots.txt` permits
the path, whether conditional requests are supported, whether events carry a
stable `UID`, and whether any `RRULE` recurrence is present. Those five answers
close out most of the technical half of the §9 checklist.
