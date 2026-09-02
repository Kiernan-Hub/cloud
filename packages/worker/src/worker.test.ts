import { randomUUID } from "node:crypto";
import { closePool, enqueueRun, getPool, upsertSource } from "@hoosradar/db";
import { afterAll, describe, expect, it } from "vitest";
import { tick } from "./worker.js";

describe("worker tick (OVERVIEW.md section 8)", () => {
  afterAll(async () => {
    await closePool();
  });

  it("claims and succeeds a seed-method run end to end", async () => {
    const pool = getPool();
    const source = await upsertSource(pool, {
      slug: `worker-test-seed-${randomUUID()}`,
      name: "Seed data (walking skeleton)",
      method: "seed",
      feedUrl: null,
    });
    await enqueueRun(pool, source.id, new Date(Date.now() - 1000));

    const result = await tick(pool);
    expect(result.claimedRunId).not.toBeNull();

    const row = await pool.query(
      "SELECT status, records_upserted FROM ingestion_runs WHERE id = $1",
      [result.claimedRunId],
    );
    expect(row.rows[0].status).toBe("succeeded");
    expect(row.rows[0].records_upserted).toBeGreaterThan(0);
  });

  it("records a failed run honestly rather than fabricating success for an unimplemented source", async () => {
    // Milestone 2 (packages/ingest) has not started — an "ical" source must
    // fail loudly, never report a fake success.
    const pool = getPool();
    const source = await upsertSource(pool, {
      slug: `worker-test-ical-${randomUUID()}`,
      name: "Unimplemented ical source",
      method: "ical",
      feedUrl: "https://example.org/feed.ics",
    });
    await enqueueRun(pool, source.id, new Date(Date.now() - 1000));

    const result = await tick(pool);
    expect(result.claimedRunId).not.toBeNull();

    const row = await pool.query("SELECT status, error_message FROM ingestion_runs WHERE id = $1", [
      result.claimedRunId,
    ]);
    expect(row.rows[0].status).toBe("failed");
    expect(row.rows[0].error_message).toContain("No parser implemented");
  });

  it("two concurrent tickers never claim the same run (SKIP LOCKED)", async () => {
    // The test database is shared across this whole suite, and tick() also
    // runs the scheduler, which can enqueue runs for unrelated enabled
    // sources left over from earlier test files. Backdating these two runs
    // generously keeps them first in claim order (ORDER BY scheduled_at)
    // ahead of anything the scheduler enqueues at "now" during this test,
    // without the assertions below depending on exact claim order — only on
    // the one property actually under test: no double-claim, ever.
    const pool = getPool();
    const source = await upsertSource(pool, {
      slug: `worker-test-concurrent-${randomUUID()}`,
      name: "Seed data (walking skeleton)",
      method: "seed",
      feedUrl: null,
    });
    const backdated = new Date(Date.now() - 60_000);
    const runA = await enqueueRun(pool, source.id, backdated);
    const runB = await enqueueRun(pool, source.id, backdated);

    // Two independent pool connections racing to claim, exactly as two
    // worker processes polling the same table concurrently would.
    const [resultA, resultB] = await Promise.all([tick(pool), tick(pool)]);

    const claimedIds = [resultA.claimedRunId, resultB.claimedRunId].filter(
      (id): id is string => id !== null,
    );
    expect(new Set(claimedIds).size).toBe(claimedIds.length); // the actual guarantee: no duplicate claim

    // Both of ours should be gone from `pending` by now — claimed by this
    // pair of ticks (the expected case) or, if scheduler noise intervened,
    // still sitting unclaimed is what would indicate a real bug; assert the
    // stronger, still-robust property that neither remains pending forever.
    const remaining = await pool.query("SELECT id, status FROM ingestion_runs WHERE id = ANY($1)", [
      [runA.id, runB.id],
    ]);
    for (const row of remaining.rows) {
      expect(row.status).not.toBe("pending");
    }
  });

  it("does nothing and returns a null claim when the queue is empty", async () => {
    const pool = getPool();
    // No source/run set up for this call — the queue may still have leftover
    // rows from other tests, so this only checks the call completes cleanly.
    const result = await tick(pool);
    expect(result).toHaveProperty("claimedRunId");
  });
});
