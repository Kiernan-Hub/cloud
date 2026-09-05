// Fetching a source politely.
//
// Three obligations from docs/sources/README.md are implemented here, not
// left to the caller to remember:
//   - identify the application and a contact address in the user agent
//   - send conditional requests so repeat polling is cheap for the publisher
//   - back off on failure rather than hammering
//
// No parsing happens here. This returns bytes and metadata; interpreting
// them is the parser's job.

export const USER_AGENT =
  "HoosRadar/0.1 (UVA campus event aggregator; +https://github.com/Kiernan-Hub/cloud)";

export type ConditionalHeaders = {
  etag?: string | null;
  lastModified?: string | null;
};

export type FetchOutcome =
  | {
      kind: "fetched";
      status: number;
      body: string;
      contentType: string | null;
      etag: string | null;
      lastModified: string | null;
      byteSize: number;
    }
  // The publisher told us nothing changed. Cheapest possible poll.
  | { kind: "not_modified"; status: 304 }
  | {
      kind: "failed";
      status: number | null;
      errorKind: "http" | "network" | "timeout";
      message: string;
      /** Whether trying again later could plausibly succeed. */
      retryable: boolean;
    };

export type FetchSourceOptions = {
  url: string;
  conditional?: ConditionalHeaders;
  timeoutMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Guard against a source serving something enormous. */
  maxBytes?: number;
};

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

/** A 5xx or 429 may succeed later; a 404 or 403 will not. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function fetchSource(options: FetchSourceOptions): Promise<FetchOutcome> {
  const {
    url,
    conditional,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
    maxBytes = DEFAULT_MAX_BYTES,
  } = options;

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "text/calendar, application/json;q=0.9, */*;q=0.1",
  };

  if (conditional?.etag) headers["If-None-Match"] = conditional.etag;
  if (conditional?.lastModified) {
    headers["If-Modified-Since"] = conditional.lastModified;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      headers,
      signal: controller.signal,
      redirect: "follow",
    });

    if (response.status === 304) {
      return { kind: "not_modified", status: 304 };
    }

    if (!response.ok) {
      return {
        kind: "failed",
        status: response.status,
        errorKind: "http",
        message: `HTTP ${response.status} ${response.statusText}`.trim(),
        retryable: isRetryableStatus(response.status),
      };
    }

    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > maxBytes) {
      return {
        kind: "failed",
        status: response.status,
        errorKind: "http",
        message: `Response too large: ${declaredLength} bytes`,
        retryable: false,
      };
    }

    const body = await response.text();
    const byteSize = Buffer.byteLength(body, "utf8");

    if (byteSize > maxBytes) {
      return {
        kind: "failed",
        status: response.status,
        errorKind: "http",
        message: `Response too large: ${byteSize} bytes`,
        retryable: false,
      };
    }

    return {
      kind: "fetched",
      status: response.status,
      body,
      contentType: response.headers.get("content-type"),
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      byteSize,
    };
  } catch (error: unknown) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    return {
      kind: "failed",
      status: null,
      errorKind: isAbort ? "timeout" : "network",
      message: isAbort
        ? `Request timed out after ${timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : String(error),
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bounded exponential backoff with jitter, capped so a persistently failing
 * source is retried on a sane schedule rather than abandoned or hammered.
 * Jitter matters: without it, every failing source retries in lockstep.
 */
export function backoffSeconds(
  consecutiveFailures: number,
  options?: { baseSeconds?: number; maxSeconds?: number; jitter?: () => number },
): number {
  const base = options?.baseSeconds ?? 60;
  const max = options?.maxSeconds ?? 6 * 60 * 60;
  const jitter = options?.jitter ?? Math.random;

  const exponential = base * 2 ** Math.max(0, consecutiveFailures - 1);
  const capped = Math.min(exponential, max);

  // Full jitter across [50%, 100%] of the delay.
  return Math.round(capped * (0.5 + jitter() * 0.5));
}
