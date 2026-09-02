import { Pool } from "pg";

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and point it at your local Postgres.",
    );
  }
  return url;
}

let pool: Pool | undefined;

/** A process-wide connection pool. Created lazily so importing this module
 * never requires DATABASE_URL to already be set. */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: databaseUrl() });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
