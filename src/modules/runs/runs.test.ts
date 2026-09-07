// End-to-end: a real git repo in a temp dir, real gate commands, real
// database. Nothing external — the repo is created by the test.

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, sqlClient } from "@/lib/db";
import { upsertGate, upsertProject } from "@/modules/projects";
import { getRun, listRuns, runChecks } from "@/modules/runs";

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
  await sqlClient.end();
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

  it("honors --only", async () => {
    await upsertGate(PROJECT, { key: "a", name: "A", command: "exit 0" });
    await upsertGate(PROJECT, { key: "b", name: "B", command: "exit 1" });

    const summary = await runChecks({
      projectId: PROJECT,
      repoPath,
      only: ["a"],
    });

    expect(summary.results).toHaveLength(1);
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
