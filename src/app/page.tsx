import Link from "next/link";

import { listUpcoming } from "@/modules/events";

import { formatEventTime, formatLastChecked } from "./_components/event-time";

// Freshness is the product. Never serve this from a static cache.
export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const cursorStartsAt = params.cursorStartsAt;
  const cursorId = params.cursorId;

  const cursor =
    typeof cursorStartsAt === "string" && typeof cursorId === "string"
      ? { startsAt: cursorStartsAt, id: cursorId }
      : null;

  let result;
  try {
    result = await listUpcoming({ cursor });
  } catch {
    // Error state, implemented now rather than deferred (M1-08).
    return (
      <div className="notice notice-error" role="alert">
        <h2>Events are unavailable right now</h2>
        <p>
          HoosRadar could not reach its database. Nothing is wrong with the events
          themselves — try again in a moment.
        </p>
      </div>
    );
  }

  const { events, nextCursor } = result;

  if (events.length === 0) {
    return (
      <div className="notice">
        <h2>No upcoming events</h2>
        <p>
          There are no upcoming events to show. In development, run{" "}
          <code>npm run db:seed</code> to load demo data.
        </p>
      </div>
    );
  }

  return (
    <>
      <h2>Upcoming events</h2>
      <ul className="event-list">
        {events.map((event) => (
          <li key={event.id} className="event-card">
            <h2>
              <Link href={`/events/${event.id}`}>{event.title}</Link>
            </h2>
            <p className="event-meta">
              <span>
                {formatEventTime(
                  event.startsAt,
                  event.endsAt,
                  event.timezone,
                  event.isAllDay,
                )}
              </span>
              {/* Location genuinely may be absent; don't fabricate one. */}
              <span>{event.venueName ?? "Location not listed"}</span>
              {event.organizationName ? <span>{event.organizationName}</span> : null}
            </p>
            <p className="provenance">
              <span>
                Source:{" "}
                <a href={event.canonicalUrl} target="_blank" rel="noopener noreferrer">
                  {event.sourceName}
                </a>
              </span>
              <span>
                Last checked{" "}
                <time dateTime={event.lastSyncedAt.toISOString()}>
                  {formatLastChecked(event.lastSyncedAt)}
                </time>
              </span>
              {event.isStale ? (
                <span className="badge badge-stale">May be out of date</span>
              ) : null}
            </p>
          </li>
        ))}
      </ul>

      {nextCursor ? (
        <nav className="pagination">
          <Link
            href={`/?cursorStartsAt=${encodeURIComponent(nextCursor.startsAt)}&cursorId=${encodeURIComponent(nextCursor.id)}`}
          >
            Next page →
          </Link>
        </nav>
      ) : null}
    </>
  );
}
