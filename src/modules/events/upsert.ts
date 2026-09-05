// Writing normalized candidates to storage, idempotently.
//
// The guarantee: running ingestion twice on unchanged data creates nothing,
// updates nothing material, and reports zero changes. The database enforces
// the "creates nothing" half via UNIQUE (source_id, source_event_key); this
// module handles the rest — deciding what actually changed, and keeping the
// three freshness timestamps honest.

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { organizations, sourceEvents } from "@/lib/db/schema";
import type { EventCandidate } from "@/modules/normalization";
import { normalizeOrganizationName } from "@/modules/normalization";

export type UpsertSummary = {
  created: number;
  updated: number;
  unchanged: number;
  /** Events previously seen from this source that were absent this run. */
  missing: number;
};

async function resolveOrganizationId(name: string | null): Promise<string | null> {
  if (!name) return null;

  const normalized = normalizeOrganizationName(name);
  if (!normalized) return null;

  const [row] = await db
    .insert(organizations)
    .values({ normalizedName: normalized, displayName: name })
    .onConflictDoUpdate({
      target: organizations.normalizedName,
      // Keep the display name the source most recently used, but never lose
      // the row identity that events point at.
      set: { displayName: name },
    })
    .returning({ id: organizations.id });

  return row?.id ?? null;
}

export type UpsertOptions = {
  sourceId: string;
  runId: string;
  candidates: EventCandidate[];
  /** Injectable so tests can pin time. */
  now?: Date;
};

export async function upsertSourceEvents(options: UpsertOptions): Promise<UpsertSummary> {
  const { sourceId, runId, candidates } = options;
  const now = options.now ?? new Date();

  const summary: UpsertSummary = {
    created: 0,
    updated: 0,
    unchanged: 0,
    missing: 0,
  };

  // Existing rows for this source, so we can tell created from updated and
  // detect material changes without a second round trip per event.
  const existingRows = await db
    .select({
      id: sourceEvents.id,
      key: sourceEvents.sourceEventKey,
      contentHash: sourceEvents.contentHash,
    })
    .from(sourceEvents)
    .where(eq(sourceEvents.sourceId, sourceId));

  const existingByKey = new Map(existingRows.map((row) => [row.key, row] as const));

  for (const candidate of candidates) {
    const organizationId = await resolveOrganizationId(candidate.organizationName);
    const existing = existingByKey.get(candidate.sourceEventKey);
    const isMaterialChange =
      existing !== undefined && existing.contentHash !== candidate.contentHash;

    const values = {
      sourceId,
      sourceEventKey: candidate.sourceEventKey,
      canonicalUrl: candidate.canonicalUrl,
      title: candidate.title,
      description: candidate.description,
      startsAt: candidate.startsAt,
      endsAt: candidate.endsAt,
      timezone: candidate.timezone,
      isAllDay: candidate.isAllDay,
      venueName: candidate.venueName,
      venueAddress: candidate.venueAddress,
      organizationId,
      categoryRaw: candidate.categoryRaw,
      tags: candidate.tags,
      costText: candidate.costText,
      isFree: candidate.isFree,
      accessibilityNotes: candidate.accessibilityNotes,
      status: candidate.status,
      sourcePublishedAt: candidate.sourcePublishedAt,
      sourceUpdatedAt: candidate.sourceUpdatedAt,
      contentHash: candidate.contentHash,
      firstRunId: runId,
      lastRunId: runId,
      firstSeenAt: now,
      lastSeenAt: now,
      lastSyncedAt: now,
      lastMaterialChangeAt: now,
    };

    await db
      .insert(sourceEvents)
      .values(values)
      .onConflictDoUpdate({
        target: [sourceEvents.sourceId, sourceEvents.sourceEventKey],
        set: {
          canonicalUrl: values.canonicalUrl,
          title: values.title,
          description: values.description,
          startsAt: values.startsAt,
          endsAt: values.endsAt,
          timezone: values.timezone,
          isAllDay: values.isAllDay,
          venueName: values.venueName,
          venueAddress: values.venueAddress,
          organizationId: values.organizationId,
          categoryRaw: values.categoryRaw,
          tags: values.tags,
          costText: values.costText,
          isFree: values.isFree,
          accessibilityNotes: values.accessibilityNotes,
          status: values.status,
          sourcePublishedAt: values.sourcePublishedAt,
          sourceUpdatedAt: values.sourceUpdatedAt,
          contentHash: values.contentHash,
          lastRunId: runId,
          // Seen and synced advance on every successful run...
          lastSeenAt: now,
          lastSyncedAt: now,
          // ...but the material-change stamp only moves when the content
          // hash actually differs. A republish of identical data must not
          // look like fresh information.
          //
          // `excluded` is the row we tried to insert, so this compares the
          // stored hash against the incoming one without rebinding either.
          lastMaterialChangeAt: sql`
            CASE WHEN ${sourceEvents.contentHash} IS DISTINCT FROM excluded.content_hash
                 THEN excluded.last_material_change_at
                 ELSE ${sourceEvents.lastMaterialChangeAt}
            END
          `,
          // first_seen_at and first_run_id are deliberately absent: they
          // describe when we first saw the event and must never be rewritten.
        },
      });

    if (!existing) summary.created += 1;
    else if (isMaterialChange) summary.updated += 1;
    else summary.unchanged += 1;
  }

  // Events we have stored but the source did not return this time. They are
  // marked as still-synced (we checked successfully) but NOT as still-seen,
  // which is exactly how a disappearance is distinguished from a source
  // outage. Nothing is deleted and nothing is marked cancelled — that
  // inference belongs to a human or an explicit source signal.
  const presentKeys = candidates.map((candidate) => candidate.sourceEventKey);
  const missingRows = existingRows.filter((row) => !presentKeys.includes(row.key));

  if (missingRows.length > 0) {
    await db
      .update(sourceEvents)
      .set({ lastSyncedAt: now, lastRunId: runId })
      .where(
        and(
          eq(sourceEvents.sourceId, sourceId),
          inArray(
            sourceEvents.id,
            missingRows.map((row) => row.id),
          ),
        ),
      );
    summary.missing = missingRows.length;
  }

  return summary;
}
