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

import { stat } from "node:fs/promises";

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

// Projects whose repo we could not reach, so the same "it is still gone" is
// not reported on every tick.
//
// A vanished repo never records a run, so the project stays due forever and
// is retried every tick — at the default cadence that is an identical error
// line every minute, indefinitely, for a directory that is not coming back.
//
// Suppressing the log must not make the condition invisible, which would be
// the same failure this tool exists to prevent. The dashboard reads the path
// directly and says when a project's repo is not where it claims to be, so
// the standing signal lives there; this set only stops the *log* repeating.
const unreachable = new Set<string>();

/** Whether the repo directory is still where the project says it is. */
async function repoPathExists(repoPath: string): Promise<boolean> {
  try {
    return (await stat(repoPath)).isDirectory();
  } catch {
    return false;
  }
}

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

    // Checked before running rather than inferred from a git failure. It
    // makes the skip actually cheap — no subprocess per tick for a directory
    // that is not there — and it keeps "the repo is gone" distinct from "git
    // failed", which are different problems with the same exception.
    if (!(await repoPathExists(project.repoPath))) {
      if (!unreachable.has(project.id)) {
        unreachable.add(project.id);
        logger.warn("repository directory is gone — skipping until it returns", {
          project_id: project.id,
          repo_path: project.repoPath,
        });
      }
      continue;
    }

    try {
      const summary = await runChecks({
        projectId: project.id,
        repoPath: project.repoPath,
        trigger: "scheduled",
      });
      if (unreachable.delete(project.id)) {
        logger.info("repository directory is back", {
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
        // The directory is there but git could not read it: `.git` removed,
        // a permissions problem, or no git binary. Not the same as the repo
        // being gone, so it says so — and it is not suppressed, because
        // unlike a deleted directory these are usually fixable and worth
        // seeing again.
        logger.error("directory is not a readable git repository", {
          project_id: project.id,
          repo_path: project.repoPath,
        });
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
