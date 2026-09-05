// The source registry: reading configured sources and recording the outcome
// of a run against them.
//
// The policy this enforces lives in docs/sources/README.md; the database
// backs it up with the enabled_requires_terms_review constraint, so a source
// with no recorded terms review cannot be turned on from here either.

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { sources } from "@/lib/db/schema";

export type SourceRecord = {
  id: string;
  displayName: string;
  method: "ics" | "rss" | "atom" | "json_api" | "html";
  feedUrl: string | null;
  homepageUrl: string;
  defaultTimezone: string;
  retainRawPayload: boolean;
  rawRetentionDays: number;
  intervalSeconds: number;
  consecutiveFailures: number;
  lastEtag: string | null;
  lastModifiedHeader: string | null;
  enabled: boolean;
};

export async function getSource(id: string): Promise<SourceRecord | null> {
  const [row] = await db
    .select({
      id: sources.id,
      displayName: sources.displayName,
      method: sources.method,
      feedUrl: sources.feedUrl,
      homepageUrl: sources.homepageUrl,
      defaultTimezone: sources.defaultTimezone,
      retainRawPayload: sources.retainRawPayload,
      rawRetentionDays: sources.rawRetentionDays,
      intervalSeconds: sources.intervalSeconds,
      consecutiveFailures: sources.consecutiveFailures,
      lastEtag: sources.lastEtag,
      lastModifiedHeader: sources.lastModifiedHeader,
      enabled: sources.enabled,
    })
    .from(sources)
    .where(eq(sources.id, id))
    .limit(1);

  return row ?? null;
}

/**
 * Record a successful run: clear the failure counter and store the
 * validators for next time.
 *
 * `validators` is optional on purpose. A 304 response carries no new
 * validators, and overwriting the stored ones with null would mean the next
 * poll could not send a conditional request at all — the feed would work
 * once, then silently fall back to full transfers forever. Omitting the
 * argument leaves the existing validators in place.
 */
export async function recordSuccess(
  sourceId: string,
  validators?: { etag?: string | null; lastModified?: string | null },
): Promise<void> {
  await db
    .update(sources)
    .set({
      consecutiveFailures: 0,
      ...(validators
        ? {
            lastEtag: validators.etag ?? null,
            lastModifiedHeader: validators.lastModified ?? null,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(sources.id, sourceId));
}

/**
 * Record a failure and push the next attempt out by the backoff delay.
 * The source stays enabled — repeated failures surface through the health
 * endpoint rather than silently disabling collection.
 */
export async function recordFailure(
  sourceId: string,
  backoffDelaySeconds: number,
): Promise<number> {
  const [row] = await db
    .update(sources)
    .set({
      consecutiveFailures: sql`${sources.consecutiveFailures} + 1`,
      nextRunAt: sql`now() + make_interval(secs => ${backoffDelaySeconds})`,
      updatedAt: new Date(),
    })
    .where(eq(sources.id, sourceId))
    .returning({ failures: sources.consecutiveFailures });

  return row?.failures ?? 0;
}

/**
 * Turn a source off with a stated reason. Honoring a removal request must be
 * one update, never a deploy (docs/sources/README.md).
 */
export async function disableSource(sourceId: string, reason: string): Promise<void> {
  await db
    .update(sources)
    .set({ enabled: false, disabledReason: reason, updatedAt: new Date() })
    .where(eq(sources.id, sourceId));
}
