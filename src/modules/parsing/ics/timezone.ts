// Converting an iCalendar local time to a real instant.
//
// This is the subtlest part of parsing a calendar feed. `DTSTART;TZID=
// America/New_York:20260315T023000` names a wall-clock time in a zone, not a
// point on the timeline. Turning it into one requires knowing that zone's UTC
// offset *at that moment*, which changes with daylight saving time.
//
// Node 22 ships full ICU, so rather than embed a tz database we ask Intl what
// the offset was, then correct for it.

/** Wall-clock components, as written in the feed. */
export type LocalDateTime = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/**
 * The offset, in minutes, that `timeZone` was at the given instant.
 * Positive means ahead of UTC.
 */
function offsetMinutesAt(instant: Date, timeZone: string): number {
  // Format the instant in the target zone, then read it back as if it were
  // UTC. The gap between that and the true instant is the offset.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts: Record<string, number> = {};
  for (const { type, value } of formatter.formatToParts(instant)) {
    if (type !== "literal") parts[type] = Number(value);
  }

  // Intl renders midnight as hour 24 in some environments.
  const hour = parts.hour === 24 ? 0 : (parts.hour ?? 0);

  const asUtc = Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    hour,
    parts.minute ?? 0,
    parts.second ?? 0,
  );

  return (asUtc - instant.getTime()) / 60000;
}

export class UnknownTimeZoneError extends Error {
  constructor(timeZone: string) {
    super(`Unknown IANA time zone: ${timeZone}`);
    this.name = "UnknownTimeZoneError";
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a wall-clock time in an IANA zone to a UTC instant.
 *
 * DST creates two awkward cases, and both are handled deliberately rather
 * than left to chance:
 *
 * - **Spring forward**: 2:30am may not exist. We resolve it forward, to the
 *   same instant 3:30am maps to, which is what calendar clients do.
 * - **Fall back**: 1:30am happens twice. We take the *first* (still on
 *   daylight time), matching RFC 5545 implementations.
 */
export function localToUtc(local: LocalDateTime, timeZone: string): Date {
  if (!isValidTimeZone(timeZone)) {
    throw new UnknownTimeZoneError(timeZone);
  }

  // Treat the wall time as if it were UTC; every candidate instant is this
  // shifted by some offset.
  const naive = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );

  const DAY = 86_400_000;
  // The offsets in effect on either side of any transition near this time.
  // A day's margin is comfortably wider than any real DST shift.
  const offsetBefore = offsetMinutesAt(new Date(naive - DAY), timeZone);
  const offsetAfter = offsetMinutesAt(new Date(naive + DAY), timeZone);

  // A candidate is only real if the zone actually has that offset at the
  // instant the candidate lands on. This is what detects gaps and overlaps.
  const candidates = [...new Set([offsetBefore, offsetAfter])]
    .map((offset) => naive - offset * 60000)
    .filter(
      (instant) =>
        offsetMinutesAt(new Date(instant), timeZone) * 60000 === naive - instant,
    );

  if (candidates.length === 1) {
    return new Date(candidates[0]!);
  }

  if (candidates.length > 1) {
    // Fall-back overlap: the wall time happens twice. Take the first, which
    // is still on the pre-transition offset.
    return new Date(Math.min(...candidates));
  }

  // Spring-forward gap: the wall time never happens. Interpret it with the
  // pre-transition offset, which shifts it forward past the gap — 2:30am
  // resolves to the instant 3:30am names.
  return new Date(naive - offsetBefore * 60000);
}
