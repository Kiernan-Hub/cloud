import Link from "next/link";
import { notFound } from "next/navigation";

import { getEventById } from "@/modules/events";

import { formatEventTime, formatLastChecked } from "../../_components/event-time";

export const dynamic = "force-dynamic";

export default async function EventDetailPage({ params }: PageProps<"/events/[id]">) {
  const { id } = await params;
  const event = await getEventById(id);

  if (!event) {
    notFound();
  }

  return (
    <article>
      <Link className="back-link" href="/">
        ← All events
      </Link>

      <h2>{event.title}</h2>

      {event.status === "cancelled" ? (
        <p className="notice notice-error" role="status">
          <strong>This event was cancelled</strong> according to its source. It is kept
          here so the record stays visible rather than silently disappearing.
        </p>
      ) : null}

      {event.isStale ? (
        <p className="notice notice-warning" role="status">
          <strong>This information may be out of date.</strong> HoosRadar last checked its
          source{" "}
          <time dateTime={event.lastSyncedAt.toISOString()}>
            {formatLastChecked(event.lastSyncedAt)}
          </time>
          . Check the original source below before relying on it.
        </p>
      ) : null}

      <p className="event-meta">
        <span>
          {formatEventTime(event.startsAt, event.endsAt, event.timezone, event.isAllDay)}
        </span>
        {event.categoryRaw ? <span>{event.categoryRaw}</span> : null}
      </p>

      {event.description ? (
        <section className="detail-section">
          <h2>About</h2>
          <p>{event.description}</p>
        </section>
      ) : null}

      <section className="detail-section">
        <h2>Location</h2>
        <p>
          {event.venueName ?? "Not listed by the source"}
          {event.venueAddress ? (
            <>
              <br />
              {event.venueAddress}
            </>
          ) : null}
        </p>
      </section>

      {event.organizationName ? (
        <section className="detail-section">
          <h2>Hosted by</h2>
          <p>{event.organizationName}</p>
        </section>
      ) : null}

      <section className="detail-section">
        <h2>Cost</h2>
        <p>
          {event.costText ??
            (event.isFree === true
              ? "Free"
              : event.isFree === false
                ? "Paid — see source"
                : "Not listed by the source")}
        </p>
      </section>

      {event.accessibilityNotes ? (
        <section className="detail-section">
          <h2>Accessibility</h2>
          <p>{event.accessibilityNotes}</p>
        </section>
      ) : null}

      <section className="detail-section">
        <h2>Where this came from</h2>
        <dl className="provenance-list">
          <dt>Source</dt>
          <dd>{event.sourceName}</dd>
          <dt>Original</dt>
          <dd>
            <a href={event.canonicalUrl} target="_blank" rel="noopener noreferrer">
              {event.canonicalUrl}
            </a>
          </dd>
          <dt>Last checked</dt>
          <dd>
            <time dateTime={event.lastSyncedAt.toISOString()}>
              {formatLastChecked(event.lastSyncedAt)}
            </time>
          </dd>
        </dl>
        <p className="event-meta">
          HoosRadar does not edit event details. The original source is authoritative.
        </p>
      </section>
    </article>
  );
}
