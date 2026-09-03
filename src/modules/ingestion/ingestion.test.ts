import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, sqlClient } from "@/lib/db";
import { ingestionRuns, sources } from "@/lib/db/schema";
import { claimDueSources, processSource } from "@/modules/ingestion";

const TEST_SOURCE = "test-ingestion-source";

async function cleanup() {
  await db.execute(sql`DELETE FROM sources WHERE id LIKE ${TEST_SOURCE + "%"}`);
}

async function createDueSource(id = TEST_SOURCE) {
  await db.insert(sources).values({
    id,
    displayName: "Ingestion test source",
    owner: "test",
    homepageUrl: "https://example.invalid",
    method: "ics",
    termsReviewedAt: new Date(),
    enabled: true,
    intervalSeconds: 3600,
    nextRunAt: new Date(Date.now() - 1000),
  });
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("claimDueSources", () => {
  it("claims a source whose next run is due", async () => {
    await createDueSource();
    const claimed = await claimDueSources();
    expect(claimed.map((s) => s.id)).toContain(TEST_SOURCE);
  });

  it("does not claim a disabled source", async () => {
    await createDueSource();
    await db.execute(sql`UPDATE sources SET enabled = false WHERE id = ${TEST_SOURCE}`);

    const claimed = await claimDueSources();
    expect(claimed.map((s) => s.id)).not.toContain(TEST_SOURCE);
  });

  it("does not claim a source that is not yet due", async () => {
    await createDueSource();
    await db.execute(
      sql`UPDATE sources SET next_run_at = now() + interval '1 hour'
          WHERE id = ${TEST_SOURCE}`,
    );

    const claimed = await claimDueSources();
    expect(claimed.map((s) => s.id)).not.toContain(TEST_SOURCE);
  });

  it("pushes next_run_at forward so the same source is not reclaimed", async () => {
    await createDueSource();
    await claimDueSources();

    const second = await claimDueSources();
    expect(second.map((s) => s.id)).not.toContain(TEST_SOURCE);
  });

  it("gives a due source to exactly one of two concurrent workers", async () => {
    await createDueSource();

    // The core SKIP LOCKED guarantee from ADR 0004: two workers racing must
    // not both process the same source.
    const [a, b] = await Promise.all([claimDueSources(), claimDueSources()]);

    const claims = [...a, ...b].filter((s) => s.id === TEST_SOURCE);
    expect(claims).toHaveLength(1);
  });
});

describe("processSource", () => {
  it("records a run with counts on success", async () => {
    await createDueSource();
    const [claimed] = await claimDueSources();

    await processSource(claimed!, async () => ({
      status: "succeeded",
      recordsSeen: 7,
      recordsCreated: 3,
    }));

    const runs = await db
      .select()
      .from(ingestionRuns)
      .where(sql`${ingestionRuns.sourceId} = ${TEST_SOURCE}`);

    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("succeeded");
    expect(runs[0]!.recordsSeen).toBe(7);
    expect(runs[0]!.recordsCreated).toBe(3);
    expect(runs[0]!.finishedAt).not.toBeNull();
  });

  it("marks a run failed when the handler throws, without rethrowing", async () => {
    await createDueSource();
    const [claimed] = await claimDueSources();

    // Must not reject: a bad source cannot be allowed to kill the worker loop.
    await expect(
      processSource(claimed!, async () => {
        throw new Error("source exploded");
      }),
    ).resolves.toBeUndefined();

    const runs = await db
      .select()
      .from(ingestionRuns)
      .where(sql`${ingestionRuns.sourceId} = ${TEST_SOURCE}`);

    expect(runs[0]!.status).toBe("failed");
    expect(runs[0]!.errorSummary).toContain("source exploded");
    expect(runs[0]!.finishedAt).not.toBeNull();
  });

  it("records a partial run so skipped records stay visible", async () => {
    await createDueSource();
    const [claimed] = await claimDueSources();

    await processSource(claimed!, async () => ({
      status: "partial",
      recordsSeen: 10,
      recordsSkipped: 2,
    }));

    const runs = await db
      .select()
      .from(ingestionRuns)
      .where(sql`${ingestionRuns.sourceId} = ${TEST_SOURCE}`);

    expect(runs[0]!.status).toBe("partial");
    expect(runs[0]!.recordsSkipped).toBe(2);
  });
});
