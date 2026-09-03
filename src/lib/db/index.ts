import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getConfig } from "@/lib/config";

import * as schema from "./schema";

// One pooled client per process. Next.js dev-mode module reloading would
// otherwise open a new pool on every edit, so the client is cached on
// globalThis in development only.
const globalForDb = globalThis as unknown as {
  hoosradarSql?: ReturnType<typeof postgres>;
};

function createClient() {
  return postgres(getConfig().DATABASE_URL, { max: 10 });
}

const client =
  globalForDb.hoosradarSql ??
  (process.env.NODE_ENV === "production"
    ? createClient()
    : (globalForDb.hoosradarSql = createClient()));

export const db = drizzle(client, { schema });
export { client as sqlClient, schema };
