// Drizzle schema, translated from the reviewed design draft in
// docs/schema/0001_initial.sql. That file explains the *why* behind these
// tables (see docs/schema/event-model.md); this file is what actually runs.
//
// The generated `search_vector` column on source_events cannot be expressed
// portably in Drizzle's column builders (Postgres GENERATED ... STORED with
// an arbitrary expression), so it is declared here as a plain readable
// tsvector column and added to the database via a hand-written migration —
// see drizzle/0001_search_vector.sql. Keep both in sync if source_events'
// weighted fields change.

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export const collectionMethodEnum = pgEnum("collection_method", [
  "ics",
  "rss",
  "atom",
  "json_api",
  "html",
]);

export const sources = pgTable(
  "sources",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    owner: text("owner").notNull(),
    homepageUrl: text("homepage_url").notNull(),
    feedUrl: text("feed_url"),
    method: collectionMethodEnum("method").notNull(),

    termsUrl: text("terms_url"),
    termsReviewedAt: timestamp("terms_reviewed_at", { withTimezone: true }),
    termsNotes: text("terms_notes"),
    retainRawPayload: boolean("retain_raw_payload").notNull().default(false),
    rawRetentionDays: integer("raw_retention_days").notNull().default(7),
    contactEmail: text("contact_email"),

    intervalSeconds: integer("interval_seconds").notNull().default(3600),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull().defaultNow(),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),

    enabled: boolean("enabled").notNull().default(false),
    disabledReason: text("disabled_reason"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sources_due_idx")
      .on(table.nextRunAt)
      .where(sql`${table.enabled}`),
    check(
      "enabled_requires_terms_review",
      sql`${table.enabled} = false OR ${table.termsReviewedAt} IS NOT NULL`,
    ),
    check("positive_interval", sql`${table.intervalSeconds} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Ingestion runs — job record + observability record (docs/adr/0004)
// ---------------------------------------------------------------------------

export const runStatusEnum = pgEnum("run_status", [
  "running",
  "succeeded",
  "partial",
  "failed",
]);

export const ingestionRuns = pgTable(
  "ingestion_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    status: runStatusEnum("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),

    recordsSeen: integer("records_seen").notNull().default(0),
    recordsCreated: integer("records_created").notNull().default(0),
    recordsUpdated: integer("records_updated").notNull().default(0),
    recordsSkipped: integer("records_skipped").notNull().default(0),
    recordsFailed: integer("records_failed").notNull().default(0),

    attempt: integer("attempt").notNull().default(1),
    errorKind: text("error_kind"),
    errorSummary: text("error_summary"),
  },
  (table) => [
    index("ingestion_runs_source_time_idx").on(table.sourceId, table.startedAt),
    check(
      "finished_runs_have_end",
      sql`${table.status} = 'running' OR ${table.finishedAt} IS NOT NULL`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Raw snapshots — bounded retention, only where a source's terms allow it
// ---------------------------------------------------------------------------

export const rawSnapshots = pgTable(
  "raw_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => ingestionRuns.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    httpStatus: integer("http_status"),
    contentType: text("content_type"),
    contentHash: text("content_hash").notNull(),
    byteSize: integer("byte_size"),
    payload: text("payload"), // null when retention is not permitted
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("raw_snapshots_expiry_idx").on(table.retainUntil),
    index("raw_snapshots_run_idx").on(table.runId),
  ],
);

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  normalizedName: text("normalized_name").notNull().unique(), // dedup key
  displayName: text("display_name").notNull(), // as the source wrote it
  homepageUrl: text("homepage_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Source events — one row per event PER SOURCE. See event-model.md for why
// this is not the same thing as a deduplicated event.
// ---------------------------------------------------------------------------

export const eventStatusEnum = pgEnum("event_status", [
  "scheduled",
  "cancelled",
  "postponed",
]);

export const sourceEvents = pgTable(
  "source_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    sourceEventKey: text("source_event_key").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    firstRunId: uuid("first_run_id").references(() => ingestionRuns.id, {
      onDelete: "set null",
    }),
    lastRunId: uuid("last_run_id").references(() => ingestionRuns.id, {
      onDelete: "set null",
    }),

    title: text("title").notNull(),
    description: text("description"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    timezone: text("timezone").notNull(), // IANA name
    isAllDay: boolean("is_all_day").notNull().default(false),

    venueName: text("venue_name"),
    venueAddress: text("venue_address"),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),

    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    categoryRaw: text("category_raw"), // source's own wording, unmapped
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    costText: text("cost_text"),
    isFree: boolean("is_free"), // null = source did not say
    accessibilityNotes: text("accessibility_notes"),

    status: eventStatusEnum("status").notNull().default("scheduled"),

    sourcePublishedAt: timestamp("source_published_at", {
      withTimezone: true,
    }),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastMaterialChangeAt: timestamp("last_material_change_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    contentHash: text("content_hash").notNull(),

    // Populated by drizzle/0001_search_vector.sql as a generated column; not
    // written by the application.
    searchVector: tsvector("search_vector"),
  },
  (table) => [
    uniqueIndex("idempotent_import").on(table.sourceId, table.sourceEventKey),
    index("source_events_upcoming_idx")
      .on(table.startsAt)
      .where(sql`${table.status} <> 'cancelled'`),
    index("source_events_org_idx").on(table.organizationId),
    index("source_events_stale_idx").on(table.sourceId, table.lastSyncedAt),
    check(
      "ends_after_starts",
      sql`${table.endsAt} IS NULL OR ${table.endsAt} >= ${table.startsAt}`,
    ),
    check(
      "coords_together",
      sql`(${table.latitude} IS NULL) = (${table.longitude} IS NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Deduplication — grouping only. Never mutates or deletes source_events.
// ---------------------------------------------------------------------------

export const matchStrategyEnum = pgEnum("match_strategy", [
  "exact_key",
  "canonical_url",
  "deterministic_similarity",
  "manual",
]);

export const duplicateGroups = pgTable("duplicate_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  primaryEventId: uuid("primary_event_id").references(() => sourceEvents.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: text("reviewed_by"),
  reviewNote: text("review_note"),
});

export const duplicateGroupMembers = pgTable(
  "duplicate_group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => duplicateGroups.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => sourceEvents.id, { onDelete: "cascade" }),
    addedBy: matchStrategyEnum("added_by").notNull(),
    matchScore: numeric("match_score", { precision: 4, scale: 3 }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }), // unmerge = set this, never delete the row
    removedReason: text("removed_reason"),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.eventId] }),
    uniqueIndex("duplicate_members_one_active_group_idx")
      .on(table.eventId)
      .where(sql`${table.removedAt} IS NULL`),
  ],
);

// ---------------------------------------------------------------------------
// Corrections — tracked, never a destructive edit to imported data
// ---------------------------------------------------------------------------

export const correctionStatusEnum = pgEnum("correction_status", [
  "open",
  "accepted",
  "rejected",
]);

export const corrections = pgTable(
  "corrections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => sourceEvents.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    reportedValue: text("reported_value"),
    reason: text("reason"),
    status: correctionStatusEnum("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
    resolutionNote: text("resolution_note"),
  },
  (table) => [
    index("corrections_open_idx")
      .on(table.eventId)
      .where(sql`${table.status} = 'open'`),
  ],
);
