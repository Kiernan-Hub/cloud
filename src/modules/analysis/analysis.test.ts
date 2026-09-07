import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, sqlClient } from "@/lib/db";
import { checkRuns, gateResults, gates, projects } from "@/lib/db/schema";
import {
  findRegressions,
  gateFlakiness,
  gateReliability,
  metricHistory,
  projectSummary,
} from "./index";

const PROJECT = "test-analysis-project";

async function cleanup() {
  await db.execute(sql`DELETE FROM projects WHERE id = ${PROJECT}`);
}

async function makeProject() {
  await db.insert(projects).values({
    id: PROJECT,
    name: "Analysis test",
    repoPath: "/tmp/analysis-test",
  });
}

async function makeGate(
  key: string,
  metric?: {
    name: string;
    direction: "higher_is_better" | "lower_is_better";
    threshold?: number;
  },
): Promise<string> {
  const [row] = await db
    .insert(gates)
    .values({
      projectId: PROJECT,
      key,
      name: key,
      command: `echo ${key}`,
      metricName: metric?.name ?? null,
      metricPattern: metric ? "(\\d+)" : null,
      metricDirection: metric?.direction ?? null,
      metricThreshold: metric?.threshold ? String(metric.threshold) : null,
    })
    .returning({ id: gates.id });
  return row!.id;
}

let clock = new Date("2026-01-01T00:00:00Z").getTime();
function nextTime(): Date {
  clock += 60_000;
  return new Date(clock);
}

async function record(
  gateId: string,
  gateKey: string,
  commitSha: string,
  status: "passed" | "failed" | "timed_out" | "error",
  options?: { metricValue?: number; durationMs?: number },
) {
  const at = nextTime();
  const [run] = await db
    .insert(checkRuns)
    .values({
      projectId: PROJECT,
      commitSha,
      status: status === "passed" ? "passed" : "failed",
      startedAt: at,
      finishedAt: at,
      durationMs: options?.durationMs ?? 1000,
    })
    .returning({ id: checkRuns.id });

  await db.insert(gateResults).values({
    runId: run!.id,
    gateId,
    gateKey,
    projectId: PROJECT,
    commitSha,
    status,
    exitCode: status === "passed" ? 0 : 1,
    durationMs: options?.durationMs ?? 1000,
    metricValue: options?.metricValue === undefined ? null : String(options.metricValue),
    startedAt: at,
    finishedAt: at,
  });
}

beforeEach(async () => {
  await cleanup();
  await makeProject();
  clock = new Date("2026-01-01T00:00:00Z").getTime();
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("gateFlakiness", () => {
  it("flags a gate that both passed and failed on the same commit", async () => {
    const gateId = await makeGate("flaky");
    await record(gateId, "flaky", "commit-a", "passed");
    await record(gateId, "flaky", "commit-a", "failed");

    const [entry] = await gateFlakiness(PROJECT);

    // Same input, different answer: that is a gate problem, not a code one.
    expect(entry!.commitsInconsistent).toBe(1);
    expect(entry!.flakeRate).toBe(1);
  });

  it("does not flag a gate that consistently fails", async () => {
    const gateId = await makeGate("broken");
    await record(gateId, "broken", "commit-a", "failed");
    await record(gateId, "broken", "commit-a", "failed");

    const [entry] = await gateFlakiness(PROJECT);

    // Consistently failing is a real signal, not flakiness.
    expect(entry!.commitsInconsistent).toBe(0);
    expect(entry!.flakeRate).toBe(0);
  });

  it("does not flag differing results on different commits", async () => {
    const gateId = await makeGate("normal");
    await record(gateId, "normal", "commit-a", "passed");
    await record(gateId, "normal", "commit-b", "failed");

    const [entry] = await gateFlakiness(PROJECT);

    // Different code, different result — that is the gate working.
    expect(entry!.commitsRetried).toBe(0);
    expect(entry!.flakeRate).toBeNull();
  });

  it("reports null, not zero, when a gate was never retried", async () => {
    const gateId = await makeGate("untested");
    await record(gateId, "untested", "commit-a", "passed");

    const [entry] = await gateFlakiness(PROJECT);

    // No evidence is not evidence of reliability.
    expect(entry!.flakeRate).toBeNull();
  });

  it("counts a timeout as a non-pass for flake purposes", async () => {
    const gateId = await makeGate("slow");
    await record(gateId, "slow", "commit-a", "passed");
    await record(gateId, "slow", "commit-a", "timed_out");

    const [entry] = await gateFlakiness(PROJECT);
    expect(entry!.commitsInconsistent).toBe(1);
  });
});

describe("gateReliability", () => {
  it("computes pass rate and duration percentiles", async () => {
    const gateId = await makeGate("mixed");
    await record(gateId, "mixed", "c1", "passed", { durationMs: 100 });
    await record(gateId, "mixed", "c2", "passed", { durationMs: 200 });
    await record(gateId, "mixed", "c3", "passed", { durationMs: 300 });
    await record(gateId, "mixed", "c4", "failed", { durationMs: 400 });

    const [entry] = await gateReliability(PROJECT);

    expect(entry!.runs).toBe(4);
    expect(entry!.passed).toBe(3);
    expect(entry!.passRate).toBe(0.75);
    expect(entry!.medianDurationMs).toBe(250);
  });

  it("counts errors separately from failures", async () => {
    const gateId = await makeGate("erroring");
    await record(gateId, "erroring", "c1", "error");
    await record(gateId, "erroring", "c2", "failed");

    const [entry] = await gateReliability(PROJECT);
    expect(entry!.errored).toBe(1);
    expect(entry!.failed).toBe(1);
  });
});

describe("findRegressions", () => {
  it("reports a drop when higher is better", async () => {
    const gateId = await makeGate("coverage", {
      name: "coverage",
      direction: "higher_is_better",
    });
    await record(gateId, "coverage", "c1", "passed", { metricValue: 90 });
    await record(gateId, "coverage", "c2", "passed", { metricValue: 82 });

    const [regression] = await findRegressions(PROJECT);

    expect(regression!.metricName).toBe("coverage");
    expect(regression!.delta).toBe(-8);
    expect(regression!.percentChange).toBeCloseTo(-8 / 90);
  });

  it("does not report a rise when higher is better", async () => {
    const gateId = await makeGate("coverage", {
      name: "coverage",
      direction: "higher_is_better",
    });
    await record(gateId, "coverage", "c1", "passed", { metricValue: 80 });
    await record(gateId, "coverage", "c2", "passed", { metricValue: 91 });

    // An improvement is not a regression.
    expect(await findRegressions(PROJECT)).toHaveLength(0);
  });

  it("reports a rise when lower is better", async () => {
    const gateId = await makeGate("bundle", {
      name: "bundle_kb",
      direction: "lower_is_better",
    });
    await record(gateId, "bundle", "c1", "passed", { metricValue: 500 });
    await record(gateId, "bundle", "c2", "passed", { metricValue: 640 });

    const [regression] = await findRegressions(PROJECT);

    // Direction is why a coverage drop and a bundle drop are opposite news.
    expect(regression!.delta).toBe(140);
  });

  it("does not report a drop when lower is better", async () => {
    const gateId = await makeGate("bundle", {
      name: "bundle_kb",
      direction: "lower_is_better",
    });
    await record(gateId, "bundle", "c1", "passed", { metricValue: 600 });
    await record(gateId, "bundle", "c2", "passed", { metricValue: 480 });

    expect(await findRegressions(PROJECT)).toHaveLength(0);
  });

  it("reports a threshold breach even when the value improved", async () => {
    const gateId = await makeGate("coverage", {
      name: "coverage",
      direction: "higher_is_better",
      threshold: 80,
    });
    await record(gateId, "coverage", "c1", "passed", { metricValue: 60 });
    await record(gateId, "coverage", "c2", "passed", { metricValue: 70 });

    const [regression] = await findRegressions(PROJECT);

    // Still under the bar, even though it moved the right way.
    expect(regression!.breachedThreshold).toBe(true);
  });

  it("ignores an unchanged value", async () => {
    const gateId = await makeGate("coverage", {
      name: "coverage",
      direction: "higher_is_better",
    });
    await record(gateId, "coverage", "c1", "passed", { metricValue: 85 });
    await record(gateId, "coverage", "c2", "passed", { metricValue: 85 });

    expect(await findRegressions(PROJECT)).toHaveLength(0);
  });

  it("needs two data points before it says anything", async () => {
    const gateId = await makeGate("coverage", {
      name: "coverage",
      direction: "higher_is_better",
    });
    await record(gateId, "coverage", "c1", "passed", { metricValue: 10 });

    expect(await findRegressions(PROJECT)).toHaveLength(0);
  });

  it("handles a previous value of zero without dividing by it", async () => {
    const gateId = await makeGate("errors", {
      name: "errors",
      direction: "lower_is_better",
    });
    await record(gateId, "errors", "c1", "passed", { metricValue: 0 });
    await record(gateId, "errors", "c2", "passed", { metricValue: 5 });

    const [regression] = await findRegressions(PROJECT);
    expect(regression!.delta).toBe(5);
    expect(regression!.percentChange).toBeNull();
  });
});

describe("metricHistory", () => {
  it("returns points oldest first for charting", async () => {
    const gateId = await makeGate("coverage", {
      name: "coverage",
      direction: "higher_is_better",
    });
    await record(gateId, "coverage", "c1", "passed", { metricValue: 70 });
    await record(gateId, "coverage", "c2", "passed", { metricValue: 80 });
    await record(gateId, "coverage", "c3", "passed", { metricValue: 90 });

    const points = await metricHistory(PROJECT, "coverage");
    expect(points.map((point) => point.value)).toEqual([70, 80, 90]);
  });
});

describe("projectSummary", () => {
  it("summarizes runs and reports the latest status", async () => {
    const gateId = await makeGate("g");
    await record(gateId, "g", "c1", "passed");
    await record(gateId, "g", "c2", "failed");

    const summary = await projectSummary(PROJECT);

    expect(summary.totalRuns).toBe(2);
    expect(summary.passRate).toBe(0.5);
    expect(summary.lastStatus).toBe("failed");
  });

  it("reports a null pass rate with no runs rather than a misleading zero", async () => {
    const summary = await projectSummary(PROJECT);

    expect(summary.totalRuns).toBe(0);
    expect(summary.passRate).toBeNull();
    expect(summary.lastStatus).toBeNull();
  });
});
