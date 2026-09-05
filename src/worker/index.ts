// Worker entrypoint: the scheduler loop from ADR 0004.
//
// Runs as a separate process from the web app, sharing the same codebase.
// Start with `npm run worker`.

import { getConfig } from "@/lib/config";
import { sqlClient } from "@/lib/db";
import { logger } from "@/lib/log";
import { claimDueSources, defaultHandler, processSource } from "@/modules/ingestion";

let shuttingDown = false;
let activeWork: Promise<unknown> = Promise.resolve();

async function tick(): Promise<void> {
  const sources = await claimDueSources();
  if (sources.length === 0) {
    logger.debug("tick: no sources due");
    return;
  }

  logger.info("tick: claimed sources", { count: sources.length });
  for (const source of sources) {
    if (shuttingDown) break;
    await processSource(source, defaultHandler);
  }
}

async function main(): Promise<void> {
  const { WORKER_TICK_SECONDS } = getConfig();
  logger.info("worker started", { tick_seconds: WORKER_TICK_SECONDS });

  while (!shuttingDown) {
    activeWork = tick().catch((error: unknown) => {
      // A failure in the tick itself (e.g. database blip) must not kill the
      // loop — log it and try again next tick.
      logger.error("tick failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    await activeWork;

    if (shuttingDown) break;
    await new Promise((resolve) => setTimeout(resolve, WORKER_TICK_SECONDS * 1000));
  }
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("worker shutting down", { signal });
  // Let in-flight work finish so a run is never orphaned in 'running'.
  await activeWork;
  await sqlClient.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main().catch(async (error: unknown) => {
  logger.error("worker crashed", {
    error: error instanceof Error ? error.message : String(error),
  });
  await sqlClient.end();
  process.exit(1);
});
