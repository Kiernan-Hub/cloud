// Actively hunting for a flaky gate.
//
// Everywhere else, flakiness is observed *passively* — you happen to run the
// same commit twice and the results disagree. This runs a gate deliberately,
// N times, on one commit, to find out.
//
// The honest framing matters here, and is enforced in the result type:
//
//   - Observing a disagreement PROVES flakiness. One pass and one fail on
//     identical input is conclusive: the gate is not a function of the code.
//   - Observing agreement proves nothing. Twenty passes cannot rule out a
//     1-in-100 flake. So the result says `flakinessObserved: false`, never
//     "reliable", and reports the attempt count so the reader can judge the
//     strength of the evidence themselves.

import { eq } from "drizzle-orm";
import { join } from "node:path";

import { db } from "@/lib/db";
import { checkRuns, gateResults } from "@/lib/db/schema";
import { logger } from "@/lib/log";
import { listGates, type Gate } from "@/modules/projects";
import { execute, readRepoState, shortSha, type GateStatus } from "@/modules/runner";

export type FlakeAttempt = {
  attempt: number;
  status: GateStatus;
  durationMs: number;
  exitCode: number | null;
  runId: string;
};

export type FlakeProbe = {
  gateKey: string;
  gateName: string;
  attempts: FlakeAttempt[];
  passed: number;
  failed: number;
  /**
   * True only when the gate produced BOTH a pass and a non-pass on this one
   * commit. That is conclusive. False means "not seen in this many attempts",
   * which is not the same as reliable — read `attempts.length` alongside it.
   */
  flakinessObserved: boolean;
  medianDurationMs: number;
};

export type FlakeProbeResult = {
  commitSha: string;
  dirty: boolean;
  probes: FlakeProbe[];
};

export class NoSuchGateError extends Error {
  constructor(keys: string[], available: string[]) {
    super(
      `No gate matching ${keys.join(", ")}. Available: ${available.join(", ") || "(none)"}`,
    );
    this.name = "NoSuchGateError";
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}

export type ProbeOptions = {
  projectId: string;
  repoPath: string;
  /** Gate keys to probe. Omit to probe every enabled gate. */
  gateKeys?: string[];
  attempts: number;
  onAttempt?: (gate: Gate, attempt: FlakeAttempt) => void;
  /**
   * Stop probing a gate as soon as flakiness is proven. On by default:
   * once you have a disagreement the question is answered, and further
   * attempts only cost time.
   */
  stopWhenProven?: boolean;
};

export async function probeFlakiness(options: ProbeOptions): Promise<FlakeProbeResult> {
  const attempts = Math.min(Math.max(2, options.attempts), 50);
  const repo = await readRepoState(options.repoPath);
  const stopWhenProven = options.stopWhenProven ?? true;

  const allGates = await listGates(options.projectId, { enabledOnly: true });
  const selected = options.gateKeys
    ? allGates.filter((gate) => options.gateKeys!.includes(gate.key))
    : allGates;

  if (selected.length === 0) {
    throw new NoSuchGateError(
      options.gateKeys ?? ["(any enabled gate)"],
      allGates.map((gate) => gate.key),
    );
  }

  const probeLogger = logger.withContext({
    project_id: options.projectId,
    commit: shortSha(repo.commitSha),
  });

  probeLogger.info("flake probe started", {
    gates: selected.map((gate) => gate.key),
    attempts,
  });

  const probes: FlakeProbe[] = [];

  for (const gate of selected) {
    const record: FlakeAttempt[] = [];

    for (let attempt = 1; attempt <= attempts; attempt++) {
      // Each attempt is a real run, stored like any other. That is what makes
      // the probe visible to the passive flakiness analysis afterwards — the
      // probe does not maintain a separate, privileged notion of truth.
      const [run] = await db
        .insert(checkRuns)
        .values({
          projectId: options.projectId,
          commitSha: repo.commitSha,
          commitSubject: repo.commitSubject,
          branch: repo.branch,
          dirty: repo.dirty,
          trigger: "flake",
          status: "running",
        })
        .returning({ id: checkRuns.id });

      const runId = run!.id;
      const cwd = gate.workingDir
        ? join(options.repoPath, gate.workingDir)
        : options.repoPath;

      const result = await execute({
        command: gate.command,
        cwd,
        timeoutSeconds: gate.timeoutSeconds,
      });

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
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
      });

      await db
        .update(checkRuns)
        .set({
          status: result.status === "passed" ? "passed" : "failed",
          finishedAt: new Date(),
          durationMs: result.durationMs,
        })
        .where(eq(checkRuns.id, runId));

      const entry: FlakeAttempt = {
        attempt,
        status: result.status,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        runId,
      };
      record.push(entry);
      options.onAttempt?.(gate, entry);

      const sawPass = record.some((item) => item.status === "passed");
      const sawNonPass = record.some((item) => item.status !== "passed");

      if (stopWhenProven && sawPass && sawNonPass) {
        probeLogger.warn("flakiness proven", {
          gate: gate.key,
          after_attempts: attempt,
        });
        break;
      }
    }

    const passed = record.filter((item) => item.status === "passed").length;

    probes.push({
      gateKey: gate.key,
      gateName: gate.name,
      attempts: record,
      passed,
      failed: record.length - passed,
      flakinessObserved: passed > 0 && passed < record.length,
      medianDurationMs: median(record.map((item) => item.durationMs)),
    });
  }

  probeLogger.info("flake probe finished", {
    flaky: probes.filter((probe) => probe.flakinessObserved).map((p) => p.gateKey),
  });

  return { commitSha: repo.commitSha, dirty: repo.dirty, probes };
}
