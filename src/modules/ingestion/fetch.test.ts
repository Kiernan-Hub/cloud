import { describe, expect, it } from "vitest";

import { backoffSeconds, fetchSource, USER_AGENT } from "./fetch";

function respondWith(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): { impl: typeof fetch; seen: () => Request | null } {
  let seen: Request | null = null;
  const impl = (async (url: string, options: RequestInit) => {
    seen = new Request(url, options);
    return new Response(init.status === 304 ? null : body, {
      status: init.status ?? 200,
      headers: init.headers ?? {},
    });
  }) as unknown as typeof fetch;
  return { impl, seen: () => seen };
}

describe("fetchSource", () => {
  it("identifies the application in the user agent", async () => {
    const { impl, seen } = respondWith("ok");
    await fetchSource({ url: "https://example.invalid/f.ics", fetchImpl: impl });

    // Publishers should be able to see who is polling them and how to make
    // it stop (docs/sources/README.md).
    expect(seen()!.headers.get("user-agent")).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/HoosRadar/);
    expect(USER_AGENT).toContain("http");
  });

  it("sends conditional headers when validators are known", async () => {
    const { impl, seen } = respondWith("ok");
    await fetchSource({
      url: "https://example.invalid/f.ics",
      conditional: { etag: '"abc"', lastModified: "Wed, 01 Jan 2026 00:00:00 GMT" },
      fetchImpl: impl,
    });

    expect(seen()!.headers.get("if-none-match")).toBe('"abc"');
    expect(seen()!.headers.get("if-modified-since")).toBe(
      "Wed, 01 Jan 2026 00:00:00 GMT",
    );
  });

  it("omits conditional headers when no validators are stored", async () => {
    const { impl, seen } = respondWith("ok");
    await fetchSource({ url: "https://example.invalid/f.ics", fetchImpl: impl });

    expect(seen()!.headers.get("if-none-match")).toBeNull();
  });

  it("returns the body and validators on 200", async () => {
    const { impl } = respondWith("BEGIN:VCALENDAR", {
      headers: { etag: '"v2"', "last-modified": "Wed, 01 Jan 2026 00:00:00 GMT" },
    });
    const outcome = await fetchSource({
      url: "https://example.invalid/f.ics",
      fetchImpl: impl,
    });

    expect(outcome.kind).toBe("fetched");
    if (outcome.kind !== "fetched") throw new Error("unreachable");
    expect(outcome.body).toBe("BEGIN:VCALENDAR");
    expect(outcome.etag).toBe('"v2"');
    expect(outcome.byteSize).toBeGreaterThan(0);
  });

  it("reports 304 distinctly from a failure", async () => {
    const { impl } = respondWith("", { status: 304 });
    const outcome = await fetchSource({
      url: "https://example.invalid/f.ics",
      fetchImpl: impl,
    });

    expect(outcome.kind).toBe("not_modified");
  });

  it("classifies client errors as not retryable", async () => {
    for (const status of [400, 403, 404, 410]) {
      const { impl } = respondWith("", { status });
      const outcome = await fetchSource({
        url: "https://example.invalid/f.ics",
        fetchImpl: impl,
      });
      expect(outcome.kind).toBe("failed");
      if (outcome.kind !== "failed") throw new Error("unreachable");
      expect(outcome.retryable).toBe(false);
    }
  });

  it("classifies server errors and rate limits as retryable", async () => {
    for (const status of [429, 500, 502, 503]) {
      const { impl } = respondWith("", { status });
      const outcome = await fetchSource({
        url: "https://example.invalid/f.ics",
        fetchImpl: impl,
      });
      expect(outcome.kind).toBe("failed");
      if (outcome.kind !== "failed") throw new Error("unreachable");
      expect(outcome.retryable).toBe(true);
    }
  });

  it("treats a network error as retryable", async () => {
    const impl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    const outcome = await fetchSource({
      url: "https://example.invalid/f.ics",
      fetchImpl: impl,
    });
    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") throw new Error("unreachable");
    expect(outcome.errorKind).toBe("network");
    expect(outcome.retryable).toBe(true);
  });

  it("refuses a response larger than the cap", async () => {
    const { impl } = respondWith("x".repeat(5000));
    const outcome = await fetchSource({
      url: "https://example.invalid/f.ics",
      fetchImpl: impl,
      maxBytes: 1000,
    });

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") throw new Error("unreachable");
    expect(outcome.message).toMatch(/too large/i);
    expect(outcome.retryable).toBe(false);
  });
});

describe("backoffSeconds", () => {
  const noJitter = () => 1; // full delay, no reduction

  it("grows exponentially with consecutive failures", () => {
    expect(backoffSeconds(1, { jitter: noJitter })).toBe(60);
    expect(backoffSeconds(2, { jitter: noJitter })).toBe(120);
    expect(backoffSeconds(3, { jitter: noJitter })).toBe(240);
  });

  it("is capped so a broken source is still retried on a sane schedule", () => {
    expect(backoffSeconds(50, { jitter: noJitter })).toBe(6 * 60 * 60);
  });

  it("applies jitter so failing sources do not retry in lockstep", () => {
    // Minimum jitter halves the delay; maximum leaves it whole.
    expect(backoffSeconds(3, { jitter: () => 0 })).toBe(120);
    expect(backoffSeconds(3, { jitter: () => 1 })).toBe(240);
  });

  it("never returns a negative or zero delay", () => {
    for (const failures of [0, 1, 5, 100]) {
      expect(backoffSeconds(failures, { jitter: () => 0 })).toBeGreaterThan(0);
    }
  });
});
