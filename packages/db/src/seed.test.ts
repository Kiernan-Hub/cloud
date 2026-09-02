import { afterAll, describe, expect, it } from "vitest";
import { closePool, getPool } from "./pool.js";
import { seed } from "./seed.js";

// Requires a live Postgres reachable at DATABASE_URL with migrations applied
// — see docs/HANDBOOK.md and the root README for local setup. CI runs this
// against a Postgres service container.
describe("seed", () => {
  afterAll(async () => {
    await closePool();
  });

  // Note: seed() deletes and re-inserts its own rows on every run, so this
  // confirms re-seeding is safe, not that the upsert-on-conflict path itself
  // is idempotent — see constraints.test.ts for that, tested directly
  // against the natural key without the delete step in the way.
  it("is safe to run twice: reseeding does not duplicate rows", async () => {
    const first = await seed();
    const second = await seed();

    expect(second.sourceId).toBe(first.sourceId);
    expect(second.inserted).toBe(first.inserted);

    const pool = getPool();
    const result = await pool.query("SELECT count(*) FROM events WHERE source_id = $1", [
      first.sourceId,
    ]);
    expect(Number(result.rows[0].count)).toBe(first.inserted);
  });
});
