import type { Source } from "@hoosradar/core";
import type { Pool } from "pg";
import { type SourceRow, rowToSource } from "./rows.js";

export async function upsertSource(
  pool: Pool,
  input: Pick<Source, "slug" | "name" | "method" | "feedUrl">,
): Promise<Source> {
  const result = await pool.query<SourceRow>(
    `INSERT INTO sources (slug, name, method, feed_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, method = EXCLUDED.method,
       feed_url = EXCLUDED.feed_url
     RETURNING *`,
    [input.slug, input.name, input.method, input.feedUrl],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(`Failed to upsert source ${input.slug}`);
  }
  return rowToSource(row);
}

export async function getSourceBySlug(pool: Pool, slug: string): Promise<Source | null> {
  const result = await pool.query<SourceRow>("SELECT * FROM sources WHERE slug = $1", [slug]);
  const row = result.rows[0];
  return row ? rowToSource(row) : null;
}

export async function getSourceById(pool: Pool, id: string): Promise<Source | null> {
  const result = await pool.query<SourceRow>("SELECT * FROM sources WHERE id = $1", [id]);
  const row = result.rows[0];
  return row ? rowToSource(row) : null;
}

export async function listEnabledSources(pool: Pool): Promise<Source[]> {
  const result = await pool.query<SourceRow>(
    "SELECT * FROM sources WHERE enabled = true ORDER BY name",
  );
  return result.rows.map(rowToSource);
}
