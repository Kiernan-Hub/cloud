# ADR-0002: Sanitizing imported content

- **Status:** Proposed
- **Date:** 2026-09-01
- **Affects:** Milestone 2 onward — any milestone that renders source content

## Context

Event descriptions arrive as HTML from third-party feeds and are rendered in a
browser. That is stored cross-site scripting in its textbook form: content
originating outside our control, persisted by us, executed in a visitor's
browser with our origin's privileges. It is the most likely real vulnerability
in this product, and `OVERVIEW.md` §7 currently covers it in a single line.

The threat model is not a determined attacker targeting HoosRadar. It is that
any of several hundred student organizations can type into a description field
on a platform we do not control, and whatever they type reaches our users. Most
risk here is accidental; the mitigation is the same either way.

This decision is stack-independent — it is a policy about what survives
sanitization, and any competent HTML sanitizer for the eventual language can
enforce it.

## Decision

**Sanitize on write, store the sanitized form, and keep the raw payload
separately.** Do not sanitize at render time.

Reasons: it happens once per import rather than once per page view; every read
path is safe by construction rather than by remembering to escape; and the raw
payload is retained anyway for debugging, so nothing is lost. If the allowlist
later changes, re-sanitize from the retained raw payload.

**Allowlist, not blocklist.** Anything not named below is stripped, with its
text content preserved:

| Allowed | Notes |
| --- | --- |
| `p`, `br` | Paragraph structure |
| `strong`, `b`, `em`, `i` | Inline emphasis |
| `ul`, `ol`, `li` | Lists |
| `a` | `href` only; see the URL rule below |
| `h3`, `h4` | Demoted from any source heading level, so imported content cannot outrank page headings |

Everything else — `script`, `style`, `iframe`, `object`, `embed`, `form`,
`input`, `svg`, `math`, and all others — is removed.

**Attributes: none, except `href` on `a`.** No `class`, no `style`, no `id`, and
categorically no `on*` event handlers. Dropping `style` also prevents imported
content from breaking page layout, which is a real problem independent of
security.

**URL rule.** An `href` survives only if it parses and its scheme is `http` or
`https`. `javascript:`, `data:`, and `vbscript:` are rejected — including
obfuscated forms, which is why the check is "parse it and read the scheme"
rather than a string match. Every surviving link renders with
`rel="noopener noreferrer nofollow"` and an external-link indicator.

**Images are not permitted in descriptions** for the MVP. An `img` from an
arbitrary feed is a request from our users' browsers to a third-party server on
page load, which leaks visitor IP addresses to whoever hosts it. Revisit if
sources turn out to depend on inline images.

## Testing

The sanitizer gets hostile fixtures in the parser fixture set, tested exactly
like source payloads. At minimum:

- `<script>alert(1)</script>` and `<img src=x onerror=alert(1)>`
- `<a href="javascript:alert(1)">` and case/whitespace variants such as
  `JaVaScRiPt:` and `java&#115;cript:`
- `<a href="data:text/html;base64,...">`
- `<iframe>`, `<object>`, `<embed>`, `<svg onload=...>`
- `<div style="position:fixed;inset:0">` — layout escape, not script
- Malformed and unclosed tags, which is how sanitizers that parse with regular
  expressions are usually defeated

Each asserts the sanitized output, not merely that no exception was raised.

**Use a maintained sanitizer library. Do not write one.** HTML sanitization
looks approachable and is not; the failure mode is silent and the attack surface
is the entire HTML parsing algorithm. The library choice belongs to the stack
ADR — this record fixes the policy it must be configured to enforce.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Strip all HTML, store plain text | Safest, but loses paragraph and list structure that makes descriptions readable. Reconsider if the allowlist proves troublesome |
| Sanitize at render time | Every read path becomes a place to forget; also repeated work per page view |
| Blocklist known-dangerous tags | Fails open on anything not anticipated — the wrong default for this |
| Render descriptions in a sandboxed iframe | Real isolation, but heavy for a paragraph of text and bad for accessibility and search |

## Consequences

Some source formatting is lost — tables, inline images, embedded video. That is
an accepted cost; the canonical source link is always present for anyone who
wants the original.

Sanitizing on write means an allowlist change requires re-sanitizing stored
events from retained raw payloads. That is a batch job, and it is the reason the
raw-payload retention window and this decision are coupled: a retention window
shorter than the time between allowlist revisions means some events cannot be
re-sanitized and must be re-imported instead.

## Revisit when

- A source's descriptions are materially unusable under this allowlist.
- Images become necessary, at which point the answer is likely proxying and
  caching them rather than hot-linking.
