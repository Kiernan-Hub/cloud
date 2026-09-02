import type { Source } from "@hoosradar/core";
import { seed } from "@hoosradar/db";

export interface ProcessResult {
  recordsSeen: number;
  recordsUpserted: number;
  recordsFailed: number;
}

/**
 * Runs one source's ingestion. Only `seed` is implemented in the walking
 * skeleton — a real fetch-parse-normalize-dedupe pipeline is Milestone 2's
 * packages/ingest, which does not exist yet. An unimplemented method throws
 * rather than silently succeeding, so the run is honestly recorded as
 * `failed`: this project's rules forbid fabricating progress, and a run that
 * claims success without doing anything would be exactly that.
 */
export async function processSource(source: Source): Promise<ProcessResult> {
  if (source.method === "seed") {
    const result = await seed();
    return { recordsSeen: result.inserted, recordsUpserted: result.inserted, recordsFailed: 0 };
  }

  throw new Error(
    `No parser implemented for source method "${source.method}" yet — Milestone 2 (packages/ingest) has not started. See docs/decisions/0001-event-schema-and-lifecycle.md.`,
  );
}
