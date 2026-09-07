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

import { desc, eq } from "drizzle-orm";
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

export type RunSummary = {
  runId: string;
  status: "passed" | "failed" | "error";
  commitSha: string;
  durationMs: number;
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

/** A run's verdict, from the gates that are allowed to decide it. */
function verdict(
  results: { status: GateStatus; blocking: boolean }[],
): "passed" | "failed" | "error" {
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
  return "passed";
}

export type RunOptions = {
  projectId: string;
  repoPath: string;
  trigger?: "manual" | "scheduled" | "watch";
  /** Run only these gate keys. Omit to run every enabled gate. */
  only?: string[];
  onGateStart?: (gate: Gate) => void;
  onGateFinish?: (gate: Gate, status: GateStatus, durationMs: number) => void;
};

export async function runChecks(options: RunOptions): Promise<RunSummary> {
  const repo = await readRepoState(options.repoPath);

  const allGates = await listGates(options.projectId, { enabledOnly: true });
  const selected = options.only
    ? allGates.filter((gate) => options.only!.includes(gate.key))
    : allGates;

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
  const runLogger = logger.withContext({
    run_id: runId,
    project_id: options.projectId,
    commit: shortSha(repo.commitSha),
  });

  runLogger.info("check run started", {
    gates: selected.length,
    dirty: repo.dirty,
  });

  const startedHr = process.hrtime.bigint();
  const summaries: RunSummary["results"] = [];

  for (const gate of selected) {
    options.onGateStart?.(gate);

    const cwd = gate.workingDir
      ? join(options.repoPath, gate.workingDir)
      : options.repoPath;

    const result = await execute({
      command: gate.command,
      cwd,
      timeoutSeconds: gate.timeoutSeconds,
    });

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
    results: summaries,
  };
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

export { NoSuchGateError, probeFlakiness } from "./flake";
export type { FlakeAttempt, FlakeProbe, FlakeProbeResult, ProbeOptions } from "./flake";
