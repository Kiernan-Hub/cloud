// Orchestrating a check run and recording it.
//
// One run executes every enabled gate against one commit. The rules that
// matter:
//
//   - A failing gate does not abort the run. You want to know everything
//     that is broken, not just the first thing.
//   - A non-blocking gate is still executed and still recorded; it just does
//     not decide the run's verdict.
//   - A gate that could not execute at all is `error`, distinct from a gate
//     that ran and found a problem. Those need different responses.
//   - Every attempt is stored, including repeat runs of the same commit.
//     That repetition is the only way to see a flaky gate.
//   - A gate that was not run is recorded as `skipped` and makes the run
//     `partial`. A run that only checked lint must not be indistinguishable
//     from one that checked everything.
//   - A run always reaches a terminal status. A row left in `running` is
//     excluded from every statistic, so a crashed run would quietly erase
//     itself rather than report that it failed to finish.

import { and, desc, eq, lt, sql } from "drizzle-orm";
import { join } from "node:path";

import { db } from "@/lib/db";
import { checkRuns, gateResults } from "@/lib/db/schema";
import { logger } from "@/lib/log";
import { listGates, type Gate } from "@/modules/projects";
import {
  execute,
  extractMetric,
  readRepoState,
  shortSha,
  type GateStatus,
} from "@/modules/runner";

export type CheckRun = typeof checkRuns.$inferSelect;
export type GateResult = typeof gateResults.$inferSelect;

export type RunVerdict = "passed" | "partial" | "failed" | "error";

export type RunSummary = {
  runId: string;
  status: RunVerdict;
  commitSha: string;
  durationMs: number;
  skipped: string[];
  results: {
    gateKey: string;
    gateName: string;
    status: GateStatus;
    durationMs: number;
    blocking: boolean;
    metricValue: number | null;
    exitCode: number | null;
  }[];
};

/**
 * A run's verdict, from the gates that are allowed to decide it.
 *
 * Precedence is error > failed > partial > passed. A run that both failed and
 * skipped something is `failed`: the failure is the actionable news, and the
 * skipped gates are still listed on the run either way.
 */
function verdict(results: { status: GateStatus; blocking: boolean }[]): RunVerdict {
  const blocking = results.filter((result) => result.blocking);

  // A gate that could not run at all means the verdict is unknown, which is
  // worse than a clean failure — it is reported as `error` rather than being
  // quietly counted as a pass.
  if (blocking.some((result) => result.status === "error")) return "error";
  if (
    blocking.some((result) => result.status === "failed" || result.status === "timed_out")
  ) {
    return "failed";
  }
  // Nothing failed, but not everything was checked. Calling that `passed`
  // would claim more than the run actually established.
  if (results.some((result) => result.status === "skipped")) return "partial";
  return "passed";
}

export type RunOptions = {
  projectId: string;
  repoPath: string;
  trigger?: "manual" | "scheduled" | "watch";
  /** Run only these gate keys. Omit to run every enabled gate. */
  only?: string[];
  /**
   * Abort to stop the run. The in-flight gate's process group is killed and
   * the run is closed as `canceled` — it reached no verdict, which is neither
   * good news nor bad news about the gates.
   */
  signal?: AbortSignal;
  /** Called once the run row exists, so a caller can report which run died. */
  onRunStart?: (runId: string) => void;
  onGateStart?: (gate: Gate) => void;
  onGateFinish?: (gate: Gate, status: GateStatus, durationMs: number) => void;
};

export async function runChecks(options: RunOptions): Promise<RunSummary> {
  const repo = await readRepoState(options.repoPath);

  const allGates = await listGates(options.projectId, { enabledOnly: true });
  const selected = options.only
    ? allGates.filter((gate) => options.only!.includes(gate.key))
    : allGates;

  // Enabled gates the caller filtered out. A disabled gate is not skipped —
  // it is not part of the gate set at all — but one excluded by `--only` was
  // expected to run and did not, which is what makes the run partial.
  const skipped = allGates.filter((gate) => !selected.includes(gate));

  const [run] = await db
    .insert(checkRuns)
    .values({
      projectId: options.projectId,
      commitSha: repo.commitSha,
      commitSubject: repo.commitSubject,
      branch: repo.branch,
      dirty: repo.dirty,
      trigger: options.trigger ?? "manual",
      status: "running",
    })
    .returning();

  const runId = run!.id;
  options.onRunStart?.(runId);

  const runLogger = logger.withContext({
    run_id: runId,
    project_id: options.projectId,
    commit: shortSha(repo.commitSha),
  });

  runLogger.info("check run started", {
    gates: selected.length,
    skipped: skipped.length,
    dirty: repo.dirty,
  });

  const startedHr = process.hrtime.bigint();
  const summaries: RunSummary["results"] = [];

  try {
    for (const gate of selected) {
      options.onGateStart?.(gate);

      const cwd = gate.workingDir
        ? join(options.repoPath, gate.workingDir)
        : options.repoPath;

      const result = await execute({
        command: gate.command,
        cwd,
        timeoutSeconds: gate.timeoutSeconds,
        signal: options.signal,
      });

      // execute() does not resolve until the child is actually dead, so by
      // here the killed gate is gone rather than orphaned on the machine.
      if (options.signal?.aborted) throw new RunCanceled();

      const combinedOutput = `${result.stdoutTail}\n${result.stderrTail}`;
      const metricValue = gate.metricPattern
        ? extractMetric(combinedOutput, gate.metricPattern)
        : null;

      await db.insert(gateResults).values({
        runId,
        gateId: gate.id,
        gateKey: gate.key,
        projectId: options.projectId,
        commitSha: repo.commitSha,
        status: result.status,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        stdoutTail: result.stdoutTail || null,
        stderrTail: result.stderrTail || null,
        truncated: result.truncated,
        metricValue: metricValue === null ? null : String(metricValue),
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
      });

      summaries.push({
        gateKey: gate.key,
        gateName: gate.name,
        status: result.status,
        durationMs: result.durationMs,
        blocking: gate.blocking,
        metricValue,
        exitCode: result.exitCode,
      });

      const level = result.status === "passed" ? "info" : "warn";
      runLogger[level]("gate finished", {
        gate: gate.key,
        status: result.status,
        duration_ms: result.durationMs,
        exit_code: result.exitCode,
        ...(metricValue !== null ? { [gate.metricName ?? "metric"]: metricValue } : {}),
      });

      options.onGateFinish?.(gate, result.status, result.durationMs);
    }

    // Skipped gates are recorded, not omitted. A run that checked three of
    // five gates should say which two it did not check, rather than looking
    // like a project that only ever had three.
    const now = new Date();
    for (const gate of skipped) {
      await db.insert(gateResults).values({
        runId,
        gateId: gate.id,
        gateKey: gate.key,
        projectId: options.projectId,
        commitSha: repo.commitSha,
        status: "skipped",
        exitCode: null,
        durationMs: 0,
        truncated: false,
        metricValue: null,
        startedAt: now,
        finishedAt: now,
      });

      summaries.push({
        gateKey: gate.key,
        gateName: gate.name,
        status: "skipped",
        durationMs: 0,
        blocking: gate.blocking,
        metricValue: null,
        exitCode: null,
      });
    }

    const durationMs = Number((process.hrtime.bigint() - startedHr) / 1_000_000n);
    const status = verdict(summaries);

    await db
      .update(checkRuns)
      .set({ status, finishedAt: new Date(), durationMs })
      .where(eq(checkRuns.id, runId));

    runLogger.info("check run finished", { status, duration_ms: durationMs });

    return {
      runId,
      status,
      commitSha: repo.commitSha,
      durationMs,
      skipped: skipped.map((gate) => gate.key),
      results: summaries,
    };
  } catch (error: unknown) {
    // The run did not reach a verdict. Leaving the row in `running` would
    // drop it out of every statistic, so it is closed either way — but a run
    // we chose to stop is `canceled`, not `error`. Nothing about the gates
    // was learned, and calling that a failure invents bad news the same way
    // calling it a pass would invent good news.
    const canceled = error instanceof RunCanceled;
    const durationMs = Number((process.hrtime.bigint() - startedHr) / 1_000_000n);
    await db
      .update(checkRuns)
      .set({
        status: canceled ? "canceled" : "error",
        finishedAt: new Date(),
        durationMs,
      })
      .where(eq(checkRuns.id, runId));

    if (canceled) {
      runLogger.warn("check run canceled", { duration_ms: durationMs });
    } else {
      runLogger.error("check run aborted", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

/** Thrown when a run is stopped through its `signal` rather than failing. */
export class RunCanceled extends Error {
  constructor() {
    super("run canceled");
    this.name = "RunCanceled";
  }
}

/**
 * Close runs abandoned by a process that died without cleaning up — a SIGKILL
 * or a lost machine, where no handler got to run.
 *
 * The age bound is what keeps this from closing a run that is legitimately
 * still going: it must be older than any gate could possibly still be
 * running for.
 */
export async function reconcileAbandonedRuns(olderThanMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const rows = await db
    .update(checkRuns)
    .set({
      status: "canceled",
      finishedAt: sql`COALESCE(${checkRuns.finishedAt}, now())`,
    })
    .where(and(eq(checkRuns.status, "running"), lt(checkRuns.startedAt, cutoff)))
    .returning({ id: checkRuns.id });

  if (rows.length > 0) {
    logger.warn("closed abandoned runs", { count: rows.length });
  }
  return rows.length;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listRuns(projectId: string, limit = 25): Promise<CheckRun[]> {
  return db
    .select()
    .from(checkRuns)
    .where(eq(checkRuns.projectId, projectId))
    .orderBy(desc(checkRuns.startedAt))
    .limit(Math.min(Math.max(1, limit), 200));
}

export async function getRun(
  runId: string,
): Promise<{ run: CheckRun; results: GateResult[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return null;

  const [run] = await db.select().from(checkRuns).where(eq(checkRuns.id, runId)).limit(1);
  if (!run) return null;

  const results = await db
    .select()
    .from(gateResults)
    .where(eq(gateResults.runId, runId))
    .orderBy(gateResults.startedAt);

  return { run, results };
}
