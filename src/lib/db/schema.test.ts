// Integration tests for the constraints the data model depends on. These
// assert database behavior, not TypeScript types — a constraint that only
// exists in the schema file is not a guarantee.

import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, sqlClient } from "@/lib/db";
import { ingestionRuns, sourceEvents, sources } from "@/lib/db/schema";
import { expectConstraintViolation } from "@/test/db-errors";

const TEST_SOURCE = "test-schema-source";

async function cleanup() {
  await db.execute(sql`DELETE FROM sources WHERE id = ${TEST_SOURCE}`);
}

async function createTestSource(overrides: Record<string, unknown> = {}) {
  return db
    .insert(sources)
    .values({
      id: TEST_SOURCE,
      displayName: "Test source",
      owner: "test",
      homepageUrl: "https://example.invalid",
      method: "ics",
      termsReviewedAt: new Date(),
      enabled: true,
      ...overrides,
    })
    .returning({ id: sources.id });
}

function eventValues(key: string, overrides: Record<string, unknown> = {}) {
  return {
    sourceId: TEST_SOURCE,
    sourceEventKey: key,
    canonicalUrl: `https://example.invalid/${key}`,
    title: "Test event",
    startsAt: new Date("2030-01-01T15:00:00Z"),
    timezone: "America/New_York",
    contentHash: "hash",
    ...overrides,
  };
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("idempotent import", () => {
  it("rejects a second event with the same (source_id, source_event_key)", async () => {
    await createTestSource();
    await db.insert(sourceEvents).values(eventValues("dup-key"));

    await expectConstraintViolation(
      db.insert(sourceEvents).values(eventValues("dup-key")),
      "idempotent_import",
    );
  });

  it("allows the same key from a different source", async () => {
    await createTestSource();
    await db.insert(sourceEvents).values(eventValues("shared-key"));

    await db.insert(sources).values({
      id: `${TEST_SOURCE}-2`,
      displayName: "Second test source",
      owner: "test",
      homepageUrl: "https://example.invalid/2",
      method: "ics",
      termsReviewedAt: new Date(),
    });

    await expect(
      db
        .insert(sourceEvents)
        .values(eventValues("shared-key", { sourceId: `${TEST_SOURCE}-2` })),
    ).resolves.toBeDefined();

    await db.execute(sql`DELETE FROM sources WHERE id = ${`${TEST_SOURCE}-2`}`);
  });
});

describe("source policy constraints", () => {
  it("refuses to enable a source with no recorded terms review", async () => {
    await expectConstraintViolation(
      createTestSource({ enabled: true, termsReviewedAt: null }),
      "enabled_requires_terms_review",
    );
  });

  it("allows a disabled source with no terms review", async () => {
    await expect(
      createTestSource({ enabled: false, termsReviewedAt: null }),
    ).resolves.toBeDefined();
  });
});

describe("event integrity constraints", () => {
  it("rejects an end time before the start time", async () => {
    await createTestSource();
    await expectConstraintViolation(
      db.insert(sourceEvents).values(
        eventValues("bad-times", {
          startsAt: new Date("2030-01-01T15:00:00Z"),
          endsAt: new Date("2030-01-01T14:00:00Z"),
        }),
      ),
      "ends_after_starts",
    );
  });

  it("rejects a latitude without a longitude", async () => {
    await createTestSource();
    await expectConstraintViolation(
      db.insert(sourceEvents).values(eventValues("half-coords", { latitude: "38.03" })),
      "coords_together",
    );
  });
});

describe("generated search vector", () => {
  it("populates and weights search_vector without application writes", async () => {
    await createTestSource();
    await db.insert(sourceEvents).values(
      eventValues("search-me", {
        title: "Astronomy Lecture",
        description: "A talk about telescopes",
        venueName: "Rice Hall",
      }),
    );

    const rows = await db.execute<{ search_vector: string }>(
      sql`SELECT search_vector::text FROM source_events
          WHERE source_event_key = 'search-me'`,
    );

    // Title terms carry weight A, venue B, description C.
    expect(rows[0]!.search_vector).toMatch(/'astronomi':\d+A/);
    expect(rows[0]!.search_vector).toMatch(/'rice':\d+B/);
    expect(rows[0]!.search_vector).toMatch(/'telescop':\d+C/);
  });
});

describe("ingestion run lifecycle", () => {
  it("rejects a finished run with no finished_at", async () => {
    await createTestSource();
    const [run] = await db
      .insert(ingestionRuns)
      .values({ sourceId: TEST_SOURCE })
      .returning({ id: ingestionRuns.id });

    await expectConstraintViolation(
      db.execute(
        sql`UPDATE ingestion_runs SET status = 'succeeded'
            WHERE id = ${run!.id}`,
      ),
      "finished_runs_have_end",
    );
  });
});
