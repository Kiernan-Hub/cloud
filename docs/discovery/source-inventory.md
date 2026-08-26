# Candidate data source inventory

Use this checklist before integrating any event source, per the data-source
policy in `OVERVIEW.md` §9. Fill in one copy per candidate source. A source
without an owner, documented terms, and a collection method is a red flag
per `CLAUDE.md` and should not be integrated.

The Milestone 0 exit criterion is two source strategies confirmed as
legally and technically viable — this document is where that confirmation
gets recorded.

## Source: [name]

- Owner / organization:
- Authoritative URL:
- Collection method: API / RSS or Atom feed / iCalendar feed / structured
  page (specify) / other
- Usage terms and robots directives reviewed: yes / no — link or note
- Requested collection frequency and caching rules:
- Expected event volume:
- Required fields available (title, start/end time + timezone, venue,
  organization, cost, accessibility info): list what's present, what's
  missing
- Contact / removal procedure:
- Parser risk notes (irregular formatting, auth required, rate limits):
- Verdict: viable / not viable / needs owner contact first

---

## Summary table

Fill in as sources are evaluated. Only sources marked "viable" count toward
the Milestone 0 exit criterion.

| Source | Method | Terms reviewed | Verdict |
| --- | --- | --- | --- |
| Example only; replace after real review | — | no | Not evaluated |
