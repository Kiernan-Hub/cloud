import { closePool, getPool, seed } from "@hoosradar/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

// End-to-end against the real, seeded database — this is Milestone 1's exit
// criterion in test form: "view seeded events" through the real API and DB,
// not a mocked one.
describe("web app routes", () => {
  const app = buildApp();
  let firstEventId: string;

  beforeAll(async () => {
    const result = await seed();
    const pool = getPool();
    const row = await pool.query("SELECT id FROM events WHERE source_id = $1 LIMIT 1", [
      result.sourceId,
    ]);
    firstEventId = row.rows[0].id;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closePool();
  });

  it("GET /health reports ok", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("GET / renders seeded upcoming events", async () => {
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Upcoming events");
    // A known seed title should appear on the page.
    expect(response.body).toContain("Trail Run");
  });

  it("GET /events/:id renders the detail page with provenance", async () => {
    const response = await app.inject({ method: "GET", url: `/events/${firstEventId}` });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("View original source");
    expect(response.body).toContain("checked");
  });

  it("GET /events/:id for a missing id renders 404, not a crash", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/events/00000000-0000-0000-0000-000000000000",
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).toContain("Not found");
  });

  it("GET /search finds an event by title text", async () => {
    const response = await app.inject({ method: "GET", url: "/search?q=trivia" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Trivia Night");
  });

  it("GET /search with no query shows the empty prompt, not every event", async () => {
    const response = await app.inject({ method: "GET", url: "/search" });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Enter a search");
  });

  it("sanitizes event description HTML rather than escaping or dropping it outright", async () => {
    // The seeded "Intro to Data Science Workshop" event's description
    // contains a real <a> link; confirm allowlisted HTML actually renders as
    // HTML on its detail page (descriptions only appear there, not on
    // list/search cards), not just that nothing throws.
    const searchResponse = await app.inject({ method: "GET", url: "/search?q=data+science" });
    const match = searchResponse.body.match(/\/events\/([\w-]+)/);
    expect(match).not.toBeNull();

    const detailResponse = await app.inject({ method: "GET", url: `/events/${match?.[1]}` });
    expect(detailResponse.body).toContain('<a href="https://example.org/data-science-club"');
    // And nothing beyond the allowlist survived, per ADR-0002.
    expect(detailResponse.body).not.toContain("<script");
  });
});
