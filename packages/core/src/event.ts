import { z } from "zod";

/**
 * Status enum and thresholds are ADR-0001 section 2. Only a successful
 * ingestion run may advance an event toward `missingFromSource` — the
 * counter that enforces that lives in the db package, not here.
 */
export const EVENT_STATUSES = [
  "active",
  "cancelled_by_source",
  "missing_from_source",
  "superseded",
] as const;

export const eventStatusSchema = z.enum(EVENT_STATUSES);
export type EventStatus = z.infer<typeof eventStatusSchema>;

/** ADR-0001 section 2: three consecutive successful runs missing an event. */
export const MISSING_AFTER_CONSECUTIVE_ABSENCES = 3;

export const geoSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type Geo = z.infer<typeof geoSchema>;

/**
 * A normalized event, ADR-0001 sections 1, 3 and 4.
 *
 * `startAt`/`endAt` are instants (UTC). `startTz` is the source's own zone,
 * kept separately because recurrence expansion and "local time" display both
 * need it — a bare UTC instant cannot recover either. See ADR-0001 section 3
 * and its addendum: the Hoos Involved feed ships no zone information at all,
 * and a naive same-day check on UTC dates misclassifies ordinary evening
 * events as multi-day once the source crosses UTC midnight.
 */
export const eventSchema = z.object({
  id: z.string().uuid(),

  seriesId: z.string().uuid().nullable(),
  occurrenceStart: z.date().nullable(),

  sourceId: z.string().uuid(),
  sourceUid: z.string().min(1).nullable(),
  contentFingerprint: z.string().length(64).nullable(),

  title: z.string().min(1),
  descriptionHtml: z.string(),

  startAt: z.date(),
  endAt: z.date(),
  startTz: z.string().min(1),
  isAllDay: z.boolean(),
  startTimeUnknown: z.boolean(),

  venueName: z.string().nullable(),
  venueAddress: z.string().nullable(),
  geo: geoSchema.nullable(),

  organizationName: z.string().nullable(),
  categories: z.array(z.string()),

  costText: z.string().nullable(),
  accessibilityText: z.string().nullable(),

  sourceUrl: z.string().url(),
  sourcePublishedAt: z.date().nullable(),

  firstSeenAt: z.date(),
  lastSeenAt: z.date(),
  lastSyncedAt: z.date(),

  status: eventStatusSchema,
  consecutiveAbsences: z.number().int().min(0),
  duplicateGroupId: z.string().uuid().nullable(),
});
export type Event = z.infer<typeof eventSchema>;

/**
 * The shape a source parser produces, before ids, timestamps, or status are
 * assigned by the ingestion pipeline. Deliberately excludes description and
 * url from anything used to compute a fallback identity — see
 * `contentFingerprintOf` below.
 */
export const normalizedCandidateSchema = eventSchema.omit({
  id: true,
  seriesId: true,
  contentFingerprint: true,
  firstSeenAt: true,
  lastSeenAt: true,
  lastSyncedAt: true,
  status: true,
  consecutiveAbsences: true,
  duplicateGroupId: true,
});
export type NormalizedCandidate = z.infer<typeof normalizedCandidateSchema>;

/** True once an event is past, derived and never stored — ADR-0001 section 2. */
export function isPast(event: Pick<Event, "endAt">, now: Date = new Date()): boolean {
  return event.endAt.getTime() < now.getTime();
}

/**
 * "Events on this day" is an overlap test, not a date-string comparison.
 * ADR-0001's addendum: a same-day check on UTC dates wrongly flags ordinary
 * evening events as multi-day once the source's local day crosses UTC
 * midnight, which the Hoos Involved feed does for every evening event.
 */
export function overlapsDay(
  event: Pick<Event, "startAt" | "endAt">,
  dayStart: Date,
  dayEnd: Date,
): boolean {
  return event.startAt.getTime() < dayEnd.getTime() && event.endAt.getTime() > dayStart.getTime();
}
