import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { getConfig } from "@/lib/config";
import { logger } from "@/lib/log";

async function main() {
  const client = postgres(getConfig().DATABASE_URL, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    logger.info("migrations applied");
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  logger.error("migration failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
