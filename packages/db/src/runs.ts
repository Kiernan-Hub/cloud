import type { IngestionRun } from "@hoosradar/core";
import type { Pool, PoolClient } from "pg";
import { type IngestionRunRow, rowToIngestionRun } from "./rows.js";

export async function enqueueRun(
  pool: Pool,
  sourceId: string,
  scheduledAt: Date = new Date(),
): Promise<IngestionRun> {
  const result = await pool.query<IngestionRunRow>(
    `INSERT INTO ingestion_runs (source_id, status, scheduled_at)
     VALUES ($1, 'pending', $2)
     RETURNING *`,
    [sourceId, scheduledAt],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(`Failed to enqueue run for source ${sourceId}`);
  }
  return rowToIngestionRun(row);
}

/**
 * Claims the oldest due `pending` run, moving it to `running`, using
 * `SELECT ... FOR UPDATE SKIP LOCKED` so multiple worker processes can poll
 * the same table concurrently without blocking each other or double-claiming
 * a row (OVERVIEW.md section 8). Must run inside a transaction the caller
 * commits once the claim is durable; returns `null` when nothing is due.
 */
export async function claimNextRun(client: PoolClient): Promise<IngestionRun | null> {
  const claimed = await client.query<IngestionRunRow>(
    `UPDATE ingestion_runs
     SET status = 'running', started_at = now()
     WHERE id = (
       SELECT id FROM ingestion_runs
       WHERE status = 'pending' AND scheduled_at <= now()
       ORDER BY scheduled_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING *`,
  );
  const row = claimed.rows[0];
  return row ? rowToIngestionRun(row) : null;
}

export async function markRunSucceeded(
  pool: Pool,
  runId: string,
  counts: { recordsSeen: number; recordsUpserted: number; recordsFailed: number },
): Promise<void> {
  await pool.query(
    `UPDATE ingestion_runs
     SET status = 'succeeded', finished_at = now(),
         records_seen = $2, records_upserted = $3, records_failed = $4
     WHERE id = $1`,
    [runId, counts.recordsSeen, counts.recordsUpserted, counts.recordsFailed],
  );
}

export async function markRunFailed(
  pool: Pool,
  runId: string,
  errorMessage: string,
): Promise<void> {
  await pool.query(
    `UPDATE ingestion_runs
     SET status = 'failed', finished_at = now(), error_message = $2
     WHERE id = $1`,
    [runId, errorMessage],
  );
}
