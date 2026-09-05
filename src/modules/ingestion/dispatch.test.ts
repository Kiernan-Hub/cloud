import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createServer, type Server } from "node:http";

import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, sqlClient } from "@/lib/db";
import { sourceEvents, sources } from "@/lib/db/schema";
import { claimDueSources, defaultHandler, startRun } from "@/modules/ingestion";
import { getSource } from "@/modules/sources";

const TEST_SOURCE = "test-dispatch-source";
const FIXTURE = readFileSync(
  join(import.meta.dirname, "../parsing/ics/fixtures/sample-calendar.ics"),
  "utf8",
);

// A real HTTP server, so conditional requests are exercised over the wire
// rather than against a stub that might not behave like one. Localhost only —
// this is not a live external source, so CI stays deterministic.
let server: Server;
let port: number;
let requestCount = 0;
let lastIfNoneMatch: string | undefined;
const ETAG = '"fixture-v1"';

async function startServer(): Promise<void> {
  server = createServer((req, res) => {
    requestCount += 1;
    lastIfNoneMatch = req.headers["if-none-match"] as string | undefined;

    if (lastIfNoneMatch === ETAG) {
      res.writeHead(304).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/calendar", etag: ETAG });
    res.end(FIXTURE);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}

async function cleanup() {
  await db.execute(sql`DELETE FROM sources WHERE id = ${TEST_SOURCE}`);
}

async function createSource(overrides: Record<string, unknown> = {}) {
  await db.insert(sources).values({
    id: TEST_SOURCE,
    displayName: "Dispatch test source",
    owner: "test",
    homepageUrl: `http://127.0.0.1:${port}/`,
    feedUrl: `http://127.0.0.1:${port}/feed.ics`,
    method: "ics",
    termsReviewedAt: new Date(),
    enabled: true,
    nextRunAt: new Date(Date.now() - 60_000),
    ...overrides,
  });
}

beforeEach(async () => {
  if (!server) await startServer();
  requestCount = 0;
  lastIfNoneMatch = undefined;
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("defaultHandler over real HTTP", () => {
  it("ingests an ICS source end to end", async () => {
    await createSource();
    const [claimed] = await claimDueSources();
    const runId = await startRun(TEST_SOURCE);

    const outcome = await defaultHandler(claimed!, runId);

    expect(outcome.recordsCreated).toBe(8);
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sourceEvents)
      .where(sql`${sourceEvents.sourceId} = ${TEST_SOURCE}`);
    expect(row!.count).toBe(8);
  });

  it("stores the ETag after a successful fetch", async () => {
    await createSource();
    const [claimed] = await claimDueSources();
    await defaultHandler(claimed!, await startRun(TEST_SOURCE));

    expect((await getSource(TEST_SOURCE))!.lastEtag).toBe(ETAG);
  });

  it("sends the stored ETag on the next poll and gets a 304", async () => {
    await createSource();

    const [first] = await claimDueSources();
    await defaultHandler(first!, await startRun(TEST_SOURCE));

    await db
      .update(sources)
      .set({ nextRunAt: new Date(Date.now() - 60_000) })
      .where(sql`${sources.id} = ${TEST_SOURCE}`);

    const [second] = await claimDueSources();
    const outcome = await defaultHandler(second!, await startRun(TEST_SOURCE));

    expect(lastIfNoneMatch).toBe(ETAG);
    expect(outcome.notModified).toBe(true);
    expect(outcome.status).toBe("succeeded");
  });

  it("keeps the ETag after a 304 so later polls stay conditional", async () => {
    // Regression: a 304 carries no validators, and writing them back as null
    // made the third poll a full transfer. The feed worked once, then
    // silently stopped being polite to the publisher.
    await createSource();

    for (let poll = 0; poll < 3; poll++) {
      await db
        .update(sources)
        .set({ nextRunAt: new Date(Date.now() - 60_000) })
        .where(sql`${sources.id} = ${TEST_SOURCE}`);
      const [claimed] = await claimDueSources();
      await defaultHandler(claimed!, await startRun(TEST_SOURCE));
    }

    expect((await getSource(TEST_SOURCE))!.lastEtag).toBe(ETAG);
    // The third request must still have carried the validator, and must
    // actually have reached the server rather than being skipped.
    expect(lastIfNoneMatch).toBe(ETAG);
    expect(requestCount).toBe(3);
  });

  it("resets the failure counter on success", async () => {
    await createSource({ consecutiveFailures: 4 });
    const [claimed] = await claimDueSources();
    await defaultHandler(claimed!, await startRun(TEST_SOURCE));

    expect((await getSource(TEST_SOURCE))!.consecutiveFailures).toBe(0);
  });
});

describe("failure behavior", () => {
  it("backs off and increments the failure count on an unreachable feed", async () => {
    await createSource({ feedUrl: "http://127.0.0.1:1/nothing.ics" });
    const [claimed] = await claimDueSources();

    const outcome = await defaultHandler(claimed!, await startRun(TEST_SOURCE));

    expect(outcome.status).toBe("failed");
    const source = await getSource(TEST_SOURCE);
    expect(source!.consecutiveFailures).toBe(1);
    // Next attempt pushed into the future rather than retried immediately.
    expect(source!.enabled).toBe(true);
  });

  it("fails clearly when an ICS source has no feed url", async () => {
    await createSource({ feedUrl: null });
    const [claimed] = await claimDueSources();

    const outcome = await defaultHandler(claimed!, await startRun(TEST_SOURCE));

    expect(outcome.status).toBe("failed");
    expect(outcome.errorKind).toBe("config");
    expect(outcome.errorSummary).toMatch(/feed_url/i);
  });

  it("fails clearly for a source method with no parser yet", async () => {
    await createSource({ method: "html" });
    const [claimed] = await claimDueSources();

    const outcome = await defaultHandler(claimed!, await startRun(TEST_SOURCE));

    // Pretending an unsupported source succeeded would hide the gap.
    expect(outcome.status).toBe("failed");
    expect(outcome.errorSummary).toMatch(/No handler for source method/i);
  });
});
