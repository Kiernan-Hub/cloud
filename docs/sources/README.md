# Data sources

`OVERVIEW.md` §9 requires a recorded policy for every source *before* it is
integrated, and §16 item 2 requires completing that checklist for each
candidate. This directory holds one record per source.

## How to use this

Copy `source-record-template.md` to `<slug>.md` — one file per source,
candidate or approved. A source may only move to `status: approved` when every
field in the record is filled in. A source whose owner requests removal, or
whose terms stop permitting collection, moves to `status: disabled` with the
date and reason recorded; the record is kept, not deleted.

"Approved" means the repository owner has reviewed the completed record. There
is no other approval process.

## Candidate inventory

[`candidate-inventory.md`](candidate-inventory.md) is the desk research behind
the table below: who owns each calendar, which platform it runs on, and the
commands to verify each one. It was compiled without network access to
`virginia.edu`, so its technical claims are explicitly marked unverified —
read its opening caveat before relying on anything in it.

## Index

| Source | Slug | Method | Status |
| --- | --- | --- | --- |
| [Hoos Involved (Anthology Engage)](hoosinvolved-engage.md) | `hoosinvolved-engage` | public iCal feed, confirmed live | candidate, technically verified |
| Hoos Doing What (Student Affairs) | `studentaffairs-events` | unknown (unverified) | candidate |
| Student Engagement calendar | `studentengagement-calendar` | unknown | candidate |
| UVA Arts | `uva-arts` | unknown | candidate |
| UVA Global | `uva-global` | unknown | candidate |
| Community Partnerships | `community-partnerships` | unknown | candidate |
| Office of Major Events | `major-events` | unknown | candidate |
| UVA Library | `uva-library` | unknown | candidate |

No source is approved. Nothing in this table may be integrated until its record
is completed and reviewed.
