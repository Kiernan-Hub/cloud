import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getConfig } from "@/lib/config";

import * as schema from "./schema";

// The connection is opened on first use, not on import.
//
// `next build` imports every route module to collect page data, so connecting
// at import time made DATABASE_URL a *build* requirement — and the build never
// queries anything. That is what broke the Docker image build, which has no
// database and needs none.
//
// Failing loudly on a missing DATABASE_URL is still right; it just belongs at
// the moment something actually tries to talk to the database.

type Database = ReturnType<typeof drizzle<typeof schema>>;

// One pooled client per process. Next.js dev-mode module reloading would
// otherwise open a new pool on every edit, so the connection is cached on
// globalThis in development only.
const globalForDb = globalThis as unknown as {
  gatekeeperDb?: { client: ReturnType<typeof postgres>; db: Database };
};

let local: { client: ReturnType<typeof postgres>; db: Database } | undefined;

function connection() {
  const existing = globalForDb.gatekeeperDb ?? local;
  if (existing) return existing;

  const client = postgres(getConfig().DATABASE_URL, { max: 10 });
  const created = { client, db: drizzle(client, { schema }) };

  if (process.env.NODE_ENV === "production") {
    local = created;
  } else {
    globalForDb.gatekeeperDb = created;
  }
  return created;
}

/**
 * Forward to the real object, resolving the connection on first access.
 *
 * Methods are bound to the underlying instance so drizzle's internal `this`
 * keeps working rather than being handed the proxy.
 */
function lazy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const real = resolve();
      const value = Reflect.get(real, property, real) as unknown;
      return typeof value === "function" ? value.bind(real) : value;
    },
  });
}

export const db = lazy<Database>(() => connection().db);
export const sqlClient = lazy<ReturnType<typeof postgres>>(() => connection().client);
export { schema };
