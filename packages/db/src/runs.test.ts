import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closePool, getPool } from "./pool.js";
import { claimNextRun, enqueueRun, markRunFailed, markRunSucceeded } from "./runs.js";
import { upsertSource } from "./sources.js";

describe("ingestion run claiming (OVERVIEW.md section 8)", () => {
  afterAll(async () => {
    await closePool();
  });

  it("claims a pending run and moves it to running", async () => {
    // This database is shared across the whole suite, and other tests'
    // sources can leave their own due work behind (e.g. worker.test.ts's
    // scheduler re-enqueuing for a source between its ticks). Rather than
    // assume this test's row is next in claim order — a wall-clock race
    // against however many earlier files already ran — drain claims until
    // reaching it, disposing of anything unrelated exactly as a real worker
    // would. This is deterministic regardless of backlog size or ordering.
    const pool = getPool();
    const source = await upsertSource(pool, {
      slug: `test-source-${randomUUID()}`,
      name: "Claim test source",
      method: "seed",
      feedUrl: null,
    });
    const enqueued = await enqueueRun(pool, source.id, new Date(Date.now() - 1000));
    expect(enqueued.status).toBe("pending");

    let ownClaim: Awaited<ReturnType<typeof claimNextRun>> = null;
    for (let attempt = 0; attempt < 50 && !ownClaim; attempt++) {
      const client = await pool.connect();
      let claimed: Awaited<ReturnType<typeof claimNextRun>>;
      try {
        await client.query("BEGIN");
        claimed = await claimNextRun(client);
        await client.query("COMMIT");
      } finally {
        client.release();
      }

      expect(claimed).not.toBeNull(); // the backlog cannot run dry before reaching our own row

      if (claimed?.id === enqueued.id) {
        ownClaim = claimed;
      } else if (claimed) {
        await markRunSucceeded(pool, claimed.id, {
          recordsSeen: 0,
          recordsUpserted: 0,
          recordsFailed: 0,
        });
      }
    }

    expect(ownClaim?.id).toBe(enqueued.id);
    expect(ownClaim?.status).toBe("running");
    expect(ownClaim?.startedAt).not.toBeNull();
  });

  it("does not claim a run scheduled in the future", async () => {
    // This asserts against the specific row this test created, not that the
    // whole queue is empty: other sources created by other tests in this
    // shared database can legitimately have their own due work at the same
    // moment, and claimNextRun claiming one of those is correct behavior,
    // not a failure of this test's guarantee.
    const pool = getPool();
    const source = await upsertSource(pool, {
      slug: `test-source-${randomUUID()}`,
      name: "Future claim test source",
      method: "seed",
      feedUrl: null,
    });
    const futureRun = await enqueueRun(pool, source.id, new Date(Date.now() + 60 * 60 * 1000));

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const claimed = await claimNextRun(client);
      await client.query("COMMIT");
      expect(claimed?.id).not.toBe(futureRun.id);
    } finally {
      client.release();
    }

    const row = await pool.query("SELECT status FROM ingestion_runs WHERE id = $1", [futureRun.id]);
    expect(row.rows[0].status).toBe("pending");
  });

  it("marks a run succeeded with its counts", async () => {
    const pool = getPool();
    const source = await upsertSource(pool, {
      slug: `test-source-${randomUUID()}`,
      name: "Success test source",
      method: "seed",
      feedUrl: null,
    });
    const run = await enqueueRun(pool, source.id, new Date(Date.now() - 1000));
    await markRunSucceeded(pool, run.id, { recordsSeen: 10, recordsUpserted: 9, recordsFailed: 1 });

    const result = await pool.query("SELECT * FROM ingestion_runs WHERE id = $1", [run.id]);
    expect(result.rows[0].status).toBe("succeeded");
    expect(result.rows[0].records_upserted).toBe(9);
  });

  it("marks a run failed with an error message, leaving events untouched", async () => {
    // The event side of "a failed run must not touch consecutive_absences"
    // (ADR-0001 section 2) is exercised once packages/ingest exists; this
    // confirms the run bookkeeping half of that guarantee.
    const pool = getPool();
    const source = await upsertSource(pool, {
      slug: `test-source-${randomUUID()}`,
      name: "Failure test source",
      method: "seed",
      feedUrl: null,
    });
    const run = await enqueueRun(pool, source.id, new Date(Date.now() - 1000));
    await markRunFailed(pool, run.id, "feed returned 503");

    const result = await pool.query("SELECT * FROM ingestion_runs WHERE id = $1", [run.id]);
    expect(result.rows[0].status).toBe("failed");
    expect(result.rows[0].error_message).toBe("feed returned 503");
  });
});
