import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, sqlClient } from "@/lib/db";
import { gateFlakiness } from "@/modules/analysis";
import { upsertGate, upsertProject } from "@/modules/projects";
import { listRuns, NoSuchGateError, probeFlakiness } from "@/modules/runs";

const run = promisify(execFile);
const PROJECT = "test-flake-project";
let repoPath: string;

beforeAll(async () => {
  repoPath = await mkdtemp(join(tmpdir(), "gatekeeper-flake-"));
  const git = (args: string[]) => run("git", args, { cwd: repoPath });
  await git(["init", "-q"]);
  await git(["config", "user.email", "test@example.invalid"]);
  await git(["config", "user.name", "Test"]);
  await writeFile(join(repoPath, "README.md"), "# flake test\n", "utf8");
  await git(["add", "."]);
  await git(["commit", "-q", "-m", "initial"]);
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM projects WHERE id = ${PROJECT}`);
  await sqlClient.end();
  await rm(repoPath, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.execute(sql`DELETE FROM projects WHERE id = ${PROJECT}`);
  await upsertProject({ id: PROJECT, name: "Flake test", repoPath });
});

/**
 * A genuinely flaky command: it fails only on the first invocation, using a
 * counter file as hidden state. This is what a real flaky test looks like to
 * the runner — same commit, same command, different answer.
 */
function flakyCommand(marker: string): string {
  const file = join(repoPath, `.flake-${marker}`);
  return `if [ -f "${file}" ]; then exit 0; else touch "${file}"; exit 1; fi`;
}

describe("probeFlakiness", () => {
  it("proves flakiness when a gate disagrees with itself", async () => {
    await upsertGate(PROJECT, {
      key: "wobbly",
      name: "Wobbly",
      command: flakyCommand("a"),
    });

    const result = await probeFlakiness({
      projectId: PROJECT,
      repoPath,
      attempts: 5,
    });

    const [probe] = result.probes;
    // One pass and one fail on identical input is conclusive.
    expect(probe!.flakinessObserved).toBe(true);
    expect(probe!.passed).toBeGreaterThan(0);
    expect(probe!.failed).toBeGreaterThan(0);
  });

  it("stops as soon as flakiness is proven", async () => {
    await upsertGate(PROJECT, {
      key: "wobbly",
      name: "Wobbly",
      command: flakyCommand("b"),
    });

    const result = await probeFlakiness({
      projectId: PROJECT,
      repoPath,
      attempts: 20,
    });

    // Fails once then passes, so the answer is known after 2 attempts.
    // Running the other 18 would only cost time.
    expect(result.probes[0]!.attempts).toHaveLength(2);
  });

  it("runs every attempt when asked not to stop early", async () => {
    await upsertGate(PROJECT, {
      key: "wobbly",
      name: "Wobbly",
      command: flakyCommand("c"),
    });

    const result = await probeFlakiness({
      projectId: PROJECT,
      repoPath,
      attempts: 4,
      stopWhenProven: false,
    });

    expect(result.probes[0]!.attempts).toHaveLength(4);
  });

  it("reports agreement as 'not observed', never as proven reliable", async () => {
    await upsertGate(PROJECT, { key: "steady", name: "Steady", command: "exit 0" });

    const result = await probeFlakiness({
      projectId: PROJECT,
      repoPath,
      attempts: 4,
    });

    const [probe] = result.probes;
    // The field is named for what was observed, not for a conclusion the
    // evidence cannot support: N passes never rule out a rarer flake.
    expect(probe!.flakinessObserved).toBe(false);
    expect(probe!.passed).toBe(4);
    // The attempt count is reported so a reader can judge the evidence.
    expect(probe!.attempts).toHaveLength(4);
  });

  it("does not call a consistently failing gate flaky", async () => {
    await upsertGate(PROJECT, { key: "broken", name: "Broken", command: "exit 1" });

    const result = await probeFlakiness({
      projectId: PROJECT,
      repoPath,
      attempts: 3,
    });

    const [probe] = result.probes;
    // Consistently broken is a real signal, and a different problem.
    expect(probe!.flakinessObserved).toBe(false);
    expect(probe!.failed).toBe(3);
  });

  it("counts a timeout as a disagreement with a pass", async () => {
    const file = join(repoPath, ".flake-timeout");
    await upsertGate(PROJECT, {
      key: "slow",
      name: "Slow",
      command: `if [ -f "${file}" ]; then exit 0; else touch "${file}"; sleep 30; fi`,
      timeoutSeconds: 1,
    });

    const result = await probeFlakiness({
      projectId: PROJECT,
      repoPath,
      attempts: 3,
    });

    expect(result.probes[0]!.flakinessObserved).toBe(true);
  });

  it("probes only the named gates", async () => {
    await upsertGate(PROJECT, { key: "a", name: "A", command: "exit 0" });
    await upsertGate(PROJECT, { key: "b", name: "B", command: "exit 0" });

    const result = await probeFlakiness({
      projectId: PROJECT,
      repoPath,
      gateKeys: ["a"],
      attempts: 2,
    });

    expect(result.probes.map((probe) => probe.gateKey)).toEqual(["a"]);
  });

  it("rejects an unknown gate name rather than silently probing nothing", async () => {
    await upsertGate(PROJECT, { key: "a", name: "A", command: "exit 0" });

    await expect(
      probeFlakiness({
        projectId: PROJECT,
        repoPath,
        gateKeys: ["nope"],
        attempts: 2,
      }),
    ).rejects.toThrow(NoSuchGateError);
  });

  it("requires at least two attempts to mean anything", async () => {
    await upsertGate(PROJECT, { key: "a", name: "A", command: "exit 0" });

    const result = await probeFlakiness({
      projectId: PROJECT,
      repoPath,
      attempts: 1,
    });

    // A single attempt cannot show disagreement, so it is clamped up.
    expect(result.probes[0]!.attempts.length).toBeGreaterThanOrEqual(2);
  });
});

describe("probe results feed the passive analysis", () => {
  it("stores each attempt as a real run the flakiness query can see", async () => {
    await upsertGate(PROJECT, {
      key: "wobbly",
      name: "Wobbly",
      command: flakyCommand("d"),
    });

    await probeFlakiness({ projectId: PROJECT, repoPath, attempts: 5 });

    // The probe does not keep a private notion of truth: it writes ordinary
    // runs, so the same analysis that watches everyday runs picks it up.
    const [entry] = await gateFlakiness(PROJECT);
    expect(entry!.commitsInconsistent).toBe(1);
    expect(entry!.flakeRate).toBe(1);
  });

  it("labels probe runs with the flake trigger", async () => {
    await upsertGate(PROJECT, { key: "steady", name: "Steady", command: "exit 0" });

    await probeFlakiness({ projectId: PROJECT, repoPath, attempts: 2 });

    const runs = await listRuns(PROJECT);
    // Distinguishes "I re-ran this hunting a flake" from "this happened to
    // run twice".
    expect(runs.every((entry) => entry.trigger === "flake")).toBe(true);
  });
});
