// Parsed payload -> canonical event candidate.
//
// This is where source-specific shapes become the one shape storage knows.
// It is kept separate from parsing so a new source format only needs a new
// parser, and separate from storage so it can be tested as a pure function.
//
// Rules it enforces, all from CLAUDE.md and OVERVIEW.md:
//   - never invent a field the source did not provide
//   - a stable source key is mandatory (idempotent import depends on it)
//   - the content hash covers only fields a user would care about, so a
//     source republishing identical data is not reported as a change

import { createHash } from "node:crypto";

import type { IcsEvent } from "@/modules/parsing";

export type EventCandidate = {
  sourceEventKey: string;
  canonicalUrl: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
  timezone: string;
  isAllDay: boolean;
  venueName: string | null;
  venueAddress: string | null;
  organizationName: string | null;
  categoryRaw: string | null;
  tags: string[];
  costText: string | null;
  isFree: boolean | null;
  accessibilityNotes: string | null;
  status: "scheduled" | "cancelled" | "postponed";
  sourcePublishedAt: Date | null;
  sourceUpdatedAt: Date | null;
  contentHash: string;
};

export type NormalizationIssue = {
  sourceEventKey: string | null;
  reason: string;
};

export type NormalizeResult = {
  candidates: EventCandidate[];
  issues: NormalizationIssue[];
};

/**
 * Fields whose change a user would actually notice. Deliberately excludes
 * timestamps the source bumps on every republish — otherwise every poll
 * would look like a material change and the freshness signal would be
 * meaningless.
 */
function computeContentHash(candidate: Omit<EventCandidate, "contentHash">): string {
  const material = [
    candidate.title,
    candidate.description ?? "",
    candidate.startsAt.toISOString(),
    candidate.endsAt?.toISOString() ?? "",
    candidate.timezone,
    String(candidate.isAllDay),
    candidate.venueName ?? "",
    candidate.venueAddress ?? "",
    candidate.categoryRaw ?? "",
    candidate.status,
    candidate.canonicalUrl,
  ];

  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** A normalized organization key: lowercased, punctuation collapsed. */
export function normalizeOrganizationName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type NormalizeIcsOptions = {
  /**
   * Used only when an event carries no URL of its own. Provenance requires a
   * link back, and a link to the calendar is better than none — but an
   * event-specific URL is always preferred.
   */
  fallbackUrl: string;
  /** Applied when the feed names no organization. */
  defaultOrganizationName?: string | null;
};

export function normalizeIcsEvent(
  event: IcsEvent,
  options: NormalizeIcsOptions,
): EventCandidate {
  const title = normalizeWhitespace(event.summary);
  if (!title) {
    throw new Error("Event has an empty title after normalization");
  }

  const canonicalUrl = event.url ?? options.fallbackUrl;
  if (!/^https?:\/\//i.test(canonicalUrl)) {
    throw new Error(`Event has no usable source URL: ${canonicalUrl}`);
  }

  // ICS LOCATION is a single free-text field. Splitting it into a venue name
  // and an address is guesswork, so we keep the whole string as the venue
  // name and leave the address null rather than inventing structure.
  const venueName = event.location ? normalizeWhitespace(event.location) : null;

  const withoutHash: Omit<EventCandidate, "contentHash"> = {
    sourceEventKey: event.uid,
    canonicalUrl,
    title,
    description: event.description,
    startsAt: event.start.at,
    endsAt: event.end?.at ?? null,
    timezone: event.start.timeZone,
    isAllDay: event.start.isDate,
    venueName,
    venueAddress: null,
    organizationName: options.defaultOrganizationName ?? null,
    // Keep the source's own first category verbatim; mapping to a controlled
    // vocabulary needs real data first (see event-model.md open questions).
    categoryRaw: event.categories[0] ?? null,
    tags: event.categories,
    costText: null,
    // The source said nothing about cost. null means unknown — not free.
    isFree: null,
    accessibilityNotes: null,
    status: event.status,
    sourcePublishedAt: event.created,
    sourceUpdatedAt: event.lastModified,
  };

  return { ...withoutHash, contentHash: computeContentHash(withoutHash) };
}

export function normalizeIcsEvents(
  events: IcsEvent[],
  options: NormalizeIcsOptions,
): NormalizeResult {
  const candidates: EventCandidate[] = [];
  const issues: NormalizationIssue[] = [];
  const seenKeys = new Set<string>();

  for (const event of events) {
    try {
      const candidate = normalizeIcsEvent(event, options);

      // A feed repeating a UID within one payload would make the upsert
      // order-dependent. Keep the first and report the rest.
      if (seenKeys.has(candidate.sourceEventKey)) {
        issues.push({
          sourceEventKey: candidate.sourceEventKey,
          reason: "Duplicate UID within the same payload; kept the first",
        });
        continue;
      }

      seenKeys.add(candidate.sourceEventKey);
      candidates.push(candidate);
    } catch (error: unknown) {
      issues.push({
        sourceEventKey: event.uid ?? null,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { candidates, issues };
}
