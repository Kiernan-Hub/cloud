// Read access to events. Provenance (source, canonical URL, freshness) is
// part of the return type rather than an optional extra — CLAUDE.md treats it
// as non-negotiable, so it should be impossible to render an event without it.

import { and, asc, eq, gt, gte, ne, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { organizations, sourceEvents, sources } from "@/lib/db/schema";

export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 20;

// An event is treated as possibly-outdated when its source has not been
// successfully checked within this window. Displayed to users rather than
// used to hide anything.
export const STALE_AFTER_HOURS = 48;

export type EventListItem = {
  id: string;
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
  costText: string | null;
  isFree: boolean | null;
  accessibilityNotes: string | null;
  status: "scheduled" | "cancelled" | "postponed";
  // Provenance — always present.
  sourceId: string;
  sourceName: string;
  canonicalUrl: string;
  lastSyncedAt: Date;
  isStale: boolean;
};

export type Cursor = { startsAt: string; id: string };

export type ListUpcomingResult = {
  events: EventListItem[];
  nextCursor: Cursor | null;
};

function isStale(lastSyncedAt: Date): boolean {
  const ageHours = (Date.now() - lastSyncedAt.getTime()) / (1000 * 60 * 60);
  return ageHours > STALE_AFTER_HOURS;
}

const selection = {
  id: sourceEvents.id,
  title: sourceEvents.title,
  description: sourceEvents.description,
  startsAt: sourceEvents.startsAt,
  endsAt: sourceEvents.endsAt,
  timezone: sourceEvents.timezone,
  isAllDay: sourceEvents.isAllDay,
  venueName: sourceEvents.venueName,
  venueAddress: sourceEvents.venueAddress,
  organizationName: organizations.displayName,
  categoryRaw: sourceEvents.categoryRaw,
  costText: sourceEvents.costText,
  isFree: sourceEvents.isFree,
  accessibilityNotes: sourceEvents.accessibilityNotes,
  status: sourceEvents.status,
  sourceId: sourceEvents.sourceId,
  sourceName: sources.displayName,
  canonicalUrl: sourceEvents.canonicalUrl,
  lastSyncedAt: sourceEvents.lastSyncedAt,
};

type SelectedRow = {
  [K in keyof typeof selection]: EventListItem[Extract<K, keyof EventListItem>];
};

function toListItem(row: SelectedRow): EventListItem {
  return { ...row, isStale: isStale(row.lastSyncedAt) };
}

export async function listUpcoming(options?: {
  limit?: number;
  cursor?: Cursor | null;
  now?: Date;
}): Promise<ListUpcomingResult> {
  // Clamp rather than honor an arbitrary page size, so a caller cannot ask
  // for an unbounded response.
  const requested = options?.limit ?? DEFAULT_PAGE_SIZE;
  const limit = Math.min(Math.max(1, requested), MAX_PAGE_SIZE);
  const now = options?.now ?? new Date();
  const cursor = options?.cursor ?? null;

  // Keyset pagination on (starts_at, id). The id tiebreak keeps the cursor
  // stable when several events share a start time.
  const cursorPredicate = cursor
    ? or(
        gt(sourceEvents.startsAt, new Date(cursor.startsAt)),
        and(
          eq(sourceEvents.startsAt, new Date(cursor.startsAt)),
          gt(sourceEvents.id, cursor.id),
        ),
      )
    : undefined;

  const rows = await db
    .select(selection)
    .from(sourceEvents)
    .leftJoin(organizations, eq(sourceEvents.organizationId, organizations.id))
    .innerJoin(sources, eq(sourceEvents.sourceId, sources.id))
    .where(
      and(
        gte(sourceEvents.startsAt, now),
        ne(sourceEvents.status, "cancelled"),
        cursorPredicate,
      ),
    )
    .orderBy(asc(sourceEvents.startsAt), asc(sourceEvents.id))
    // Fetch one extra to determine whether another page exists.
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    events: page.map(toListItem),
    nextCursor:
      hasMore && last ? { startsAt: last.startsAt.toISOString(), id: last.id } : null,
  };
}

export async function getEventById(id: string): Promise<EventListItem | null> {
  // Guard against a malformed id reaching Postgres as an invalid uuid cast.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return null;
  }

  const [row] = await db
    .select(selection)
    .from(sourceEvents)
    .leftJoin(organizations, eq(sourceEvents.organizationId, organizations.id))
    .innerJoin(sources, eq(sourceEvents.sourceId, sources.id))
    .where(eq(sourceEvents.id, id))
    .limit(1);

  return row ? toListItem(row) : null;
}

export type SourceHealth = {
  sourceId: string;
  displayName: string;
  enabled: boolean;
  lastSyncedAt: Date | null;
  isStale: boolean;
  eventCount: number;
};

export async function getSourceHealth(): Promise<SourceHealth[]> {
  const rows = await db
    .select({
      sourceId: sources.id,
      displayName: sources.displayName,
      enabled: sources.enabled,
      lastSyncedAt: sql<Date | null>`max(${sourceEvents.lastSyncedAt})`,
      eventCount: sql<number>`count(${sourceEvents.id})::int`,
    })
    .from(sources)
    .leftJoin(sourceEvents, eq(sourceEvents.sourceId, sources.id))
    .groupBy(sources.id, sources.displayName, sources.enabled);

  return rows.map((row) => ({
    ...row,
    isStale: row.lastSyncedAt ? isStale(new Date(row.lastSyncedAt)) : true,
  }));
}

export { upsertSourceEvents } from "./upsert";
export type { UpsertOptions, UpsertSummary } from "./upsert";
