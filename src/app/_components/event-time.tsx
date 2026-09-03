// Shared formatting for event times and freshness. Times are rendered in the
// event's own IANA timezone rather than the server's, since an event's start
// time means the time on Grounds.

export function formatEventTime(
  startsAt: Date,
  endsAt: Date | null,
  timezone: string,
  isAllDay: boolean,
): string {
  const dateFormat = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timezone,
  });

  if (isAllDay) {
    return `${dateFormat.format(startsAt)} · All day`;
  }

  const timeFormat = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });

  const start = `${dateFormat.format(startsAt)}, ${timeFormat.format(startsAt)}`;
  if (!endsAt) {
    // No end time is a real, common case — say so rather than inventing one.
    return `${start} · end time not listed`;
  }

  const sameDay = dateFormat.format(startsAt) === dateFormat.format(endsAt);
  return sameDay
    ? `${start} – ${timeFormat.format(endsAt)}`
    : `${start} – ${dateFormat.format(endsAt)}, ${timeFormat.format(endsAt)}`;
}

export function formatLastChecked(lastSyncedAt: Date): string {
  const minutes = Math.floor((Date.now() - lastSyncedAt.getTime()) / (1000 * 60));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
