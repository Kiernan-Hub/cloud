# Student discovery interview guide

## Purpose

Use this guide to interview five University of Virginia students before
building HoosRadar. The interviews test whether students have difficulty
discovering campus events, how they solve that problem today, and which parts
of event information they need to trust. They do **not** validate a proposed
feature simply because an interviewee says it sounds useful.

## Research questions

1. How do students currently learn about campus events?
2. When and why does event discovery fail?
3. What information determines whether a student attends an event?
4. Which sources do students trust, and how do they handle conflicting or
   outdated information?
5. Is the problem frequent and important enough to justify the MVP?

## Participant mix

Recruit five current UVA students. Aim for variation in year, field of study,
campus involvement, and how often they attend events. At least one participant
should be a student who rarely attends events; recruiting only highly involved
students would bias the findings.

Do not collect names or other identifying information in the research notes.
Participation must be voluntary, and participants may skip any question or end
the conversation at any time.

## Opening script

> I am researching how UVA students find campus events. This is a conversation
> about your recent experiences, not a test of you. It should take about 15
> minutes. I will take anonymous notes, but I will not record your name. You can
> skip any question or stop at any time. Is it okay to continue?

If the student does not agree, thank them and stop. Do not record audio or
video without separate, explicit consent.

## Interview questions

Ask the questions in order, using the optional prompts only when needed. Avoid
describing HoosRadar until the closing section so the proposed solution does
not shape the participant's account.

1. **Tell me about the last campus event you attended or considered attending.**
   - How did you first hear about it?
   - What did you do next?
2. **Think about the last time you wanted to find something to do at UVA. Walk
   me through what you did.**
   - Which sites, apps, mailing lists, or people did you check?
   - How long did the search take?
3. **Tell me about a time you missed an event you would have attended.**
   - What caused you to miss it?
   - When did you learn about it?
4. **How do you decide whether an event is worth attending?**
   - Which details are essential?
   - What makes you uncertain or causes you to give up?
5. **Have you encountered event details that were wrong, incomplete, or
   inconsistent?**
   - How did you decide which information to trust?
6. **How often do you actively look for events, rather than encounter them by
   chance?**
7. **If you could change one thing about finding UVA events today, what would
   it be? Why?**

Prefer follow-ups such as “What happened next?”, “Can you give me a recent
example?”, and “Why was that important?” Avoid leading questions such as “Would
you use one website that collects every event?”

## Closing concept check

Only after the experience questions, read this neutral description:

> HoosRadar is being considered as a mobile-friendly website that gathers
> public UVA and student-organization events, lets people search and filter
> them, and links every event back to its original source.

Then ask:

1. What, if anything, would this change about what you do today?
2. What would prevent you from trusting or using it?
3. What is the most important thing it would need to get right?

Thank the participant. Do not promise that a requested feature will be built.

## Note template

Create one copy per interview and identify it only as `P1` through `P5`.

```markdown
# Interview P[1-5]

- Date:
- Broad participant segment (no identifying details):
- Consent to anonymous notes: yes / no

## Recent behavior

- Last event considered and discovery path:
- Current sources and workflow:
- Missed-event example:
- Frequency of active event search:

## Needs and trust

- Information needed to decide:
- Accuracy or trust problems:
- Most painful part of current process:

## Concept response

- Expected behavior change:
- Adoption or trust barrier:
- Most important requirement:

## Evidence

- Short notable quote (optional):
- Observed behavior or concrete example:
- Interviewer interpretation (label as interpretation):
```

Store completed notes only if the participant consented. Remove incidental
identifiers from quotes and examples before committing any synthesis. Do not
commit raw interview notes to this public repository.

## Synthesis after five interviews

Summarize evidence across all five interviews in a separate, anonymized
document. For each finding, record the number of participants who supplied a
concrete example, contrary evidence, and the resulting product decision. Keep
observations separate from interpretations.

Use this decision table:

| Finding | Behavioral evidence | Participants | Contrary evidence | Decision |
| --- | --- | ---: | --- | --- |
| Example only; replace after interviews | Example only | 0/5 | Not collected | No decision |

The discovery step is complete when five consenting students have been
interviewed with this guide and the anonymized synthesis records whether the
MVP scope should stay the same, change, or stop. Interview counts and findings
must reflect real sessions; never invent participants or results.
