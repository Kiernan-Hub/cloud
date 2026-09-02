import type { Event } from "@hoosradar/core";

/**
 * Display helpers only — the underlying overlap/range logic lives in
 * @hoosradar/core (see event.ts's overlapsDay), not here.
 */

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "America/New_York",
});

const TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
});

export function formatEventWhen(
  event: Pick<Event, "startAt" | "endAt" | "isAllDay" | "startTimeUnknown">,
): string {
  const day = DATE_FORMAT.format(event.startAt);
  if (event.isAllDay) {
    return `${day} · all day`;
  }
  if (event.startTimeUnknown) {
    return `${day} · time not listed`;
  }
  return `${day} · ${TIME_FORMAT.format(event.startAt)}–${TIME_FORMAT.format(event.endAt)}`;
}

export function formatLastChecked(lastSyncedAt: Date, now: Date = new Date()): string {
  // Floored, not rounded: rounding would report a sync 31 seconds ago as
  // "1 min ago" and one from 89 minutes ago as "2h ago" — both overstate
  // freshness in a product whose whole point is honest freshness.
  const minutes = Math.floor((now.getTime() - lastSyncedAt.getTime()) / 60000);
  if (minutes < 1) return "checked just now";
  if (minutes < 60) return `checked ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `checked ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `checked ${days}d ago`;
}
