// Seeds a clearly-marked demo source with fake events (M1-06).
//
// Two things this script is deliberately proving, not just doing:
//   1. It is idempotent. Running it twice yields the same rows, not double.
//      That exercises the UNIQUE (source_id, source_event_key) design that
//      real ingestion will depend on.
//   2. It covers edge cases the UI has to handle — all-day, no end time,
//      cancelled, missing venue, stale — so empty/odd states are visible in
//      development instead of being discovered in production.
//
// Every event is prefixed [DEMO] and attributed to the `demo-seed` source so
// seeded data can never be mistaken for a real UVA event.

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { db, sqlClient } from "@/lib/db";
import { organizations, sourceEvents, sources } from "@/lib/db/schema";
import { logger } from "@/lib/log";

const DEMO_SOURCE_ID = "demo-seed";
const TZ = "America/New_York";

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function contentHash(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

type DemoEvent = {
  key: string;
  title: string;
  description: string | null;
  startsInHours: number;
  durationHours: number | null;
  venueName: string | null;
  venueAddress: string | null;
  category: string | null;
  isAllDay?: boolean;
  status?: "scheduled" | "cancelled" | "postponed";
  isFree?: boolean | null;
  costText?: string | null;
  accessibilityNotes?: string | null;
  staleHours?: number;
  organization: string;
};

const DEMO_EVENTS: DemoEvent[] = [
  {
    key: "demo-001",
    title: "[DEMO] Intro to Python Workshop",
    description: "A beginner-friendly walkthrough of Python basics.",
    startsInHours: 6,
    durationHours: 2,
    venueName: "Rice Hall 130",
    venueAddress: "85 Engineer's Way, Charlottesville, VA",
    category: "Workshop",
    isFree: true,
    organization: "Demo Computing Club",
  },
  {
    key: "demo-002",
    title: "[DEMO] Career Fair Prep Session",
    description: "Resume review and mock interviews.",
    startsInHours: 26,
    durationHours: 3,
    venueName: "Newcomb Hall Ballroom",
    venueAddress: "180 McCormick Rd, Charlottesville, VA",
    category: "Career",
    isFree: true,
    accessibilityNotes: "Wheelchair accessible; ASL interpreter on request.",
    organization: "Demo Career Center",
  },
  {
    // Edge case: no end time. The UI must not assume a duration.
    key: "demo-003",
    title: "[DEMO] Open Mic Night",
    description: "Sign-ups at the door.",
    startsInHours: 30,
    durationHours: null,
    venueName: "The Demo Coffee House",
    venueAddress: null,
    category: "Arts",
    isFree: true,
    organization: "Demo Student Union",
  },
  {
    // Edge case: all-day event.
    key: "demo-004",
    title: "[DEMO] Spring Involvement Day",
    description: "Browse student organizations across Grounds.",
    startsInHours: 54,
    durationHours: 24,
    isAllDay: true,
    venueName: "The Lawn",
    venueAddress: "1826 University Ave, Charlottesville, VA",
    category: "Involvement",
    isFree: true,
    organization: "Demo Student Union",
  },
  {
    // Edge case: cancelled. Must render distinctly and be excluded from
    // default ordering, but never be deleted.
    key: "demo-005",
    title: "[DEMO] Guest Lecture: Distributed Systems",
    description: "Cancelled by the organizer.",
    startsInHours: 72,
    durationHours: 1,
    venueName: "Olsson Hall 120",
    venueAddress: "151 Engineer's Way, Charlottesville, VA",
    category: "Lecture",
    status: "cancelled",
    isFree: true,
    organization: "Demo Computing Club",
  },
  {
    // Edge case: no venue at all.
    key: "demo-006",
    title: "[DEMO] Virtual Alumni Panel",
    description: "Link provided after registration.",
    startsInHours: 80,
    durationHours: 1.5,
    venueName: null,
    venueAddress: null,
    category: "Career",
    isFree: true,
    organization: "Demo Career Center",
  },
  {
    // Edge case: stale. last_synced_at is well in the past, so the UI must
    // show this as possibly-outdated rather than silently trusting it.
    key: "demo-007",
    title: "[DEMO] Weekly Trivia Night",
    description: "Prizes for the top three teams.",
    startsInHours: 96,
    durationHours: 2,
    venueName: "Demo Student Center",
    venueAddress: null,
    category: "Social",
    isFree: false,
    costText: "$5 per team",
    staleHours: 120,
    organization: "Demo Student Union",
  },
  {
    // Edge case: paid event with no description.
    key: "demo-008",
    title: "[DEMO] Basketball vs. Demo State",
    description: null,
    startsInHours: 120,
    durationHours: 2.5,
    venueName: "Demo Arena",
    venueAddress: "295 Massie Rd, Charlottesville, VA",
    category: "Athletics",
    isFree: false,
    costText: "Student tickets $10",
    organization: "Demo Athletics",
  },
];

// Fill out to ~30 events so pagination is exercised, cycling the templates
// with distinct keys and times. Titles stay clearly marked as demo data.
function buildAllEvents(): DemoEvent[] {
  const extras: DemoEvent[] = [];
  for (let i = 0; i < 22; i++) {
    const base = DEMO_EVENTS[i % DEMO_EVENTS.length]!;
    extras.push({
      ...base,
      key: `demo-gen-${String(i + 1).padStart(3, "0")}`,
      title: `${base.title} (session ${i + 2})`,
      startsInHours: base.startsInHours + 24 * (i + 1),
      staleHours: undefined,
      status: "scheduled",
    });
  }
  return [...DEMO_EVENTS, ...extras];
}

async function seed() {
  const now = new Date();

  await db
    .insert(sources)
    .values({
      id: DEMO_SOURCE_ID,
      displayName: "Demo seed data (not a real source)",
      owner: "HoosRadar development",
      homepageUrl: "https://example.invalid/hoosradar-demo",
      method: "json_api",
      termsUrl: null,
      // Locally-generated fixture data, not collected from anyone — this is
      // what makes it eligible to be enabled under the
      // enabled_requires_terms_review constraint.
      termsReviewedAt: now,
      termsNotes:
        "Synthetic development data generated by src/lib/db/seed.ts. Not collected from any external source.",
      retainRawPayload: false,
      intervalSeconds: 3600,
      // Disabled on purpose: this data is written directly by this script,
      // not fetched from anywhere, so there is nothing for the worker to
      // poll. Leaving it enabled would make every tick fail against a
      // source that does not exist.
      enabled: false,
    })
    .onConflictDoUpdate({
      target: sources.id,
      set: { updatedAt: now },
    });

  const allEvents = buildAllEvents();
  const orgNames = [...new Set(allEvents.map((e) => e.organization))];

  const orgIdByName = new Map<string, string>();
  for (const name of orgNames) {
    const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const [row] = await db
      .insert(organizations)
      .values({ normalizedName: normalized, displayName: name })
      .onConflictDoUpdate({
        target: organizations.normalizedName,
        set: { displayName: name },
      })
      .returning({ id: organizations.id });
    orgIdByName.set(name, row!.id);
  }

  for (const event of allEvents) {
    const startsAt = hoursFromNow(event.startsInHours);
    const endsAt =
      event.durationHours === null
        ? null
        : hoursFromNow(event.startsInHours + event.durationHours);
    const syncedAt = event.staleHours ? hoursFromNow(-event.staleHours) : now;

    await db
      .insert(sourceEvents)
      .values({
        sourceId: DEMO_SOURCE_ID,
        sourceEventKey: event.key,
        canonicalUrl: `https://example.invalid/hoosradar-demo/events/${event.key}`,
        title: event.title,
        description: event.description,
        startsAt,
        endsAt,
        timezone: TZ,
        isAllDay: event.isAllDay ?? false,
        venueName: event.venueName,
        venueAddress: event.venueAddress,
        organizationId: orgIdByName.get(event.organization)!,
        categoryRaw: event.category,
        costText: event.costText ?? null,
        isFree: event.isFree ?? null,
        accessibilityNotes: event.accessibilityNotes ?? null,
        status: event.status ?? "scheduled",
        lastSeenAt: syncedAt,
        lastSyncedAt: syncedAt,
        contentHash: contentHash([event.key, event.title, startsAt.toISOString()]),
      })
      // The idempotency guarantee: a re-run updates in place rather than
      // inserting a second copy.
      .onConflictDoUpdate({
        target: [sourceEvents.sourceId, sourceEvents.sourceEventKey],
        set: {
          title: event.title,
          description: event.description,
          startsAt,
          endsAt,
          lastSeenAt: syncedAt,
          lastSyncedAt: syncedAt,
        },
      });
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sourceEvents);

  logger.info("seed complete", {
    source: DEMO_SOURCE_ID,
    organizations: orgNames.length,
    events_in_table: count,
  });
}

seed()
  .then(() => sqlClient.end())
  .catch(async (error: unknown) => {
    logger.error("seed failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    await sqlClient.end();
    process.exit(1);
  });
