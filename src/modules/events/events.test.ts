import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, sqlClient } from "@/lib/db";
import { sourceEvents, sources } from "@/lib/db/schema";
import {
  getEventById,
  listUpcoming,
  MAX_PAGE_SIZE,
  STALE_AFTER_HOURS,
} from "@/modules/events";

const TEST_SOURCE = "test-events-source";

function hoursFromNow(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

async function cleanup() {
  await db.execute(sql`DELETE FROM sources WHERE id = ${TEST_SOURCE}`);
}

async function seedEvents() {
  await db.insert(sources).values({
    id: TEST_SOURCE,
    displayName: "Events test source",
    owner: "test",
    homepageUrl: "https://example.invalid",
    method: "ics",
    termsReviewedAt: new Date(),
    enabled: true,
  });

  await db.insert(sourceEvents).values([
    // Past — must be excluded by default.
    {
      sourceId: TEST_SOURCE,
      sourceEventKey: "past",
      canonicalUrl: "https://example.invalid/past",
      title: "Past event",
      startsAt: hoursFromNow(-48),
      timezone: "America/New_York",
      contentHash: "h",
    },
    // Cancelled — excluded from the default list, but not deleted.
    {
      sourceId: TEST_SOURCE,
      sourceEventKey: "cancelled",
      canonicalUrl: "https://example.invalid/cancelled",
      title: "Cancelled event",
      startsAt: hoursFromNow(5),
      timezone: "America/New_York",
      status: "cancelled",
      contentHash: "h",
    },
    {
      sourceId: TEST_SOURCE,
      sourceEventKey: "soon",
      canonicalUrl: "https://example.invalid/soon",
      title: "Soon event",
      startsAt: hoursFromNow(2),
      timezone: "America/New_York",
      contentHash: "h",
    },
    {
      sourceId: TEST_SOURCE,
      sourceEventKey: "later",
      canonicalUrl: "https://example.invalid/later",
      title: "Later event",
      startsAt: hoursFromNow(10),
      timezone: "America/New_York",
      contentHash: "h",
    },
    // Stale: synced long enough ago that it must be flagged.
    {
      sourceId: TEST_SOURCE,
      sourceEventKey: "stale",
      canonicalUrl: "https://example.invalid/stale",
      title: "Stale event",
      startsAt: hoursFromNow(20),
      timezone: "America/New_York",
      contentHash: "h",
      lastSyncedAt: hoursFromNow(-(STALE_AFTER_HOURS + 5)),
    },
  ]);
}

beforeEach(async () => {
  await cleanup();
  await seedEvents();
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("listUpcoming", () => {
  it("excludes past and cancelled events by default", async () => {
    const { events } = await listUpcoming();
    const keys = events.map((e) => e.title);

    expect(keys).not.toContain("Past event");
    expect(keys).not.toContain("Cancelled event");
    expect(keys).toContain("Soon event");
  });

  it("orders by start time ascending", async () => {
    const { events } = await listUpcoming();
    const mine = events.filter((e) => e.sourceId === TEST_SOURCE);
    const times = mine.map((e) => e.startsAt.getTime());

    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("clamps an oversized page request instead of honoring it", async () => {
    const { events } = await listUpcoming({ limit: 5000 });
    expect(events.length).toBeLessThanOrEqual(MAX_PAGE_SIZE);
  });

  it("clamps a zero or negative page request to at least one", async () => {
    const { events } = await listUpcoming({ limit: 0 });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("paginates without repeating or skipping events", async () => {
    const first = await listUpcoming({ limit: 1 });
    expect(first.nextCursor).not.toBeNull();

    const second = await listUpcoming({ limit: 1, cursor: first.nextCursor });

    expect(second.events[0]!.id).not.toBe(first.events[0]!.id);
    expect(second.events[0]!.startsAt.getTime()).toBeGreaterThanOrEqual(
      first.events[0]!.startsAt.getTime(),
    );
  });

  it("returns a null cursor on the final page", async () => {
    const { nextCursor } = await listUpcoming({ limit: MAX_PAGE_SIZE });
    expect(nextCursor).toBeNull();
  });

  it("always includes provenance on every event", async () => {
    const { events } = await listUpcoming();
    for (const event of events) {
      expect(event.sourceId).toBeTruthy();
      expect(event.canonicalUrl).toMatch(/^https?:\/\//);
      expect(event.lastSyncedAt).toBeInstanceOf(Date);
    }
  });

  it("flags a stale event without hiding it", async () => {
    const { events } = await listUpcoming({ limit: MAX_PAGE_SIZE });
    const stale = events.find((e) => e.title === "Stale event");

    expect(stale).toBeDefined();
    expect(stale!.isStale).toBe(true);
  });
});

describe("getEventById", () => {
  it("returns null for a non-uuid id rather than throwing", async () => {
    await expect(getEventById("not-a-uuid")).resolves.toBeNull();
  });

  it("returns null for an unknown uuid", async () => {
    await expect(
      getEventById("00000000-0000-4000-8000-000000000000"),
    ).resolves.toBeNull();
  });

  it("returns a cancelled event by id even though the list hides it", async () => {
    const rows = await db.execute<{ id: string }>(
      sql`SELECT id FROM source_events WHERE source_event_key = 'cancelled'`,
    );
    const event = await getEventById(rows[0]!.id);

    expect(event).not.toBeNull();
    expect(event!.status).toBe("cancelled");
  });
});
