import type { Event } from "@hoosradar/core";
import type { Pool } from "pg";
import { type EventRow, rowToEvent } from "./rows.js";

export interface UpcomingPage {
  events: Event[];
  nextCursor: string | null;
}

interface Cursor {
  startAt: string;
  id: string;
}

function encodeCursor(event: Event): string {
  const cursor: Cursor = { startAt: event.startAt.toISOString(), id: event.id };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): Cursor {
  const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  if (typeof parsed.startAt !== "string" || typeof parsed.id !== "string") {
    throw new Error("Malformed pagination cursor");
  }
  return parsed;
}

/**
 * Upcoming, active events ordered by start time. Cursor-based
 * (OVERVIEW.md section 6: "pagination or cursor-based loading prevents
 * unbounded responses"), keyed on (start_at, id) so ties at the same instant
 * still produce a stable order across pages.
 */
export async function listUpcomingEvents(
  pool: Pool,
  options: { now?: Date; limit?: number; cursor?: string | null } = {},
): Promise<UpcomingPage> {
  const now = options.now ?? new Date();
  const limit = Math.min(options.limit ?? 20, 100);

  const params: unknown[] = [now];
  let cursorClause = "";
  if (options.cursor) {
    const decoded = decodeCursor(options.cursor);
    params.push(decoded.startAt, decoded.id);
    cursorClause = "AND (start_at, id) > ($2::timestamptz, $3::uuid)";
  }

  const result = await pool.query<EventRow>(
    `SELECT * FROM events
     WHERE status = 'active' AND end_at >= $1 ${cursorClause}
     ORDER BY start_at ASC, id ASC
     LIMIT ${limit + 1}`,
    params,
  );

  const hasMore = result.rows.length > limit;
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
  const events = rows.map(rowToEvent);
  const last = events.at(-1);

  return {
    events,
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  };
}

export async function getEventById(pool: Pool, id: string): Promise<Event | null> {
  const result = await pool.query<EventRow>("SELECT * FROM events WHERE id = $1", [id]);
  const row = result.rows[0];
  return row ? rowToEvent(row) : null;
}

export async function searchEvents(
  pool: Pool,
  query: string,
  options: { limit?: number } = {},
): Promise<Event[]> {
  const limit = Math.min(options.limit ?? 20, 100);
  const result = await pool.query<EventRow>(
    `SELECT * FROM events
     WHERE status = 'active' AND search_vector @@ websearch_to_tsquery('english', $1)
     ORDER BY ts_rank(search_vector, websearch_to_tsquery('english', $1)) DESC, start_at ASC
     LIMIT $2`,
    [query, limit],
  );
  return result.rows.map(rowToEvent);
}
