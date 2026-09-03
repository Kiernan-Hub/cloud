# Data source inventory

Every source HoosRadar collects from must have a completed checklist in this
directory **before** any parser is written for it. `CLAUDE.md` names "a source
without a documented owner, terms, and collection method" as a red flag, and the
`sources` table enforces the same rule in the database: a source cannot be
enabled without a recorded `terms_reviewed_at`.

Copy [`TEMPLATE.md`](TEMPLATE.md) to `<source-slug>.md` and fill it in.

## Status

| Source | Slug | Method | Terms reviewed | Status |
| --- | --- | --- | --- | --- |
| _none yet_ | — | — | — | — |

**Nothing has a completed checklist yet.** Populating one requires visiting the
real source and reading its actual terms — it is owner work, not something to
be filled in from assumption. Inventing a plausible-looking entry here would be
worse than leaving it empty, because the whole point of the table is that its
contents were verified.

### Candidates surfaced by discovery interviews

`docs/discovery/synthesis.md` (5/5 interviews complete) named the following
channels. None of these has a checklist yet — this list is where to start
vetting, not a pre-approval:

| Named channel | Mentions | Likely eligibility |
| --- | --- | --- |
| Hoos Involved | 1/5 | Best candidate to check first — a university-run student-org event platform is the kind of source most likely to be public and API/feed-friendly. Unverified. |
| Instagram (org accounts / flyers) | 4/5 | Named most often, but scraping is very likely against Instagram's terms. Do not build a parser before that is checked and cleared. |
| Handshake | 2/5 | Likely gated behind UVA authentication — treat as private data under `CLAUDE.md` until proven otherwise; do not use credentials without explicit owner approval. |
| Email, word of mouth / group chats | 5/5 combined | Not ingestable as a source at all — no feed exists to fetch. Real user behavior, not an engineering candidate. |

The most-requested channels (Instagram, word of mouth) are the least likely to
be usable; the most plausible technical candidate (Hoos Involved) was the
least mentioned. Worth checking Hoos Involved's terms first regardless of
mention count, rather than chasing the louder but likely-blocked signal.

## Vetting order

Prefer sources in this order, because the earlier ones are both more reliable and
less legally fraught:

1. **Official iCalendar or RSS/Atom feeds.** Publishing a feed is an explicit
   invitation to consume it. Cheapest to parse, most stable.
2. **Documented public APIs.** Usually rate-limited and versioned; read the terms
   for attribution and caching requirements.
3. **Structured pages with machine-readable markup** (JSON-LD `Event`,
   microdata). Fragile but honest.
4. **HTML parsing.** Last resort. Requires an explicit robots.txt and
   terms-of-service check, a low request rate, and a named user agent.

A source that technically blocks collection, or whose terms forbid it, is not
eligible regardless of how useful its data would be.

## Rules that apply to every source

- Identify the application in the user agent with a contact address.
- Respect `robots.txt` and any documented crawl delay; never exceed the
  requested frequency.
- Cache and use conditional requests (`ETag`, `If-Modified-Since`) so repeat
  polling is cheap for the source owner.
- Retain raw payloads only where terms allow, and only for the documented window.
- Honor a removal request immediately: set `enabled = false` with a
  `disabled_reason`. This must not require a deploy.
- Never collect attendee lists, private organization data, or anything behind
  authentication.

## What needs owner sign-off

Per `CLAUDE.md`, accepting a source's terms on the owner's behalf is not
something this project's automation does. Claude can *read and summarize* a
source's terms and flag concerns; the decision to collect from it is Kiernan's.
