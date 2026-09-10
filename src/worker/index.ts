// Worker: runs scheduled checks for the projects that asked for them.
//
// Deliberately simple. Unlike a hosted CI, there is nothing to poll and no
// queue to drain — the worker's job is to run the gates on a cadence so
// slow-moving regressions (a dependency bump, a clock change, a growing
// bundle) get caught even when nobody pushed anything.
//
// The tick interval is how often the worker *looks*, not how often it runs
// anything. Each project sets its own cadence in its gatekeeper.json, and a
// project that set none is never run here: the worker executes the repo's own
// commands on this machine, so it does that only where the repo asked.
//
// A project whose run throws does not stop the others, and does not stop the
// loop.

import { getConfig } from "@/lib/config";
import { closeDb } from "@/lib/db";
import { logger } from "@/lib/log";
import { projectsDueForRun } from "@/modules/projects";
import { NotAGitRepoError } from "@/modules/runner";
import { pruneOutput, reconcileAbandonedRuns, runChecks } from "@/modules/runs";

// How old an unfinished run must be before the worker declares it abandoned.
// A SIGKILL leaves no handler to clean up, so those rows can only be found by
// age. The bound is deliberately far longer than any plausible gate suite:
// closing a run that is genuinely still going would be a worse lie than
// leaving a dead one open for a few hours.
const ABANDONED_AFTER_MS = 12 * 60 * 60 * 1000;

let shuttingDown = false;
let activeWork: Promise<unknown> = Promise.resolve();

// Projects whose repo we could not find, so the same "it is still gone" is
// not reported on every tick.
//
// A vanished repo never records a run, so the project stays due forever and
// is retried every tick — at the default cadence that is a identical error
// line every minute, indefinitely, for a directory that is not coming back.
// The condition still matters, so it is reported once when it starts and once
// when it ends, rather than either spammed or swallowed.
const unreachable = new Set<string>();

async function tick(): Promise<void> {
  await reconcileAbandonedRuns(ABANDONED_AFTER_MS);
  // Housekeeping, not deletion: the results stay, only their captured output
  // ages out. See pruneOutput for why the two are treated differently.
  await pruneOutput(getConfig().OUTPUT_RETENTION_DAYS);

  const due = await projectsDueForRun();
  if (due.length === 0) {
    logger.debug("tick: nothing due");
    return;
  }

  for (const project of due) {
    if (shuttingDown) break;
    try {
      const summary = await runChecks({
        projectId: project.id,
        repoPath: project.repoPath,
        trigger: "scheduled",
      });
      if (unreachable.delete(project.id)) {
        logger.info("repository is back", {
          project_id: project.id,
          repo_path: project.repoPath,
        });
      }

      logger.info("scheduled run complete", {
        project_id: project.id,
        status: summary.status,
        schedule_minutes: project.scheduleMinutes,
      });
    } catch (error: unknown) {
      // One unreachable repo must not stop the rest.
      if (error instanceof NotAGitRepoError) {
        // Deleted or moved, most likely. Say so once and stay quiet until
        // something changes — either it comes back, or `gk forget` drops it.
        if (!unreachable.has(project.id)) {
          unreachable.add(project.id);
          logger.warn("repository not found — skipping until it returns", {
            project_id: project.id,
            repo_path: project.repoPath,
          });
        }
        continue;
      }

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
  await closeDb();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main().catch(async (error: unknown) => {
  logger.error("worker crashed", {
    error: error instanceof Error ? error.message : String(error),
  });
  await closeDb();
  process.exit(1);
});
