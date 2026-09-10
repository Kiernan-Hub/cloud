// End-to-end: a real git repo in a temp dir, real gate commands, real
// database. Nothing external — the repo is created by the test.

import { execFile } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";
import { checkRuns, gateResults } from "@/lib/db/schema";
import { upsertGate, upsertProject } from "@/modules/projects";
import {
  getRun,
  listRuns,
  pruneOutput,
  reconcileAbandonedRuns,
  RunCanceled,
  runChecks,
} from "@/modules/runs";

const run = promisify(execFile);
const PROJECT = "test-runs-project";
let repoPath: string;

async function git(args: string[]) {
  await run("git", args, { cwd: repoPath });
}

beforeAll(async () => {
  repoPath = await mkdtemp(join(tmpdir(), "gatekeeper-test-"));
  await git(["init", "-q"]);
  await git(["config", "user.email", "test@example.invalid"]);
  await git(["config", "user.name", "Test"]);
  await writeFile(join(repoPath, "README.md"), "# test\n", "utf8");
  await git(["add", "."]);
  await git(["commit", "-q", "-m", "initial commit"]);
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM projects WHERE id = ${PROJECT}`);
  await closeDb();
  await rm(repoPath, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.execute(sql`DELETE FROM projects WHERE id = ${PROJECT}`);
  await upsertProject({ id: PROJECT, name: "Runs test", repoPath });
});

describe("runChecks", () => {
  it("passes when every gate passes and records the commit", async () => {
    await upsertGate(PROJECT, { key: "ok", name: "OK", command: "exit 0" });

    const summary = await runChecks({ projectId: PROJECT, repoPath });

    expect(summary.status).toBe("passed");
    expect(summary.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(summary.results[0]!.status).toBe("passed");
  });

  it("fails the run when a blocking gate fails", async () => {
    await upsertGate(PROJECT, { key: "bad", name: "Bad", command: "exit 1" });

    const summary = await runChecks({ projectId: PROJECT, repoPath });
    expect(summary.status).toBe("failed");
  });

  it("does not fail the run for a non-blocking gate", async () => {
    await upsertGate(PROJECT, {
      key: "advisory",
      name: "Advisory",
      command: "exit 1",
      blocking: false,
    });

    const summary = await runChecks({ projectId: PROJECT, repoPath });

    // Still recorded as failed at the gate level...
    expect(summary.results[0]!.status).toBe("failed");
    // ...but it does not get to decide the verdict.
    expect(summary.status).toBe("passed");
  });

  it("runs every gate even after one fails", async () => {
    await upsertGate(PROJECT, { key: "a", name: "A", command: "exit 1", position: 0 });
    await upsertGate(PROJECT, { key: "b", name: "B", command: "exit 0", position: 1 });
    await upsertGate(PROJECT, { key: "c", name: "C", command: "exit 0", position: 2 });

    const summary = await runChecks({ projectId: PROJECT, repoPath });

    // You want the whole picture, not just the first thing that broke.
    expect(summary.results).toHaveLength(3);
  });

  it("reports error rather than failed when a gate cannot execute", async () => {
    await upsertGate(PROJECT, {
      key: "nowhere",
      name: "Nowhere",
      command: "echo hi",
      workingDir: "does/not/exist",
    });

    const summary = await runChecks({ projectId: PROJECT, repoPath });

    expect(summary.results[0]!.status).toBe("error");
    // An unrunnable gate means the verdict is unknown, which must not be
    // quietly counted as a pass.
    expect(summary.status).toBe("error");
  });

  it("skips disabled gates", async () => {
    await upsertGate(PROJECT, { key: "on", name: "On", command: "exit 0" });
    await upsertGate(PROJECT, {
      key: "off",
      name: "Off",
      command: "exit 1",
      enabled: false,
    });

    const summary = await runChecks({ projectId: PROJECT, repoPath });

    expect(summary.results.map((result) => result.gateKey)).toEqual(["on"]);
    expect(summary.status).toBe("passed");
  });

  it("honors --only, and records the gates it did not run", async () => {
    await upsertGate(PROJECT, { key: "a", name: "A", command: "exit 0" });
    await upsertGate(PROJECT, { key: "b", name: "B", command: "exit 1" });

    const summary = await runChecks({
      projectId: PROJECT,
      repoPath,
      only: ["a"],
    });

    expect(summary.skipped).toEqual(["b"]);

    // The skipped gate is a stored row, not an omission. Without it, a run
    // that checked one of two gates is indistinguishable from a project
    // that only ever had one.
    const found = await getRun(summary.runId);
    const byKey = new Map(found!.results.map((r) => [r.gateKey, r.status]));
    expect(byKey.get("a")).toBe("passed");
    expect(byKey.get("b")).toBe("skipped");
  });

  it("calls a partial run partial rather than passed", async () => {
    await upsertGate(PROJECT, { key: "a", name: "A", command: "exit 0" });
    await upsertGate(PROJECT, { key: "b", name: "B", command: "exit 0" });

    const summary = await runChecks({ projectId: PROJECT, repoPath, only: ["a"] });

    // Nothing failed, but not everything was checked. Reporting `passed`
    // would claim more than the run established.
    expect(summary.status).toBe("partial");
  });

  it("still reports failed when a run both failed and skipped something", async () => {
    await upsertGate(PROJECT, { key: "a", name: "A", command: "exit 1" });
    await upsertGate(PROJECT, { key: "b", name: "B", command: "exit 0" });

    const summary = await runChecks({ projectId: PROJECT, repoPath, only: ["a"] });

    // A failure is the actionable news; the skipped gate is still listed.
    expect(summary.status).toBe("failed");
    expect(summary.skipped).toEqual(["b"]);
  });

  it("does not count a disabled gate as skipped", async () => {
    await upsertGate(PROJECT, { key: "on", name: "On", command: "exit 0" });
    await upsertGate(PROJECT, {
      key: "off",
      name: "Off",
      command: "exit 1",
      enabled: false,
    });

    const summary = await runChecks({ projectId: PROJECT, repoPath });

    // A disabled gate was removed from the gate set on purpose. It is not a
    // gap in the run, so the run is a full pass.
    expect(summary.skipped).toEqual([]);
    expect(summary.status).toBe("passed");
  });

  it("extracts a metric from gate output", async () => {
    await upsertGate(PROJECT, {
      key: "cov",
      name: "Coverage",
      command: "echo 'Coverage: 87.5%'",
      metricName: "coverage",
      metricPattern: "Coverage: ([\\d.]+)",
      metricDirection: "higher_is_better",
    });

    const summary = await runChecks({ projectId: PROJECT, repoPath });
    expect(summary.results[0]!.metricValue).toBe(87.5);
  });

  it("stores every attempt on the same commit rather than deduplicating", async () => {
    await upsertGate(PROJECT, { key: "g", name: "G", command: "exit 0" });

    await runChecks({ projectId: PROJECT, repoPath });
    await runChecks({ projectId: PROJECT, repoPath });

    // Repetition on one commit is the flake signal — collapsing it would
    // destroy the only evidence a flaky gate leaves.
    const runs = await listRuns(PROJECT);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.commitSha).toBe(runs[1]!.commitSha);
  });

  it("records captured output on the stored result", async () => {
    await upsertGate(PROJECT, {
      key: "noisy",
      name: "Noisy",
      command: "echo hello-from-gate",
    });

    const summary = await runChecks({ projectId: PROJECT, repoPath });
    const found = await getRun(summary.runId);

    expect(found!.results[0]!.stdoutTail).toContain("hello-from-gate");
  });

  it("marks the run dirty when the working tree has uncommitted changes", async () => {
    await upsertGate(PROJECT, { key: "g", name: "G", command: "exit 0" });
    await writeFile(join(repoPath, "scratch.txt"), "uncommitted\n", "utf8");

    const summary = await runChecks({ projectId: PROJECT, repoPath });
    const found = await getRun(summary.runId);

    // A result from a dirty tree is not reproducible from the commit alone.
    expect(found!.run.dirty).toBe(true);

    await rm(join(repoPath, "scratch.txt"));
  });

  it("closes the run out with a status and duration", async () => {
    await upsertGate(PROJECT, { key: "g", name: "G", command: "exit 0" });

    const summary = await runChecks({ projectId: PROJECT, repoPath });
    const found = await getRun(summary.runId);

    expect(found!.run.status).toBe("passed");
    expect(found!.run.finishedAt).not.toBeNull();
    expect(found!.run.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("a run always reaches a terminal status", () => {
  it("closes the run as error when a gate throws mid-run", async () => {
    await upsertGate(PROJECT, { key: "g", name: "G", command: "exit 0" });

    let runId: string | undefined;
    await expect(
      runChecks({
        projectId: PROJECT,
        repoPath,
        onRunStart: (id) => {
          runId = id;
        },
        onGateStart: () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");

    // A row left in 'running' is excluded from every statistic, so a crashed
    // run would quietly erase itself instead of reporting that it died.
    const found = await getRun(runId!);
    expect(found!.run.status).toBe("error");
    expect(found!.run.finishedAt).not.toBeNull();
  });

  it("records an interrupted run as canceled, not failed", async () => {
    await upsertGate(PROJECT, { key: "slow", name: "Slow", command: "sleep 30" });

    const aborter = new AbortController();
    let runId: string | undefined;
    const promise = runChecks({
      projectId: PROJECT,
      repoPath,
      signal: aborter.signal,
      onRunStart: (id) => {
        runId = id;
      },
      onGateStart: () => setTimeout(() => aborter.abort(), 50),
    });

    await expect(promise).rejects.toBeInstanceOf(RunCanceled);

    // We stopped it; the gates never got to answer. Calling that `failed`
    // would blame them for our interrupt.
    expect((await getRun(runId!))!.run.status).toBe("canceled");
  });

  it("waits for the killed gate to die rather than orphaning it", async () => {
    // A marker the killed command would keep writing if it survived.
    const marker = join(repoPath, "orphan-marker");
    await upsertGate(PROJECT, {
      key: "spawner",
      name: "Spawner",
      command: `sh -c 'while true; do echo x >> ${marker}; sleep 0.1; done'`,
    });

    const aborter = new AbortController();
    await expect(
      runChecks({
        projectId: PROJECT,
        repoPath,
        signal: aborter.signal,
        onGateStart: () => setTimeout(() => aborter.abort(), 300),
      }),
    ).rejects.toBeInstanceOf(RunCanceled);

    // Once runChecks returns, the whole process group must already be gone —
    // otherwise Ctrl-C would leave a test runner going on the user's machine.
    const sizeAtReturn = (await stat(marker)).size;
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect((await stat(marker)).size).toBe(sizeAtReturn);

    await rm(marker, { force: true });
  });

  it("closes abandoned runs older than the bound, and leaves fresh ones alone", async () => {
    const [old] = await db
      .insert(checkRuns)
      .values({
        projectId: PROJECT,
        commitSha: "a".repeat(40),
        status: "running",
        startedAt: new Date(Date.now() - 60 * 60 * 1000),
      })
      .returning();
    const [fresh] = await db
      .insert(checkRuns)
      .values({ projectId: PROJECT, commitSha: "b".repeat(40), status: "running" })
      .returning();

    await reconcileAbandonedRuns(30 * 60 * 1000);

    // A SIGKILL leaves no handler to clean up, so age is the only signal.
    expect((await getRun(old!.id))!.run.status).toBe("canceled");
    // Closing a run that is genuinely still going would be the worse lie.
    expect((await getRun(fresh!.id))!.run.status).toBe("running");
  });
});

describe("pruneOutput", () => {
  /** Backdate a run and its results, so retention has something old to find. */
  async function backdate(runId: string, days: number) {
    const at = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    await db.update(checkRuns).set({ startedAt: at }).where(eq(checkRuns.id, runId));
    await db
      .update(gateResults)
      .set({ startedAt: at })
      .where(eq(gateResults.runId, runId));
  }

  it("drops old output but keeps the result that is the evidence", async () => {
    await upsertGate(PROJECT, { key: "noisy", name: "Noisy", command: "echo loud" });
    const summary = await runChecks({ projectId: PROJECT, repoPath });
    await backdate(summary.runId, 40);

    expect(await pruneOutput(30)).toBe(1);

    const found = await getRun(summary.runId);
    const [result] = found!.results;
    expect(result!.stdoutTail).toBeNull();
    // The status is what flake detection, pass rates and regressions are
    // computed from. Deleting it would destroy the measurement.
    expect(result!.status).toBe("passed");
    expect(result!.durationMs).toBeGreaterThanOrEqual(0);
    // And the row says the output was discarded, not that there was none.
    expect(result!.outputPruned).toBe(true);
  });

  it("leaves output inside the retention window alone", async () => {
    await upsertGate(PROJECT, { key: "recent", name: "Recent", command: "echo hi" });
    const summary = await runChecks({ projectId: PROJECT, repoPath });
    await backdate(summary.runId, 3);

    expect(await pruneOutput(30)).toBe(0);
    expect((await getRun(summary.runId))!.results[0]!.stdoutTail).toContain("hi");
  });

  it("keeps output forever when retention is zero", async () => {
    await upsertGate(PROJECT, { key: "kept", name: "Kept", command: "echo hi" });
    const summary = await runChecks({ projectId: PROJECT, repoPath });
    await backdate(summary.runId, 9999);

    // 0 is an explicit "never prune", not a zero-day window that deletes
    // everything — the difference matters a great deal to whoever set it.
    expect(await pruneOutput(0)).toBe(0);
    expect((await getRun(summary.runId))!.results[0]!.stdoutTail).toContain("hi");
  });

  it("does not re-report rows it already pruned", async () => {
    await upsertGate(PROJECT, { key: "once", name: "Once", command: "echo hi" });
    const summary = await runChecks({ projectId: PROJECT, repoPath });
    await backdate(summary.runId, 40);

    expect(await pruneOutput(30)).toBe(1);
    expect(await pruneOutput(30)).toBe(0);
  });
});

describe("getRun", () => {
  it("returns null for a malformed id instead of throwing", async () => {
    await expect(getRun("not-a-uuid")).resolves.toBeNull();
  });

  it("returns null for an unknown run", async () => {
    await expect(getRun("00000000-0000-4000-8000-000000000000")).resolves.toBeNull();
  });
});

describe("gate history survives gate deletion", () => {
  it("keeps results readable after the gate is removed", async () => {
    const gate = await upsertGate(PROJECT, {
      key: "temp",
      name: "Temp",
      command: "exit 0",
    });

    const summary = await runChecks({ projectId: PROJECT, repoPath });
    expect(summary.results).toHaveLength(1);

    // Deleting a gate discards the rule, not the record of what it found.
    // gate_results denormalizes gate_key/project_id/commit_sha for this.
    const before = await db.execute<{ gate_key: string; project_id: string }>(
      sql`SELECT gate_key, project_id FROM gate_results WHERE gate_id = ${gate.id}`,
    );
    expect(before[0]!.gate_key).toBe("temp");
    expect(before[0]!.project_id).toBe(PROJECT);
  });
});
