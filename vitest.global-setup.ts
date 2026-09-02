import { config } from "dotenv";
import { Client } from "pg";

/**
 * Ensures hoosradar_test has the current schema and starts empty, once
 * before the whole suite runs.
 *
 * The migration step exists because the documented setup flow
 * (README.md's "Setup") only runs `npm run migrate` against `.env`'s
 * DATABASE_URL — hoosradar_dev — and nothing tells a new contributor to
 * migrate hoosradar_test separately. Discovered by literally following the
 * README from a clean database: `npm test` failed with a bare Postgres
 * "relation does not exist" (42P01), because the test database had never
 * been migrated. Rather than add an easy-to-forget manual step, the test
 * suite makes itself self-sufficient.
 *
 * The truncate is the second, separate reason this exists: sources and runs
 * otherwise accumulate across every `vitest run` invocation — each test uses
 * a unique UUID-suffixed slug, so nothing ever collides or gets cleaned up —
 * and the scheduler (enqueueDueRuns) keeps re-enqueuing runs for that
 * growing backlog forever. That backlog is what caused a test asserting
 * "nothing is due" to instead claim a leftover row from a run three
 * test-suite invocations ago.
 */
export default async function globalSetup(): Promise<void> {
  config({ path: new URL("./.env.test", import.meta.url).pathname, quiet: true });

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set for tests. Copy .env.test.example to .env.test and point it at hoosradar_test.",
    );
  }

  const { runner } = await import("node-pg-migrate");
  await runner({
    databaseUrl,
    dir: new URL("./packages/db/migrations", import.meta.url).pathname,
    direction: "up",
    migrationsTable: "pgmigrations",
    logger: { info: () => {}, warn: console.warn, error: console.error },
  });

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      "TRUNCATE event_status_history, events, event_series, ingestion_runs, sources RESTART IDENTITY CASCADE",
    );
  } finally {
    await client.end();
  }
}
