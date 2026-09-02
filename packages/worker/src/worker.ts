import {
  claimNextRun,
  getPool,
  getSourceById,
  markRunFailed,
  markRunSucceeded,
} from "@hoosradar/db";
import { config } from "dotenv";
import type { Pool } from "pg";
import pino from "pino";
import { processSource } from "./processors.js";
import { enqueueDueRuns } from "./scheduler.js";

// Safe to load unconditionally: dotenv never overrides an already-set
// variable, and in tests vitest.setup.ts already set DATABASE_URL from
// .env.test before this module is imported, so this line is a no-op there.
// It only matters for the CLI path (`npm run dev:worker` / `node
// dist/worker.js`), which has no other route to .env.
config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

const log = pino(
  process.env.NODE_ENV === "test"
    ? { enabled: false }
    : process.env.NODE_ENV === "production"
      ? {}
      : { transport: { target: "pino-pretty" } },
);

/**
 * One poll tick: enqueue any due runs, then claim and process at most one.
 * Every log line carries the run id, per OVERVIEW.md section 8's "traceable
 * run identifier" — that is what makes one run's logs findable later.
 */
export async function tick(pool: Pool): Promise<{ claimedRunId: string | null }> {
  const enqueued = await enqueueDueRuns(pool);
  if (enqueued > 0) {
    log.info({ enqueued }, "enqueued due runs");
  }

  const client = await pool.connect();
  let claimed: Awaited<ReturnType<typeof claimNextRun>>;
  try {
    await client.query("BEGIN");
    claimed = await claimNextRun(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (!claimed) {
    return { claimedRunId: null };
  }

  const runId = claimed.id;
  const source = await getSourceById(pool, claimed.sourceId);
  if (!source) {
    await markRunFailed(pool, runId, `Source ${claimed.sourceId} no longer exists`);
    log.error({ runId }, "run failed: source not found");
    return { claimedRunId: runId };
  }

  log.info({ runId, source: source.slug }, "run started");
  try {
    const result = await processSource(source);
    await markRunSucceeded(pool, runId, result);
    log.info({ runId, source: source.slug, ...result }, "run succeeded");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markRunFailed(pool, runId, message);
    log.error({ runId, source: source.slug, error: message }, "run failed");
  }

  return { claimedRunId: runId };
}

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 5000);

async function main(): Promise<void> {
  const pool = getPool();
  log.info({ pollIntervalMs: POLL_INTERVAL_MS }, "worker starting");

  const loop = async () => {
    try {
      await tick(pool);
    } catch (error) {
      log.error({ err: error }, "poll tick failed");
    } finally {
      setTimeout(loop, POLL_INTERVAL_MS);
    }
  };

  await loop();
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main().catch((error: unknown) => {
    log.error({ err: error }, "worker crashed");
    process.exitCode = 1;
  });
}
