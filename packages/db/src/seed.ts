import { sanitizeEventDescription } from "@hoosradar/core";
import { getPool } from "./pool.js";
import { upsertSource } from "./sources.js";

/**
 * Milestone 1 walking-skeleton data. OVERVIEW.md's roadmap is explicit that
 * this milestone runs on "seeded fake data, no live source yet" — these
 * events are fictional by design, not a stand-in for a real UVA source. The
 * `SEED_SOURCE_SLUG` and every organization name below are invented and
 * distinct from anything in the real Hoos Involved fixture, so seed data is
 * never mistaken for a verified import.
 */
export const SEED_SOURCE_SLUG = "seed-demo";

interface SeedEvent {
  title: string;
  descriptionHtml: string;
  organizationName: string;
  venueName: string;
  geo: { lat: number; lng: number } | null;
  categories: string[];
  costText: string | null;
  hoursFromNow: number;
  durationHours: number;
  isAllDay?: boolean;
  startTimeUnknown?: boolean;
}

const START_TZ = "America/New_York";

// Offsets are relative to seed time, so re-seeding always produces a mix of
// past (excluded by default per OVERVIEW.md section 6), in-progress, and
// upcoming events without hand-maintained absolute dates going stale.
const SEED_EVENTS: SeedEvent[] = [
  {
    title: "Sample: Trivia Night",
    descriptionHtml:
      "<p>Weekly trivia with prizes for the top three teams. All majors welcome, no team required in advance.</p>",
    organizationName: "Blue Ridge Trivia Club",
    venueName: "Newcomb Hall Ballroom",
    geo: { lat: 38.0359, lng: -78.5106 },
    categories: ["Social"],
    costText: "Free",
    hoursFromNow: -30, // past, to exercise the "excluded by default" rule
    durationHours: 2,
  },
  {
    title: "Sample: Morning Trail Run",
    descriptionHtml: "<p>Easy-paced group run along the Rivanna Trail. Meet at the trailhead.</p>",
    organizationName: "Blue Ridge Hiking Club",
    venueName: "Riverview Park",
    geo: { lat: 38.0447, lng: -78.4703 },
    categories: ["Athletic", "Social"],
    costText: "Free",
    hoursFromNow: 3,
    durationHours: 1,
  },
  {
    title: "Sample: Chai & Crafts",
    // 6pm to 3am the next UTC day — the same crosses-UTC-midnight shape as
    // the real Hoos Involved fixture, so the walking skeleton exercises the
    // exact overlapsDay() case ADR-0001's addendum documents.
    descriptionHtml: "<p>Drop-in crafting session with tea and snacks provided.</p>",
    organizationName: "Multicultural Student Collective",
    venueName: "Community Student Center",
    geo: { lat: 38.0335, lng: -78.5083 },
    categories: ["Cultural", "Social"],
    costText: "Free",
    hoursFromNow: 6,
    durationHours: 2,
  },
  {
    title: "Sample: Intro to Data Science Workshop",
    descriptionHtml:
      "<p>Hands-on workshop covering pandas basics. Bring a laptop; no prior experience needed.</p>" +
      '<p>Questions? See our <a href="https://example.org/data-science-club">club page</a>.</p>',
    organizationName: "Student Data Science Club",
    venueName: "Rice Hall, Room 130",
    geo: null,
    categories: ["Academic/Educational", "Workshop"],
    costText: "Free",
    hoursFromNow: 20,
    durationHours: 2,
  },
  {
    title: "Sample: Founders' Day Fair",
    descriptionHtml:
      "<p>All-day fair on the lawn with student org tables, food trucks, and music.</p>",
    organizationName: "Student Council",
    venueName: "The Lawn",
    geo: { lat: 38.0357, lng: -78.5036 },
    categories: ["Fundraiser", "Social"],
    costText: "Free",
    hoursFromNow: 30,
    durationHours: 8,
    isAllDay: true,
  },
  {
    title: "Sample: Club Council General Meeting",
    descriptionHtml: "<p>Monthly meeting open to all recognized club officers and members.</p>",
    organizationName: "Interclub Council",
    venueName: "Newcomb Hall, Room 389",
    geo: null,
    categories: ["Meeting", "Leadership"],
    costText: null,
    hoursFromNow: 48,
    durationHours: 1,
  },
  {
    title: "Sample: A Cappella Fall Showcase",
    descriptionHtml:
      "<p>Featuring three student a cappella groups. Doors open thirty minutes early.</p>",
    organizationName: "Old Cabell Performance Series",
    venueName: "Old Cabell Hall",
    geo: { lat: 38.0339, lng: -78.5057 },
    categories: ["Performance", "Arts"],
    costText: "$5 at the door",
    hoursFromNow: 72,
    durationHours: 2,
  },
  {
    title: "Sample: Community Garden Volunteer Morning",
    descriptionHtml:
      "<p>Help with fall planting. Gloves and tools provided; wear clothes you don't mind getting dirty.</p>",
    organizationName: "Campus Community Partnerships",
    venueName: "North Grounds Community Garden",
    geo: { lat: 38.0507, lng: -78.5145 },
    categories: ["CommunityService", "Service"],
    costText: "Free",
    hoursFromNow: 96,
    durationHours: 3,
  },
  {
    title: "Sample: Public Speaking Practice Circle",
    descriptionHtml:
      "<p>Low-pressure weekly practice for anyone working on interview or presentation skills.</p>",
    organizationName: "The Rotunda Speaking Society",
    venueName: "Rotunda, Lower West Oval Room",
    geo: null,
    categories: ["ThoughtfulLearning", "Leadership"],
    costText: null,
    hoursFromNow: 120,
    durationHours: 1,
    startTimeUnknown: true,
  },
  {
    title: "Sample: Interfaith Dinner & Discussion",
    descriptionHtml:
      "<p>Shared dinner followed by a facilitated conversation. All backgrounds welcome.</p>",
    organizationName: "Interfaith Student Collective",
    venueName: "Interfaith Student Center",
    geo: { lat: 38.0338, lng: -78.5115 },
    categories: ["Spirituality", "Cultural"],
    costText: "Free",
    hoursFromNow: 150,
    durationHours: 2,
  },
  {
    title: "Sample: Intramural Soccer Semifinal",
    descriptionHtml: "<p>Come cheer on the semifinal match. Concessions available.</p>",
    organizationName: "Club Sports Council",
    venueName: "North Grounds Recreation Fields",
    geo: { lat: 38.0508, lng: -78.5138 },
    categories: ["Athletics"],
    costText: "Free",
    hoursFromNow: 190,
    durationHours: 2,
  },
  {
    title: "Sample: Winter Fundraiser Bake Sale",
    descriptionHtml: "<p>All proceeds go to the campus emergency fund. Cash and card accepted.</p>",
    organizationName: "Student Council",
    venueName: "Newcomb Hall Plaza",
    geo: { lat: 38.036, lng: -78.5104 },
    categories: ["Fundraiser"],
    costText: "Pay what you can",
    hoursFromNow: 240,
    durationHours: 4,
  },
];

function toUtc(hoursFromNow: number, base: Date): Date {
  return new Date(base.getTime() + hoursFromNow * 60 * 60 * 1000);
}

export async function seed(): Promise<{ sourceId: string; inserted: number }> {
  const pool = getPool();
  const now = new Date();

  const source = await upsertSource(pool, {
    slug: SEED_SOURCE_SLUG,
    name: "Seed data (walking skeleton)",
    method: "seed",
    feedUrl: null,
  });

  await pool.query("DELETE FROM events WHERE source_id = $1", [source.id]);

  let inserted = 0;
  for (const [index, seedEvent] of SEED_EVENTS.entries()) {
    const startAt = toUtc(seedEvent.hoursFromNow, now);
    const endAt = toUtc(seedEvent.hoursFromNow + seedEvent.durationHours, now);
    const sourceUid = `seed-${index}`;

    await pool.query(
      `INSERT INTO events (
         source_id, source_uid, title, description_html,
         start_at, end_at, start_tz, is_all_day, start_time_unknown,
         venue_name, geo_lat, geo_lng, organization_name, categories,
         cost_text, source_url, source_published_at, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'active')
       ON CONFLICT (source_id, source_uid, occurrence_start) WHERE source_uid IS NOT NULL
       DO UPDATE SET
         title = EXCLUDED.title,
         description_html = EXCLUDED.description_html,
         start_at = EXCLUDED.start_at,
         end_at = EXCLUDED.end_at,
         last_seen_at = now(),
         last_synced_at = now()`,
      [
        source.id,
        sourceUid,
        seedEvent.title,
        sanitizeEventDescription(seedEvent.descriptionHtml),
        startAt,
        endAt,
        START_TZ,
        seedEvent.isAllDay ?? false,
        seedEvent.startTimeUnknown ?? false,
        seedEvent.venueName,
        seedEvent.geo?.lat ?? null,
        seedEvent.geo?.lng ?? null,
        seedEvent.organizationName,
        seedEvent.categories,
        seedEvent.costText,
        `https://example.org/events/seed-${index}`,
        now,
      ],
    );
    inserted += 1;
  }

  return { sourceId: source.id, inserted };
}

async function main(): Promise<void> {
  // Only the CLI entry point loads .env — seed() itself is also called by
  // the worker and by tests, both of which already have DATABASE_URL set by
  // other means (the process environment, or vitest.setup.ts), and forcing
  // a dotenv load on every import would make it too easy to silently pick up
  // the wrong .env file in those contexts.
  const { config } = await import("dotenv");
  config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

  const result = await seed();
  console.log(`Seeded ${result.inserted} events under source ${result.sourceId}`);
  const { closePool } = await import("./pool.js");
  await closePool();
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
