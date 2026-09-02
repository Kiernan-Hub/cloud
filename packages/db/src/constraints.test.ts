import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { closePool, getPool } from "./pool.js";
import { upsertSource } from "./sources.js";

/**
 * Exercises ADR-0001 section 4's natural key directly against the schema —
 * the property OVERVIEW.md's Milestone 2 exit criterion depends on:
 * "repeated imports do not create duplicates." This tests the constraint
 * itself, independent of seed.ts's delete-and-reinsert approach.
 */
describe("events natural key (ADR-0001 section 4)", () => {
  afterAll(async () => {
    await closePool();
  });

  it("upserting the same (source_id, source_uid, occurrence_start) updates in place", async () => {
    const pool = getPool();
    const source = await upsertSource(pool, {
      slug: `test-source-${randomUUID()}`,
      name: "Constraint test source",
      method: "seed",
      feedUrl: null,
    });
    const sourceUid = "stable-id-123";

    const insertOrUpdate = (title: string) =>
      pool.query(
        `INSERT INTO events (
           source_id, source_uid, title, start_at, end_at, start_tz, source_url
         ) VALUES ($1, $2, $3, now(), now() + interval '1 hour', 'America/New_York', 'https://example.org')
         ON CONFLICT (source_id, source_uid, occurrence_start) WHERE source_uid IS NOT NULL
         DO UPDATE SET title = EXCLUDED.title, last_seen_at = now()
         RETURNING id`,
        [source.id, sourceUid, title],
      );

    const first = await insertOrUpdate("Original Title");
    const second = await insertOrUpdate("Retitled By Source");

    expect(first.rows[0].id).toBe(second.rows[0].id);

    const count = await pool.query(
      "SELECT count(*) FROM events WHERE source_id = $1 AND source_uid = $2",
      [source.id, sourceUid],
    );
    expect(Number(count.rows[0].count)).toBe(1);

    const current = await pool.query("SELECT title FROM events WHERE id = $1", [first.rows[0].id]);
    expect(current.rows[0].title).toBe("Retitled By Source");
  });

  it("lets two different source_uid-identified events coexist despite both having a null fingerprint", async () => {
    // Regression test: an earlier draft of the fingerprint index applied
    // NULLS NOT DISTINCT across the whole table, which would have made every
    // event identified by source_uid (and so carrying a null
    // content_fingerprint) collide with every other one from the same
    // source. The WHERE content_fingerprint IS NOT NULL clause is what
    // prevents that — this proves it.
    const pool = getPool();
    const source = await upsertSource(pool, {
      slug: `test-source-${randomUUID()}`,
      name: "Sibling events test source",
      method: "seed",
      feedUrl: null,
    });

    const insert = (sourceUid: string, title: string) =>
      pool.query(
        `INSERT INTO events (source_id, source_uid, title, start_at, end_at, start_tz, source_url)
         VALUES ($1, $2, $3, now(), now() + interval '1 hour', 'America/New_York', 'https://example.org')`,
        [source.id, sourceUid, title],
      );

    await expect(insert("event-a", "First event")).resolves.toBeDefined();
    await expect(insert("event-b", "Second event")).resolves.toBeDefined();

    const count = await pool.query("SELECT count(*) FROM events WHERE source_id = $1", [source.id]);
    expect(Number(count.rows[0].count)).toBe(2);
  });

  it("rejects an end_at before start_at", async () => {
    const pool = getPool();
    const source = await upsertSource(pool, {
      slug: `test-source-${randomUUID()}`,
      name: "Constraint test source",
      method: "seed",
      feedUrl: null,
    });

    await expect(
      pool.query(
        `INSERT INTO events (source_id, title, start_at, end_at, start_tz, source_url)
         VALUES ($1, 'Backwards event', now(), now() - interval '1 hour', 'America/New_York', 'https://example.org')`,
        [source.id],
      ),
    ).rejects.toThrow();
  });
});
