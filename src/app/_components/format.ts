export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function formatAgo(at: Date | null): string {
  if (!at) return "never";
  const minutes = Math.floor((Date.now() - at.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Percent, or an em dash when there is genuinely no data to report. */
export function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

export function statusBadgeClass(status: string): string {
  if (status === "passed") return "badge badge-pass";
  if (status === "failed" || status === "timed_out" || status === "error") {
    return "badge badge-fail";
  }
  // `partial` is warned about rather than passed: it did not fail, but it did
  // not check everything either. `canceled`, `skipped` and `running` are
  // neutral — they are the absence of a result, not a bad one.
  if (status === "partial") return "badge badge-warn";
  return "badge";
}
