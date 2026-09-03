# Handoff — repository audit and current state

**Date:** 2026-09-03
**Branch:** `claude/codebase-audit-status-cr1z6w`
**Milestone:** 0 of 6 (discovery and decisions), in progress

## Summary

The repository is documentation-only. There is no application code, worker,
database, CI, or package manifest — nothing to build, lint, or test yet. The
planning documents are in good shape; no evidence has been gathered yet.

## Audit findings

| File | State | Action taken |
| --- | --- | --- |
| `OVERVIEW.md` | Good — scope, requirements, architecture, roadmap, testing strategy, metrics, risks. No contradictions with `CLAUDE.md`. | None |
| `CLAUDE.md` | Good — guardrails, green/red flags, and approval boundaries consistent with the overview. | None |
| `docs/discovery/student-interview-guide.md` | Good — non-leading questions, consent script, anonymization rules, synthesis table requiring real participant counts. | None |
| `README.md` | Stale — opened with "Playing around with cloud" and did not describe the project or its state. | Rewritten as a real entry point: what HoosRadar is, pre-code status, repo map, current discovery tasks. |
| `testing1` | Junk — a cloud-execution connectivity check containing unrelated trivia. | Deleted |
| `.gitignore` | Missing — nothing prevented committing a `.env` or key. | Added: secrets (`.env`, `*.pem`, `*.key`), OS cruft, editor dirs, local scratch. |

No secrets, credentials, or personal data were found in the repository or its
history.

## Milestone 0 status

| Exit criterion (`OVERVIEW.md` §11) | State |
| --- | --- |
| Five student interviews conducted | Not started — guide written, no interviews run |
| Two legally and technically viable source strategies | Not started — no sources inventoried or vetted |
| Architecture decision records (stack, hosting, jobs) | Not started |
| Event schema and source policy defined | Policy checklist defined in `OVERVIEW.md` §9; not applied to any source |
| Low-fidelity flows (browse, search, detail, failure states) | Not started |
| Prioritized backlog / Milestone 1 issues | Not started |

## Assessment

The planning is above average for a project at this stage. Provenance,
idempotent imports, and fixture-based parser tests are designed in from the
start, which is the part most projects bolt on late and regret.

The risk is the opposite one. The documentation is roughly 25,000 words and
the executable surface is empty. More planning will not produce new
information at this point; interviews and source vetting will.

## Next steps, in order

1. **Run the five discovery interviews.** This gates everything downstream.
   Commit only the anonymized synthesis with the decision table filled in from
   real sessions. Raw notes are never committed to this repository.
2. **Vet candidate sources (can run in parallel with step 1).** Pick three to
   five candidates — the main UVA calendar, a few organization feeds — and
   complete the `OVERVIEW.md` §9 checklist for each: owner, authoritative URL,
   feed type, usage terms and robots directives, request rate, expected volume,
   contact/removal procedure. Store in `docs/sources/`. Two viable sources are
   required to exit Milestone 0.
3. **Write three short architecture decision records** in `docs/decisions/`:
   stack, hosting, and job mechanism. One page each — decision, alternatives
   considered, consequences. `OVERVIEW.md` §8 proposes defaults (TypeScript
   server-rendered client, PostgreSQL, database-backed jobs); the ADR records
   why and keeps the choice reversible.
4. **Build the walking skeleton (Milestone 1)** on seeded data only. App,
   worker, migrations, seeded events rendered through the real API, plus
   formatting, linting, type checking, unit tests, and CI. No live source until
   this path runs end to end with CI green.

## Constraints to be aware of

- **Step 2 can block the project.** If no candidate source has permissive terms,
  the MVP shape changes. That is a stop-and-ask decision, not something to work
  around.
- **Public deployment (Milestone 4) requires explicit permission**, as does
  spending money, provisioning paid services, or accepting legal terms.
- **The MVP list in `OVERVIEW.md` §5 is a hard boundary.** Accounts,
  recommendations, notifications, and maps stay out until Milestone 4 produces
  evidence of demand.

## Open questions for the owner

1. Should the first demonstration optimize for local development or immediate
   public deployment? (`OVERVIEW.md` §16, item 3 — still undecided.)
2. Is there standing permission to deploy publicly when Milestone 4 arrives, or
   should that be a separate approval at the time?
