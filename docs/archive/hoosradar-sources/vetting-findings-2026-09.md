# Source feasibility findings — September 2026

Desk research into whether HoosRadar has enough ingestible sources to be worth
building. **This is not a completed vetting checklist for any source** — those
still require visiting each site, reading its actual terms, and Kiernan
accepting them (see [README.md](README.md)).

## How this was gathered, and the limits on it

The session doing this research could reach a web **search** index but was
**blocked by network egress policy from opening any `virginia.edu` host
directly**, along with `developer.localist.com`, `help.concept3d.com`, and
`joinhandshake.com`.

So everything below is **secondhand — drawn from search-result summaries of
vendor and university documentation, not from reading the pages themselves.**
Nothing here has been confirmed by fetching a feed, inspecting a payload, or
reading a terms-of-service page in full. Treat every row as a lead to verify,
not a settled fact. Where a claim would change the plan if wrong, that is
flagged.

## The headline

| Question                                            | Answer                                                                                                                                         | Confidence  |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Is there an ingestible path to official UVA events? | **Very likely yes** — multiple UVA calendars appear to run on Localist, whose API is documented as read-only and public with no authentication | Medium-high |
| Can we use Handshake?                               | **Almost certainly not** — its terms reportedly prohibit scraping and bulk collection outright; its API is institution-facing                  | Medium-high |
| Can we reach 90% of _all_ UVA events?               | **No, and the target is not measurable as stated** — see below                                                                                 | High        |

## Localist — the promising lead

Several UVA event calendars appear to be built on Localist (a Concept3D
product), among them:

- `events.mcintire.virginia.edu` (McIntire School of Commerce)
- `arts.virginia.edu/calendar` (UVA Arts)
- `global.virginia.edu/events` (UVA Global)
- `studentaffairs.virginia.edu/events` ("Hoos Doing What")

Localist's own documentation reportedly describes an API that is:

- **read-only and publicly accessible, no authentication required**
- JSON over plain HTTP calls
- paginated, 10 items per page by default, up to 100 per page
- limited to a 370-day window from the start date
- also exposing ICS feeds (12 months or first 1,000 events), carrying start,
  end, plaintext description, event type, and location

If that holds up, it is close to an ideal source shape for this project: an
official publisher, a documented machine-readable interface, stable per-event
identifiers, and no authentication to negotiate.

**Verify before writing any parser:** open one of those calendars, confirm the
platform, find the actual API or ICS URL, fetch it once by hand, and read the
terms and `robots.txt` for that specific UVA site. UVA's own terms govern its
calendar regardless of what the vendor's product supports.

## Handshake — effectively closed

Handshake's terms of service reportedly state that third parties may not bulk
collect student data, employer data, job descriptions, or other marketplace
information through automated scripts, scraping, or similar means. Handshake
does operate an **EDU API** that exposes events (including a field marking an
event public) — but that is an institutional integration, aimed at the
university's career services, not at a student-built side project.

**Practical read:** Handshake is not available to HoosRadar by collection. The
only legitimate route would be UVA Career Services choosing to share data or
enable an integration — a partnership conversation, not an engineering task.

This matters for expectations: P1 and P5 both named Handshake, and both used it
specifically for career events. Those events will not be in HoosRadar unless
they are also published on a public UVA calendar (plausible for info sessions
and career fairs, unknown for employer-specific postings).

## Not yet determined

| Source                                      | What is unknown                                                                                                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `calendar.virginia.edu` (main UVA calendar) | Platform could not be identified. This is the single highest-value unknown — if the _central_ calendar exposes a feed, it likely subsumes many departmental ones.       |
| Hoos Involved (`hoosinvolved.virginia.edu`) | Confirmed to exist as UVA's student-org engagement platform with org pages and event creation. Underlying vendor and whether it exposes any feed: unknown. Named by P3. |
| UVA Athletics (`virginiasports.com`)        | Schedules are clearly published; whether ICS/feed export exists could not be confirmed. Named by P2 (basketball).                                                       |
| UVA Library (`cal.lib.virginia.edu`)        | Appears to run LibCal, which generally supports ICS feeds. Unverified.                                                                                                  |
| Instagram (org accounts)                    | Not investigated further. Scraping is near-certainly against its terms; treat as unavailable. Named by 4/5 interviewees.                                                |

## On the "90% of all events" target

Stated plainly, because it changes what success means: **90% coverage of all
UVA events is neither achievable nor measurable.**

- **No denominator exists.** Nobody knows how many events happen at UVA in a
  given week. There is no master list to measure against — that absence is the
  entire reason this project exists.
- **A large share of events are structurally uncapturable.** The interviews
  make this concrete: P4's frat party and tailgate, P2's free concert seen only
  after the fact, P1's trivia night. These live in group chats, Instagram
  stories, and word of mouth. No feed carries them. No amount of engineering
  reaches them.

Chasing 90%-of-everything means chasing exactly the sources that are blocked or
nonexistent. That is the path to concluding the project is impossible.

### What can be measured instead

**Coverage of publicly listed events.** Pick one week. Manually enumerate every
event appearing across the approved public calendars. Measure what fraction
HoosRadar ingested and displayed correctly. That has a real denominator, can be
computed honestly, and is the metric `OVERVIEW.md` §13 already asks for.

A defensible goal: **high coverage of what is publicly published, with an
honest statement on the site that word-of-mouth and social-media-only events
are out of scope.** That is a smaller promise than "everything happening at
UVA" — and unlike the larger one, it can actually be kept.

## Recommendation

Two things need to happen before Milestone 2, and neither is code:

1. **Check `calendar.virginia.edu` and Hoos Involved by hand** (~20 minutes).
   Confirm the platform, look for a subscribe/export/API link, and read the
   terms. This decides whether the project has one strong central source or a
   patchwork of departmental ones.
2. **Decide the scope promise.** Either HoosRadar is "public UVA calendars in
   one place," which the evidence supports — or it is "everything happening at
   UVA," which the evidence does not.

The engineering built so far is agnostic to which sources win: the parser
boundary exists precisely so a source can be added or dropped without touching
storage. Nothing built to date is wasted by narrowing scope.

## Sources consulted

Search-result summaries referencing: Localist/Concept3D API documentation
(`developer.localist.com/doc/api`, `help.concept3d.com`), Handshake terms of
service and EDU API endpoint definitions (`joinhandshake.com/legal/tos`,
`support.joinhandshake.com`), and UVA pages for McIntire, Arts, Global,
Student Affairs, Hoos Involved, UVA Library, and Virginia Sports. None were
opened directly; see the limits section above.
