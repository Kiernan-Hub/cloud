import { enqueueRun, listEnabledSources } from "@hoosradar/db";
import type { Pool } from "pg";

/**
 * Milestone 1's minimal version of OVERVIEW.md section 8's job mechanism:
 * for each enabled source with no run already pending or running, enqueue
 * one. This is deliberately the "local development: an in-process interval"
 * half of ADR-0003's scheduling decision — production instead has an
 * external cron call a trigger endpoint, because free hosting tiers suspend
 * idle workers and would silently break an in-process timer. That endpoint
 * does not exist yet; this scheduler is what a future one would call.
 */
export async function enqueueDueRuns(pool: Pool): Promise<number> {
  const sources = await listEnabledSources(pool);
  let enqueued = 0;

  for (const source of sources) {
    const existing = await pool.query(
      "SELECT 1 FROM ingestion_runs WHERE source_id = $1 AND status IN ('pending', 'running') LIMIT 1",
      [source.id],
    );
    if (existing.rows.length > 0) {
      continue;
    }
    await enqueueRun(pool, source.id);
    enqueued += 1;
  }

  return enqueued;
}
