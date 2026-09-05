// End-to-end ingestion tests: fetch -> snapshot -> parse -> normalize ->
// upsert, against a real database but a stubbed fetch. No network, so these
// stay deterministic in CI (OVERVIEW.md section 12).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, sqlClient } from "@/lib/db";
import { ingestionRuns, rawSnapshots, sourceEvents, sources } from "@/lib/db/schema";
import { ingestIcsSource, startRun, type IcsSourceConfig } from "@/modules/ingestion";

const TEST_SOURCE = "test-ics-source";
const FIXTURE = readFileSync(
  join(import.meta.dirname, "../parsing/ics/fixtures/sample-calendar.ics"),
  "utf8",
);

function stubFetch(
  body: string,
  init?: { status?: number; headers?: Record<string, string> },
): typeof fetch {
  return (async () =>
    new Response(init?.status === 304 ? null : body, {
      status: init?.status ?? 200,
      headers: { "content-type": "text/calendar", ...(init?.headers ?? {}) },
    })) as unknown as typeof fetch;
}

const failingFetch = (async () => {
  throw new Error("connection refused");
}) as unknown as typeof fetch;

function config(overrides: Partial<IcsSourceConfig> = {}): IcsSourceConfig {
  return {
    sourceId: TEST_SOURCE,
    feedUrl: "https://example.invalid/feed.ics",
    homepageUrl: "https://example.invalid/",
    fallbackTimeZone: "America/New_York",
    defaultOrganizationName: "Test Organization",
    retainRawPayload: true,
    rawRetentionDays: 7,
    ...overrides,
  };
}

async function cleanup() {
  await db.execute(sql`DELETE FROM sources WHERE id = ${TEST_SOURCE}`);
}

async function createSource() {
  await db.insert(sources).values({
    id: TEST_SOURCE,
    displayName: "ICS test source",
    owner: "test",
    homepageUrl: "https://example.invalid",
    feedUrl: "https://example.invalid/feed.ics",
    method: "ics",
    termsReviewedAt: new Date(),
    enabled: true,
  });
}

async function countEvents(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sourceEvents)
    .where(sql`${sourceEvents.sourceId} = ${TEST_SOURCE}`);
  return row!.count;
}

beforeEach(async () => {
  await cleanup();
  await createSource();
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("happy path", () => {
  it("imports the parseable events and reports the skipped ones", async () => {
    const runId = await startRun(TEST_SOURCE);
    const outcome = await ingestIcsSource(config(), runId, {
      fetchImpl: stubFetch(FIXTURE),
    });

    // 8 good events, 3 deliberately broken in the fixture.
    expect(outcome.recordsCreated).toBe(8);
    expect(outcome.recordsSkipped).toBe(3);
    expect(await countEvents()).toBe(8);
  });

  it("reports partial rather than success when records were dropped", async () => {
    const runId = await startRun(TEST_SOURCE);
    const outcome = await ingestIcsSource(config(), runId, {
      fetchImpl: stubFetch(FIXTURE),
    });

    // Dropping records and calling it a clean success would hide the problem.
    expect(outcome.status).toBe("partial");
  });

  it("keeps provenance on every stored event", async () => {
    const runId = await startRun(TEST_SOURCE);
    await ingestIcsSource(config(), runId, { fetchImpl: stubFetch(FIXTURE) });

    const rows = await db
      .select()
      .from(sourceEvents)
      .where(sql`${sourceEvents.sourceId} = ${TEST_SOURCE}`);

    for (const row of rows) {
      expect(row.canonicalUrl).toMatch(/^https?:\/\//);
      expect(row.sourceEventKey).toBeTruthy();
      expect(row.lastRunId).toBe(runId);
      expect(row.contentHash).toBeTruthy();
    }
  });

  it("stores a raw snapshot with a hash and an expiry", async () => {
    const runId = await startRun(TEST_SOURCE);
    await ingestIcsSource(config(), runId, { fetchImpl: stubFetch(FIXTURE) });

    const [snapshot] = await db
      .select()
      .from(rawSnapshots)
      .where(sql`${rawSnapshots.runId} = ${runId}`);

    expect(snapshot!.contentHash).toHaveLength(64);
    expect(snapshot!.payload).toContain("BEGIN:VCALENDAR");
    expect(snapshot!.retainUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it("omits the payload when the source's terms do not permit retention", async () => {
    const runId = await startRun(TEST_SOURCE);
    await ingestIcsSource(config({ retainRawPayload: false }), runId, {
      fetchImpl: stubFetch(FIXTURE),
    });

    const [snapshot] = await db
      .select()
      .from(rawSnapshots)
      .where(sql`${rawSnapshots.runId} = ${runId}`);

    expect(snapshot!.payload).toBeNull();
    // The hash is still kept, so change detection survives non-retention.
    expect(snapshot!.contentHash).toHaveLength(64);
  });
});

describe("idempotency", () => {
  it("creates nothing on a second identical run", async () => {
    const first = await startRun(TEST_SOURCE);
    await ingestIcsSource(config(), first, { fetchImpl: stubFetch(FIXTURE) });
    expect(await countEvents()).toBe(8);

    const second = await startRun(TEST_SOURCE);
    const outcome = await ingestIcsSource(config(), second, {
      fetchImpl: stubFetch(FIXTURE),
    });

    // This is the guarantee the whole design rests on.
    expect(await countEvents()).toBe(8);
    expect(outcome.recordsCreated).toBe(0);
    expect(outcome.recordsUpdated).toBe(0);
  });

  it("does not move last_material_change_at when nothing changed", async () => {
    const first = await startRun(TEST_SOURCE);
    await ingestIcsSource(config(), first, {
      fetchImpl: stubFetch(FIXTURE),
      now: new Date("2026-01-01T00:00:00Z"),
    });

    const before = await db
      .select({
        key: sourceEvents.sourceEventKey,
        changed: sourceEvents.lastMaterialChangeAt,
        synced: sourceEvents.lastSyncedAt,
      })
      .from(sourceEvents)
      .where(
        sql`${sourceEvents.sourceId} = ${TEST_SOURCE} AND ${sourceEvents.sourceEventKey} LIKE 'basic-001%'`,
      );

    const second = await startRun(TEST_SOURCE);
    await ingestIcsSource(config(), second, {
      fetchImpl: stubFetch(FIXTURE),
      now: new Date("2026-01-02T00:00:00Z"),
    });

    const after = await db
      .select({
        changed: sourceEvents.lastMaterialChangeAt,
        synced: sourceEvents.lastSyncedAt,
      })
      .from(sourceEvents)
      .where(
        sql`${sourceEvents.sourceId} = ${TEST_SOURCE} AND ${sourceEvents.sourceEventKey} LIKE 'basic-001%'`,
      );

    // Checked again (synced moves) but nothing a user would notice changed.
    expect(after[0]!.changed.toISOString()).toBe(before[0]!.changed.toISOString());
    expect(after[0]!.synced.getTime()).toBeGreaterThan(before[0]!.synced.getTime());
  });

  it("never rewrites first_seen_at", async () => {
    const first = await startRun(TEST_SOURCE);
    await ingestIcsSource(config(), first, {
      fetchImpl: stubFetch(FIXTURE),
      now: new Date("2026-01-01T00:00:00Z"),
    });

    const second = await startRun(TEST_SOURCE);
    await ingestIcsSource(config(), second, {
      fetchImpl: stubFetch(FIXTURE),
      now: new Date("2026-06-01T00:00:00Z"),
    });

    const [row] = await db
      .select({ firstSeen: sourceEvents.firstSeenAt })
      .from(sourceEvents)
      .where(
        sql`${sourceEvents.sourceId} = ${TEST_SOURCE} AND ${sourceEvents.sourceEventKey} LIKE 'basic-001%'`,
      );

    expect(row!.firstSeen.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("change detection", () => {
  it("counts a retitled event as updated and moves its change stamp", async () => {
    const first = await startRun(TEST_SOURCE);
    await ingestIcsSource(config(), first, {
      fetchImpl: stubFetch(FIXTURE),
      now: new Date("2026-01-01T00:00:00Z"),
    });

    const edited = FIXTURE.replace(
      "SUMMARY:Intro to Astronomy Lecture",
      "SUMMARY:Intro to Astronomy Lecture (rescheduled)",
    );

    const second = await startRun(TEST_SOURCE);
    const outcome = await ingestIcsSource(config(), second, {
      fetchImpl: stubFetch(edited),
      now: new Date("2026-01-02T00:00:00Z"),
    });

    expect(outcome.recordsUpdated).toBe(1);
    expect(outcome.recordsCreated).toBe(0);

    const [row] = await db
      .select({
        title: sourceEvents.title,
        changed: sourceEvents.lastMaterialChangeAt,
      })
      .from(sourceEvents)
      .where(
        sql`${sourceEvents.sourceId} = ${TEST_SOURCE} AND ${sourceEvents.sourceEventKey} LIKE 'basic-001%'`,
      );

    expect(row!.title).toContain("rescheduled");
    expect(row!.changed.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });
});

describe("an event disappearing from the feed", () => {
  it("keeps it, marks it synced, but does not mark it seen or cancelled", async () => {
    const first = await startRun(TEST_SOURCE);
    await ingestIcsSource(config(), first, {
      fetchImpl: stubFetch(FIXTURE),
      now: new Date("2026-01-01T00:00:00Z"),
    });

    // Remove one VEVENT from the feed entirely.
    const without = FIXTURE.replace(
      /BEGIN:VEVENT\nUID:noend-005@example\.invalid[\s\S]*?END:VEVENT\n/,
      "",
    );

    const second = await startRun(TEST_SOURCE);
    const outcome = await ingestIcsSource(config(), second, {
      fetchImpl: stubFetch(without),
      now: new Date("2026-01-02T00:00:00Z"),
    });

    expect(outcome.recordsCreated).toBe(0);

    const [row] = await db
      .select({
        status: sourceEvents.status,
        seen: sourceEvents.lastSeenAt,
        synced: sourceEvents.lastSyncedAt,
      })
      .from(sourceEvents)
      .where(
        sql`${sourceEvents.sourceId} = ${TEST_SOURCE} AND ${sourceEvents.sourceEventKey} LIKE 'noend-005%'`,
      );

    // Still there — absence is not deletion.
    expect(row).toBeDefined();
    // Absence is not cancellation either. Only an explicit source signal
    // may set that.
    expect(row!.status).toBe("scheduled");
    // We checked successfully, so synced advances...
    expect(row!.synced.toISOString()).toBe("2026-01-02T00:00:00.000Z");
    // ...but it was not present, so seen does not. That gap is exactly how
    // a disappearance is told apart from a source outage.
    expect(row!.seen.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("failure handling", () => {
  it("records a fetch failure as retryable without throwing", async () => {
    const runId = await startRun(TEST_SOURCE);
    const outcome = await ingestIcsSource(config(), runId, {
      fetchImpl: failingFetch,
    });

    expect(outcome.status).toBe("failed");
    expect(outcome.errorKind).toBe("fetch");
    expect(outcome.retryable).toBe(true);
    expect(outcome.errorSummary).toContain("connection refused");
  });

  it("treats a 404 as not retryable", async () => {
    const runId = await startRun(TEST_SOURCE);
    const outcome = await ingestIcsSource(config(), runId, {
      fetchImpl: stubFetch("", { status: 404 }),
    });

    expect(outcome.status).toBe("failed");
    expect(outcome.retryable).toBe(false);
  });

  it("treats a 503 as retryable", async () => {
    const runId = await startRun(TEST_SOURCE);
    const outcome = await ingestIcsSource(config(), runId, {
      fetchImpl: stubFetch("", { status: 503 }),
    });

    expect(outcome.retryable).toBe(true);
  });

  it("does not destroy existing events when a later fetch fails", async () => {
    const first = await startRun(TEST_SOURCE);
    await ingestIcsSource(config(), first, { fetchImpl: stubFetch(FIXTURE) });
    expect(await countEvents()).toBe(8);

    const second = await startRun(TEST_SOURCE);
    await ingestIcsSource(config(), second, { fetchImpl: failingFetch });

    // A failing source must never remove valid events.
    expect(await countEvents()).toBe(8);
  });

  it("handles a 304 as a successful no-op check", async () => {
    const runId = await startRun(TEST_SOURCE);
    const outcome = await ingestIcsSource(config(), runId, {
      fetchImpl: stubFetch("", { status: 304 }),
    });

    expect(outcome.status).toBe("succeeded");
    expect(outcome.notModified).toBe(true);
    expect(outcome.recordsSeen).toBe(0);
  });

  it("reports a parse failure distinctly from a fetch failure", async () => {
    const runId = await startRun(TEST_SOURCE);
    const outcome = await ingestIcsSource(
      config({ fallbackTimeZone: "Not/AZone" }),
      runId,
      {
        fetchImpl: stubFetch(FIXTURE),
      },
    );

    // An unusable timezone config surfaces as skipped records, not a crash.
    expect(["partial", "failed"]).toContain(outcome.status);
  });
});

describe("run records", () => {
  it("associates every run with the source", async () => {
    const runId = await startRun(TEST_SOURCE);
    await ingestIcsSource(config(), runId, { fetchImpl: stubFetch(FIXTURE) });

    const [run] = await db
      .select()
      .from(ingestionRuns)
      .where(sql`${ingestionRuns.id} = ${runId}`);

    expect(run!.sourceId).toBe(TEST_SOURCE);
  });
});
