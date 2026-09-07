// Worker: runs scheduled checks for every registered project.
//
// Deliberately simple. Unlike a hosted CI, there is nothing to poll and no
// queue to drain — the worker's job is to run the gates on a cadence so
// slow-moving regressions (a dependency bump, a clock change, a growing
// bundle) get caught even when nobody pushed anything.
//
// A project whose run throws does not stop the others, and does not stop the
// loop.

import { getConfig } from "@/lib/config";
import { sqlClient } from "@/lib/db";
import { logger } from "@/lib/log";
import { listProjects } from "@/modules/projects";
import { runChecks } from "@/modules/runs";

let shuttingDown = false;
let activeWork: Promise<unknown> = Promise.resolve();

async function tick(): Promise<void> {
  const projects = await listProjects();
  if (projects.length === 0) {
    logger.debug("tick: no projects registered");
    return;
  }

  for (const project of projects) {
    if (shuttingDown) break;
    try {
      const summary = await runChecks({
        projectId: project.id,
        repoPath: project.repoPath,
        trigger: "scheduled",
      });
      logger.info("scheduled run complete", {
        project_id: project.id,
        status: summary.status,
      });
    } catch (error: unknown) {
      // One unreachable repo must not stop the rest.
      logger.error("scheduled run failed", {
        project_id: project.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function main(): Promise<void> {
  const { WORKER_TICK_SECONDS } = getConfig();
  logger.info("worker started", { tick_seconds: WORKER_TICK_SECONDS });

  while (!shuttingDown) {
    activeWork = tick().catch((error: unknown) => {
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
  // Let the in-flight run finish so no check_run is orphaned in 'running'.
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
