# Discovery synthesis

- **Interviews conducted:** 5 of 5
- **Date range:** 2026-09-03
- **Interviewer:** Kiernan
- **Guide used:** [`student-interview-guide.md`](student-interview-guide.md)

## A note on evidence quality

These five sessions used the guide's question order and were captured as short
paraphrased answers rather than verbatim transcripts. That is enough to see a
real pattern below, but it is thinner evidence than full notes would be —
there is no participant-mix data (year, field, involvement level), and it is
not confirmed whether the opening consent script was read. Treat this as a
first, real signal rather than a conclusive study. The interview counts and
answers below are exactly what was reported; nothing is invented.

## Participant mix

Not collected in this round. **Gap:** the guide requires recruiting at least
one participant who rarely attends events; that was not verified here — one or
more of P1/P4 (light, word-of-mouth-driven engagement) may qualify, but it
was not asked directly. Recommend collecting year/field/involvement on any
follow-up round.

| ID | Year | Broad field | Self-reported event attendance |
| --- | --- | --- | --- |
| P1 | — | — | not asked |
| P2 | — | — | not asked |
| P3 | — | — | not asked |
| P4 | — | — | not asked |
| P5 | — | — | not asked |

## Raw responses (paraphrased, anonymized)

**P1** — Engineering fair via Handshake. Finds food via GrubHub (not campus
events). Missed trivia night ($1 shots) entirely, found out the next day from
a friend. Attends if there's food or it matches interests. Says info was
always correct. Mostly stumbles on events; only actively searches for
internships. **"Nothing, it's fine as is."**

**P2** — Basketball game via friends + Instagram. Checks Instagram and group
chats, ~5–10 min when searching. Missed a free concert on Grounds — saw a post
about it only after it happened. Decision depends on who's going, what it is,
distance. Instagram flyers sometimes don't state location clearly; checks the
org's own page to confirm. Mostly stumbles, rarely searches. Wants **"one
place that shows everything happening that week."**

**P3** — Club interest meeting via a club email. Actively browses Hoos
Involved + Instagram to find clubs, ~20 min. Missed a guest speaker because the
email wasn't seen in time. Decides based on topic, time, location, conflict
with studying. Had a room-change case — trusted the newest email over the
older one. Actively looks about once a week, but most events are still found
randomly. Wants **"better filters so I can just see stuff I actually care
about."**

**P4** — Frat party via a friend. Doesn't use a website — asks friends what's
going on. Missed a tailgate because nobody told them until it was already
happening. Decides based on who's going and whether it sounds fun. Times/
locations sometimes change but someone in the group chat usually knows.
Almost entirely stumbles on events. Wants an **easier way to see social
events**, since most are pure word of mouth.

**P5** — Career/networking event via Handshake. Uses Handshake for career,
email for school, Instagram for clubs — 10–15 min when actively searching.
Missed a company info session because the email got buried; found out the
next day. Decides based on career relevance, company, time, food. Handshake
and email are usually accurate; flyers carry less information. Actively
searches only for career events; stumbles on everything else. Wants a
**"personalized feed... without checking 4 different places."**

## Findings

| Finding | Behavioral evidence | Participants | Contrary evidence | Decision |
| --- | --- | ---: | --- | --- |
| Discovery channel depends on event type: Instagram/word-of-mouth for social events, Handshake/email/Hoos Involved for career and club events | Each participant named a channel tied to a specific event category, from a real recent example | 5/5 | None | Design implication — see below |
| Every missed event was a **late-information** failure, not a discovery-tool failure: friend told them after the fact, post seen after the fact, email seen after the fact | All 5 missed-event stories are the same shape — information existed but arrived too late | 5/5 | None | Strong support for a visible "when was this last checked / posted" signal and for surfacing near-term events prominently |
| Students overwhelmingly **stumble** on events rather than search, except career events (Handshake) where active search is normal | Direct statements in Q2/Q6 for all five | 5/5 | None | Supports a strong default browse view over a search-first design |
| Attendance decision driven by social proximity + interest fit + logistics (time/location), food as a recurring secondary factor | Stated in Q4 by all five, consistent categories | 5/5 (self-reported criteria, not observed behavior) | None | Confirms filter fields in `OVERVIEW.md` §6 (date, category, location); "who's going" is explicitly **not** something HoosRadar should try to capture (privacy/non-goal) |
| Official channels (Handshake, email) seen as complete/accurate; flyers and Instagram posts seen as missing details (location, updates) | P2 (location unclear on flyers), P3 (trusted newest email after a room change), P5 (flyers carry less info than Handshake/email) | 3/5 | P1 said info was "always correct"; P4 raised no accuracy complaint | Supports showing source + freshness prominently, since trust already varies by channel |
| Moderate but **not universal** appetite for a consolidated view | P2 wants one weekly view, P3 wants better filters, P5 wants a cross-source personalized feed, P4 wants visibility into word-of-mouth social events | 4/5 | **P1 explicitly said the status quo is fine** — the one participant who filters mainly by "food or interest" and only searches Handshake reported no felt pain | Real signal, not unanimous — see scope decision |

## Answers to the research questions

1. **How do students currently learn about campus events?** Split cleanly by
   event type: Instagram and friends/group chats for social events; Handshake,
   email, and Hoos Involved for career and club events. Nobody named a single
   place they'd check for everything.
2. **When and why does discovery fail?** Not from a lack of channels — every
   failure case is information that existed somewhere but reached the student
   after the event already happened or started.
3. **What determines whether a student attends?** Social proximity, interest/
   topic fit, and logistics (time, location, conflicts). Food shows up
   repeatedly as a secondary factor.
4. **Which sources are trusted, and how are conflicts handled?** Official,
   institutional channels (Handshake, email, Hoos Involved) are trusted more
   than informal ones (Instagram flyers). One participant resolved a
   room-change conflict by trusting the most recent email — a real, if
   informal, freshness heuristic that HoosRadar's "last checked" timestamp is
   meant to formalize.
5. **Is the problem frequent and important enough to justify the MVP?**
   Moderately, not overwhelmingly — see scope decision below.

## Source signals

This is the most actionable output for engineering, and it surfaces a real
tension worth flagging plainly.

| Source named | Participants naming it | Already in `docs/sources/`? | Notes |
| --- | --- | --- | --- |
| Instagram (org accounts / flyers) | 4 (P2, P3, P4, and implied by P5) | No | Named most often for *social* events, but scraping Instagram is very likely disallowed by its terms — see `CLAUDE.md`'s red flag on sources without permitted collection. Needs terms review before it goes anywhere near the checklist. |
| Word of mouth / group chats / friends | 3 (P1, P2, P4) | N/A | Not a source that can be ingested at all — there is no feed to fetch. Real signal, but not an engineering answer. |
| Handshake | 2 (P1, P5) | No | Career events specifically. Likely UVA-authenticated / gated data — `CLAUDE.md` prohibits using private UVA data or credentials without owner approval. Needs explicit review before treating it as public. |
| Email (org / school) | 2 (P3, P5) | No | Private communication channel, not a public source. Not ingestable as-is. |
| Hoos Involved | 1 (P3) | No | The one channel here that looks like an actual structured, public, student-org event platform — the strongest candidate for a first real source technically, despite being the least-mentioned. |

**The tension worth naming directly:** the two most-mentioned discovery paths
(Instagram, word of mouth) are exactly the two hardest or least permissible to
ingest. The one clean, plausible, publicly-structured candidate (Hoos
Involved) was named by only one participant. This doesn't mean Hoos Involved
is wrong — official university event platforms are usually intentionally
public and API-friendly — but it does mean the *first* source and the
*most-requested* source may not be the same thing, and that's worth being
honest about rather than reaching for Instagram scraping to chase the louder
signal.

## Scope decision

- [x] **Keep MVP scope as written** in `OVERVIEW.md` §5, with one refinement:
  prioritize a strong, low-effort **browse/default view** over a search-first
  experience, since 5/5 participants said they mostly stumble rather than
  search. Filters (date/category/location) already in the MVP scope directly
  answer Q4's stated decision criteria (3/5 findings above).
- [ ] Change MVP scope
- [ ] Stop

This is a recommendation for the owner to confirm, not a unilateral close of
Milestone 0 — five interviews is the minimum count the guide sets, and the
participant-mix gap above means this should be treated as directional rather
than final.

## Things the interviews did not answer

- Participant demographics (year, field, involvement level) — not collected.
- Whether a genuinely low-engagement student was actually represented in the
  sample (the guide's requirement) — not verified.
- Whether students would actually return to a second, separate site rather
  than defaulting back to Instagram/friends out of habit — the concept
  question was answered in the abstract, not tested behaviorally.
- Nothing here validates or rules out any specific source's terms of service —
  that is separate work in `docs/sources/`.
