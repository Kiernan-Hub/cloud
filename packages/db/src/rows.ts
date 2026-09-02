import type { Event, IngestionRun, Source } from "@hoosradar/core";

/** Raw shape of a row from the `events` table (snake_case, as pg returns it). */
export interface EventRow {
  id: string;
  series_id: string | null;
  occurrence_start: Date | null;
  source_id: string;
  source_uid: string | null;
  content_fingerprint: string | null;
  title: string;
  description_html: string;
  start_at: Date;
  end_at: Date;
  start_tz: string;
  is_all_day: boolean;
  start_time_unknown: boolean;
  venue_name: string | null;
  venue_address: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
  organization_name: string | null;
  categories: string[];
  cost_text: string | null;
  accessibility_text: string | null;
  source_url: string;
  source_published_at: Date | null;
  first_seen_at: Date;
  last_seen_at: Date;
  last_synced_at: Date;
  status: Event["status"];
  consecutive_absences: number;
  duplicate_group_id: string | null;
}

export function rowToEvent(row: EventRow): Event {
  return {
    id: row.id,
    seriesId: row.series_id,
    occurrenceStart: row.occurrence_start,
    sourceId: row.source_id,
    sourceUid: row.source_uid,
    contentFingerprint: row.content_fingerprint,
    title: row.title,
    descriptionHtml: row.description_html,
    startAt: row.start_at,
    endAt: row.end_at,
    startTz: row.start_tz,
    isAllDay: row.is_all_day,
    startTimeUnknown: row.start_time_unknown,
    venueName: row.venue_name,
    venueAddress: row.venue_address,
    geo:
      row.geo_lat !== null && row.geo_lng !== null ? { lat: row.geo_lat, lng: row.geo_lng } : null,
    organizationName: row.organization_name,
    categories: row.categories,
    costText: row.cost_text,
    accessibilityText: row.accessibility_text,
    sourceUrl: row.source_url,
    sourcePublishedAt: row.source_published_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastSyncedAt: row.last_synced_at,
    status: row.status,
    consecutiveAbsences: row.consecutive_absences,
    duplicateGroupId: row.duplicate_group_id,
  };
}

export interface SourceRow {
  id: string;
  slug: string;
  name: string;
  method: Source["method"];
  feed_url: string | null;
  enabled: boolean;
  created_at: Date;
}

export function rowToSource(row: SourceRow): Source {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    method: row.method,
    feedUrl: row.feed_url,
    enabled: row.enabled,
    createdAt: row.created_at,
  };
}

export interface IngestionRunRow {
  id: string;
  source_id: string;
  status: IngestionRun["status"];
  scheduled_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  records_seen: number;
  records_upserted: number;
  records_failed: number;
  error_message: string | null;
}

export function rowToIngestionRun(row: IngestionRunRow): IngestionRun {
  return {
    id: row.id,
    sourceId: row.source_id,
    status: row.status,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    recordsSeen: row.records_seen,
    recordsUpserted: row.records_upserted,
    recordsFailed: row.records_failed,
    errorMessage: row.error_message,
  };
}
