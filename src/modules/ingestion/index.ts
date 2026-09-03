// Ingestion run lifecycle and source claiming (ADR 0004).
//
// No fetching happens yet — Milestone 1 is the walking skeleton, and a live
// source is Milestone 2. What exists here is the part that has to be correct
// before any source is added: claiming without double-work, recording every
// run with a traceable ID, and making a failing handler visible instead of
// silent.

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { ingestionRuns } from "@/lib/db/schema";
import { logger } from "@/lib/log";

export type ClaimedSource = {
  id: string;
  displayName: string;
  intervalSeconds: number;
};

// Claim due sources atomically. SKIP LOCKED means a second worker takes the
// next row rather than blocking or duplicating work, so scaling out later
// needs no new infrastructure.
export async function claimDueSources(limit = 5): Promise<ClaimedSource[]> {
  const rows = await db.execute<{
    id: string;
    display_name: string;
    interval_seconds: number;
  }>(sql`
    WITH due AS (
      SELECT id
      FROM sources
      WHERE enabled AND next_run_at <= now()
      ORDER BY next_run_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE sources s
    SET next_run_at = now() + make_interval(secs => s.interval_seconds)
    FROM due
    WHERE s.id = due.id
    RETURNING s.id, s.display_name, s.interval_seconds
  `);

  return rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    intervalSeconds: row.interval_seconds,
  }));
}

export async function startRun(sourceId: string): Promise<string> {
  const [row] = await db
    .insert(ingestionRuns)
    .values({ sourceId, status: "running" })
    .returning({ id: ingestionRuns.id });
  return row!.id;
}

export type RunOutcome = {
  status: "succeeded" | "partial" | "failed";
  recordsSeen?: number;
  recordsCreated?: number;
  recordsUpdated?: number;
  recordsSkipped?: number;
  recordsFailed?: number;
  errorKind?: string;
  errorSummary?: string;
};

export async function finishRun(runId: string, outcome: RunOutcome): Promise<void> {
  await db
    .update(ingestionRuns)
    .set({
      status: outcome.status,
      finishedAt: new Date(),
      recordsSeen: outcome.recordsSeen ?? 0,
      recordsCreated: outcome.recordsCreated ?? 0,
      recordsUpdated: outcome.recordsUpdated ?? 0,
      recordsSkipped: outcome.recordsSkipped ?? 0,
      recordsFailed: outcome.recordsFailed ?? 0,
      errorKind: outcome.errorKind ?? null,
      errorSummary: outcome.errorSummary ?? null,
    })
    .where(sql`${ingestionRuns.id} = ${runId}`);
}

export type SourceHandler = (source: ClaimedSource, runId: string) => Promise<RunOutcome>;

// Placeholder until Milestone 2 adds a real source. Records a successful
// run that processed nothing, which is honest rather than pretending work
// happened.
const noopHandler: SourceHandler = async () => ({
  status: "succeeded",
  recordsSeen: 0,
});

export async function processSource(
  source: ClaimedSource,
  handler: SourceHandler = noopHandler,
): Promise<void> {
  const runId = await startRun(source.id);
  const runLogger = logger.withContext({ run_id: runId, source_id: source.id });
  runLogger.info("ingestion run started");

  try {
    const outcome = await handler(source, runId);
    await finishRun(runId, outcome);
    runLogger.info("ingestion run finished", { status: outcome.status });
  } catch (error: unknown) {
    // A failing handler marks the run failed and is logged — it must never
    // take down the loop or fail invisibly (CLAUDE.md: no silent failures).
    const message = error instanceof Error ? error.message : String(error);
    await finishRun(runId, {
      status: "failed",
      errorKind: "handler",
      errorSummary: message,
    });
    runLogger.error("ingestion run failed", { error: message });
  }
}
