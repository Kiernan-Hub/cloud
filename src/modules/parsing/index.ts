// Per-source parsers.
//
// A parser takes bytes and returns a plain object. It must not import
// storage, dedup, search, or the database client — enforced by lint rules in
// eslint.config.mjs. See docs/adr/0005-module-boundaries.md.
//
// ICS is implemented first because iCalendar is a published standard
// (RFC 5545) rather than one vendor's shape, so a single parser serves
// Localist, LibCal, Google Calendar and most other publishers.

export { parseIcs } from "./ics/parse";
export type {
  IcsEvent,
  IcsDateTime,
  IcsParseIssue,
  IcsParseResult,
  ParseIcsOptions,
} from "./ics/parse";
export { isValidTimeZone, localToUtc, UnknownTimeZoneError } from "./ics/timezone";
export type { LocalDateTime } from "./ics/timezone";
