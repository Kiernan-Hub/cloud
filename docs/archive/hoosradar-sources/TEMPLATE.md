# Source: <human-readable name>

- **Slug:** `<source-slug>`
- **Status:** candidate | approved | active | disabled
- **Completed by:** <name>
- **Date:** <YYYY-MM-DD>

## Ownership

| Field                            | Value |
| -------------------------------- | ----- |
| Owner / publisher                |       |
| Authoritative homepage           |       |
| Contact for questions or removal |       |

## Collection

| Field                                                  | Value                              |
| ------------------------------------------------------ | ---------------------------------- |
| Method                                                 | ics / rss / atom / json_api / html |
| Feed or endpoint URL                                   |                                    |
| Authentication required?                               |                                    |
| Documented rate limit or crawl delay                   |                                    |
| Proposed poll interval                                 |                                    |
| Conditional requests supported (ETag / Last-Modified)? |                                    |

## Terms and permissions

| Field                                       | Value                                   |
| ------------------------------------------- | --------------------------------------- |
| Terms of service URL                        |                                         |
| robots.txt reviewed? (paste relevant lines) |                                         |
| Does collection appear permitted?           |                                         |
| Attribution required?                       |                                         |
| Caching / retention restrictions            |                                         |
| Raw payload retention permitted?            | yes / no                                |
| Reviewed by owner (Kiernan)?                | yes / no — **required before enabling** |

> Concerns or ambiguities found in the terms:
>
> _(write them out; do not resolve an ambiguity by assuming the permissive
> reading)_

## Data shape

| Field                                  | Value                    |
| -------------------------------------- | ------------------------ |
| Approximate event volume               |                          |
| Update frequency observed              |                          |
| Stable per-event identifier available? | **required — see below** |
| Timezone handling in the source        |                          |
| Recurring events represented how?      |                          |

If the source provides no stable identifier, document exactly how
`source_event_key` will be derived deterministically. Getting this wrong breaks
idempotent import, which means every run creates duplicates.

Fields available, mapped to the model in `../schema/event-model.md`:

| Our field       | Source field | Notes |
| --------------- | ------------ | ----- |
| `title`         |              |       |
| `description`   |              |       |
| `starts_at`     |              |       |
| `ends_at`       |              |       |
| `venue_name`    |              |       |
| `organization`  |              |       |
| `category_raw`  |              |       |
| `canonical_url` |              |       |

Missing or unreliable fields:

## Failure behavior

- What does the source do when it is down or rate-limiting?
- What is the fixture file for parser tests? (`src/modules/parsing/<slug>/fixtures/`)
- Known malformed-record cases to cover in tests:

## Decision

- [ ] Approved for collection
- [ ] Rejected — reason:
- [ ] Deferred — blocked on:
