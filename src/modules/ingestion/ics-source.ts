// The full ingestion path for an ICS source: fetch -> snapshot -> parse ->
// normalize -> upsert, with every stage's outcome recorded on the run.
//
// This is the handler the worker calls. It is the first place the separate
// stages meet, and it deliberately keeps them at arm's length: the parser
// never sees the database, and a failure in one stage produces a recorded
// outcome rather than an exception escaping into the loop.

import { db } from "@/lib/db";
import { rawSnapshots } from "@/lib/db/schema";
import { logger } from "@/lib/log";
import { upsertSourceEvents } from "@/modules/events";
import { normalizeIcsEvents } from "@/modules/normalization";
import { parseIcs } from "@/modules/parsing";

import { fetchSource, type ConditionalHeaders } from "./fetch";
import type { RunOutcome } from "./run";

import { createHash } from "node:crypto";

export type IcsSourceConfig = {
  sourceId: string;
  feedUrl: string;
  homepageUrl: string;
  /** For DATE and floating values that carry no zone of their own. */
  fallbackTimeZone: string;
  defaultOrganizationName?: string | null;
  retainRawPayload: boolean;
  rawRetentionDays: number;
  conditional?: ConditionalHeaders;
};

export async function ingestIcsSource(
  config: IcsSourceConfig,
  runId: string,
  deps?: { fetchImpl?: typeof fetch; now?: Date },
): Promise<RunOutcome> {
  const now = deps?.now ?? new Date();
  const runLogger = logger.withContext({
    run_id: runId,
    source_id: config.sourceId,
  });

  const fetched = await fetchSource({
    url: config.feedUrl,
    conditional: config.conditional,
    fetchImpl: deps?.fetchImpl,
  });

  if (fetched.kind === "not_modified") {
    // The publisher says nothing changed. That is a successful check, and
    // it still counts as a sync for freshness purposes.
    runLogger.info("source unchanged since last check");
    return { status: "succeeded", recordsSeen: 0, notModified: true };
  }

  if (fetched.kind === "failed") {
    runLogger.warn("fetch failed", {
      error_kind: fetched.errorKind,
      status: fetched.status,
      retryable: fetched.retryable,
    });
    return {
      status: "failed",
      errorKind: "fetch",
      errorSummary: fetched.message,
      retryable: fetched.retryable,
    };
  }

  const contentHash = createHash("sha256").update(fetched.body).digest("hex");

  // Record the snapshot. The payload itself is stored only where the
  // source's terms permit it; the hash is always kept so an unchanged feed
  // can be detected even without retention.
  await db.insert(rawSnapshots).values({
    runId,
    sourceId: config.sourceId,
    fetchedAt: now,
    httpStatus: fetched.status,
    contentType: fetched.contentType,
    contentHash,
    byteSize: fetched.byteSize,
    payload: config.retainRawPayload ? fetched.body : null,
    retainUntil: new Date(now.getTime() + config.rawRetentionDays * 24 * 60 * 60 * 1000),
  });

  let parsed;
  try {
    parsed = parseIcs(fetched.body, {
      fallbackTimeZone: config.fallbackTimeZone,
    });
  } catch (error: unknown) {
    // A parse failure is the source's shape changing under us — worth
    // surfacing loudly, but it must not lose the snapshot we just stored.
    return {
      status: "failed",
      errorKind: "parse",
      errorSummary: error instanceof Error ? error.message : String(error),
    };
  }

  const normalized = normalizeIcsEvents(parsed.events, {
    fallbackUrl: config.homepageUrl,
    defaultOrganizationName: config.defaultOrganizationName ?? null,
  });

  const skipped = parsed.issues.length + normalized.issues.length;

  for (const issue of parsed.issues) {
    runLogger.warn("skipped malformed record", {
      stage: "parse",
      event_index: issue.eventIndex,
      uid: issue.uid,
      reason: issue.reason,
    });
  }
  for (const issue of normalized.issues) {
    runLogger.warn("skipped malformed record", {
      stage: "normalize",
      uid: issue.sourceEventKey,
      reason: issue.reason,
    });
  }

  const upserted = await upsertSourceEvents({
    sourceId: config.sourceId,
    runId,
    candidates: normalized.candidates,
    now,
  });

  runLogger.info("ingestion complete", {
    seen: parsed.events.length,
    created: upserted.created,
    updated: upserted.updated,
    unchanged: upserted.unchanged,
    missing: upserted.missing,
    skipped,
  });

  return {
    // Records were dropped, so this run is honest about being partial —
    // it is not a clean success.
    status: skipped > 0 ? "partial" : "succeeded",
    recordsSeen: parsed.events.length + skipped,
    recordsCreated: upserted.created,
    recordsUpdated: upserted.updated,
    recordsSkipped: skipped,
    etag: fetched.etag,
    lastModified: fetched.lastModified,
  };
}
