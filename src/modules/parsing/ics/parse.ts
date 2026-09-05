// An iCalendar (RFC 5545) parser covering the subset that event feeds
// actually use.
//
// This module is deliberately pure: bytes in, plain objects out. It cannot
// import storage, the database, or any other module (enforced by lint —
// see docs/adr/0005-module-boundaries.md), which is what lets it be tested
// entirely against fixtures with no network and no database.
//
// Scope: VEVENT only. Timezone-aware DTSTART/DTEND, all-day dates, escaped
// text, folded lines, cancellation status, and change timestamps. Recurrence
// rules are detected and reported but not expanded — see the note at the
// bottom of docs/schema/event-model.md.

import { localToUtc, type LocalDateTime } from "./timezone";

export type IcsDateTime = {
  /** The resolved instant. */
  at: Date;
  /** IANA zone the feed specified, or the fallback that was applied. */
  timeZone: string;
  /** True for DATE values (no time component) — an all-day event. */
  isDate: boolean;
  /** True when the feed gave no zone and the fallback was used. */
  floating: boolean;
};

export type IcsEvent = {
  uid: string;
  summary: string;
  description: string | null;
  location: string | null;
  url: string | null;
  categories: string[];
  start: IcsDateTime;
  end: IcsDateTime | null;
  status: "scheduled" | "cancelled" | "postponed";
  created: Date | null;
  lastModified: Date | null;
  /** Raw RRULE if present. Not expanded; recorded so it is not silently lost. */
  recurrenceRule: string | null;
};

export type IcsParseIssue = {
  /** 1-based index of the VEVENT block, for locating it in the source. */
  eventIndex: number;
  uid: string | null;
  reason: string;
};

export type IcsParseResult = {
  events: IcsEvent[];
  /**
   * Records that could not be parsed. A malformed record is skipped and
   * reported, never allowed to fail the whole batch (CLAUDE.md).
   */
  issues: IcsParseIssue[];
  /** Calendar-level properties, when the feed supplies them. */
  calendarName: string | null;
};

type Property = {
  name: string;
  params: Record<string, string>;
  value: string;
};

/**
 * Undo RFC 5545 line folding: a CRLF (or LF) followed by a space or tab is a
 * continuation, not a new line.
 */
function unfold(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines: string[] = [];

  for (const line of normalized.split("\n")) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }

  return lines.filter((line) => line.trim() !== "");
}

/**
 * Split a content line into name, parameters, and value.
 * Colons and semicolons inside a quoted parameter value are not separators.
 */
function parseProperty(line: string): Property | null {
  let inQuotes = false;
  let colonAt = -1;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') inQuotes = !inQuotes;
    else if (char === ":" && !inQuotes) {
      colonAt = i;
      break;
    }
  }

  if (colonAt === -1) return null;

  const head = line.slice(0, colonAt);
  const value = line.slice(colonAt + 1);

  const segments: string[] = [];
  let current = "";
  inQuotes = false;
  for (const char of head) {
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === ";" && !inQuotes) {
      segments.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  segments.push(current);

  const name = segments[0]!.toUpperCase();
  const params: Record<string, string> = {};

  for (const segment of segments.slice(1)) {
    const eq = segment.indexOf("=");
    if (eq === -1) continue;
    const key = segment.slice(0, eq).toUpperCase();
    const paramValue = segment.slice(eq + 1).replace(/^"|"$/g, "");
    params[key] = paramValue;
  }

  return { name, params, value };
}

/** Reverse RFC 5545 TEXT escaping. */
function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

const DATE_TIME_PATTERN = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/;

/**
 * Parse a DATE or DATE-TIME value.
 *
 * Three forms exist and they mean different things:
 *   20260315                     -> a date, all-day
 *   20260315T143000Z             -> an absolute UTC instant
 *   20260315T143000  (+ TZID)    -> wall time in that zone
 *   20260315T143000  (no TZID)   -> "floating" local time; the feed is
 *                                   underspecified, so `fallbackTimeZone` is
 *                                   applied and the result flagged.
 */
function parseDateTime(property: Property, fallbackTimeZone: string): IcsDateTime {
  const match = DATE_TIME_PATTERN.exec(property.value.trim());
  if (!match) {
    throw new Error(`Unrecognized date value: ${property.value}`);
  }

  const [, year, month, day, hour, minute, second, utcFlag] = match;
  const isDate = hour === undefined;

  const local: LocalDateTime = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour ?? "0"),
    minute: Number(minute ?? "0"),
    second: Number(second ?? "0"),
  };

  if (utcFlag === "Z") {
    return {
      at: new Date(
        Date.UTC(
          local.year,
          local.month - 1,
          local.day,
          local.hour,
          local.minute,
          local.second,
        ),
      ),
      timeZone: "UTC",
      isDate: false,
      floating: false,
    };
  }

  const tzid = property.params.TZID;
  const timeZone = tzid ?? fallbackTimeZone;

  return {
    at: localToUtc(local, timeZone),
    timeZone,
    isDate,
    floating: tzid === undefined,
  };
}

function parseUtcStamp(value: string): Date | null {
  const match = DATE_TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour ?? "0"),
      Number(minute ?? "0"),
      Number(second ?? "0"),
    ),
  );
}

function mapStatus(value: string | undefined): IcsEvent["status"] {
  switch (value?.toUpperCase()) {
    case "CANCELLED":
      return "cancelled";
    case "TENTATIVE":
      return "postponed";
    default:
      // CONFIRMED, absent, or anything unrecognized. Note that a *missing*
      // status means scheduled — it never means cancelled.
      return "scheduled";
  }
}

export type ParseIcsOptions = {
  /**
   * Applied to date and floating-time values, which carry no zone of their
   * own. For UVA feeds this is America/New_York.
   */
  fallbackTimeZone: string;
};

export function parseIcs(raw: string, options: ParseIcsOptions): IcsParseResult {
  const lines = unfold(raw);

  const events: IcsEvent[] = [];
  const issues: IcsParseIssue[] = [];
  let calendarName: string | null = null;

  let current: Property[] | null = null;
  let eventIndex = 0;

  for (const line of lines) {
    const property = parseProperty(line);
    if (!property) continue;

    if (property.name === "BEGIN" && property.value.toUpperCase() === "VEVENT") {
      current = [];
      eventIndex += 1;
      continue;
    }

    if (property.name === "END" && property.value.toUpperCase() === "VEVENT") {
      if (current) {
        try {
          events.push(buildEvent(current, options.fallbackTimeZone));
        } catch (error) {
          // One bad record is skipped and reported. It must not take the
          // batch down with it.
          issues.push({
            eventIndex,
            uid: findValue(current, "UID") ?? null,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      current = null;
      continue;
    }

    if (current) {
      current.push(property);
    } else if (property.name === "X-WR-CALNAME") {
      calendarName = unescapeText(property.value);
    }
  }

  return { events, issues, calendarName };
}

function find(properties: Property[], name: string): Property | undefined {
  return properties.find((property) => property.name === name);
}

function findValue(properties: Property[], name: string): string | undefined {
  return find(properties, name)?.value;
}

function buildEvent(properties: Property[], fallbackTimeZone: string): IcsEvent {
  const uid = findValue(properties, "UID")?.trim();
  if (!uid) {
    // Without a stable identifier there is no idempotent import — every run
    // would insert a fresh copy. Refusing here is the correct failure.
    throw new Error("VEVENT has no UID; cannot import idempotently");
  }

  const summary = findValue(properties, "SUMMARY")?.trim();
  if (!summary) {
    throw new Error("VEVENT has no SUMMARY");
  }

  const dtStart = find(properties, "DTSTART");
  if (!dtStart) {
    throw new Error("VEVENT has no DTSTART");
  }

  const start = parseDateTime(dtStart, fallbackTimeZone);

  const dtEnd = find(properties, "DTEND");
  const end = dtEnd ? parseDateTime(dtEnd, fallbackTimeZone) : null;

  if (end && end.at.getTime() < start.at.getTime()) {
    throw new Error("DTEND is before DTSTART");
  }

  const categoriesRaw = findValue(properties, "CATEGORIES");
  const categories = categoriesRaw
    ? categoriesRaw
        .split(",")
        .map((entry) => unescapeText(entry).trim())
        .filter(Boolean)
    : [];

  const description = findValue(properties, "DESCRIPTION");
  const location = findValue(properties, "LOCATION");
  const url = findValue(properties, "URL");

  return {
    uid,
    summary: unescapeText(summary),
    description: description ? unescapeText(description).trim() || null : null,
    location: location ? unescapeText(location).trim() || null : null,
    url: url?.trim() || null,
    categories,
    start,
    end,
    status: mapStatus(findValue(properties, "STATUS")),
    created: parseUtcStamp(findValue(properties, "CREATED") ?? ""),
    lastModified:
      parseUtcStamp(findValue(properties, "LAST-MODIFIED") ?? "") ??
      parseUtcStamp(findValue(properties, "DTSTAMP") ?? ""),
    recurrenceRule: findValue(properties, "RRULE") ?? null,
  };
}
