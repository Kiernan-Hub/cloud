import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, sqlClient } from "@/lib/db";
import { checkRuns, gateResults, gates, projects } from "@/lib/db/schema";
import {
  findRegressions,
  flakeEvidence,
  gateFlakiness,
  gateReliability,
  metricDrift,
  metricHistory,
  projectSummary,
  tallyAttempts,
  type GateAttempt,
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

/** A run with no gate results — for run-level statuses like canceled. */
async function makeRun(status: "running" | "canceled" | "partial") {
  const at = nextTime();
  await db.insert(checkRuns).values({
    projectId: PROJECT,
    commitSha: "z".repeat(40),
    status,
    startedAt: at,
    finishedAt: status === "running" ? null : at,
    durationMs: status === "running" ? null : 1000,
  });
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
  status: "passed" | "failed" | "timed_out" | "skipped" | "error",
  options?: { metricValue?: number; durationMs?: number; dirty?: boolean },
) {
  const at = nextTime();
  const runStatus =
    status === "passed" ? "passed" : status === "skipped" ? "partial" : "failed";
  const [run] = await db
    .insert(checkRuns)
    .values({
      projectId: PROJECT,
      commitSha,
      status: runStatus,
      dirty: options?.dirty ?? false,
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

  it("ignores dirty runs, where the commit does not identify the code", async () => {
    const gateId = await makeGate("edited-between");
    await record(gateId, "edited-between", "commit-a", "failed", { dirty: true });
    await record(gateId, "edited-between", "commit-a", "passed", { dirty: true });

    // The developer fixed the code between the two runs. Same commit SHA,
    // different code — calling that a flaky gate sends them hunting for a
    // problem that is not there.
    expect(await gateFlakiness(PROJECT)).toEqual([]);
  });

  it("still flags a gate that disagrees with itself on a clean commit", async () => {
    const gateId = await makeGate("really-flaky");
    await record(gateId, "really-flaky", "commit-a", "passed");
    await record(gateId, "really-flaky", "commit-a", "failed");
    await record(gateId, "really-flaky", "commit-a", "passed", { dirty: true });

    const [entry] = await gateFlakiness(PROJECT);

    // The dirty attempt is discarded; the two clean ones still contradict.
    expect(entry!.totalRuns).toBe(2);
    expect(entry!.flakeRate).toBe(1);
  });
});

describe("flakeEvidence", () => {
  it("returns the commit and a run of each outcome", async () => {
    const gateId = await makeGate("flaky");
    await record(gateId, "flaky", "commit-a", "passed");
    await record(gateId, "flaky", "commit-a", "failed");

    const [entry] = await flakeEvidence(PROJECT);

    expect(entry!.commitSha).toBe("commit-a");
    expect(entry!.attempts).toBe(2);
    expect(entry!.passes).toBe(1);
    // The payoff: the same code, both ways, so the two outputs can be
    // compared directly.
    expect(entry!.passingRunId).toBeTruthy();
    expect(entry!.failingRunId).toBeTruthy();
    expect(entry!.passingRunId).not.toBe(entry!.failingRunId);
  });

  it("says which way it failed", async () => {
    const gateId = await makeGate("slow");
    await record(gateId, "slow", "commit-a", "passed");
    await record(gateId, "slow", "commit-a", "timed_out");

    // A gate that sometimes times out calls for a different response than
    // one that sometimes fails, so the distinction survives to here.
    expect((await flakeEvidence(PROJECT))[0]!.failingStatus).toBe("timed_out");
  });

  it("returns nothing for a gate that always agreed with itself", async () => {
    const gateId = await makeGate("steady");
    await record(gateId, "steady", "commit-a", "passed");
    await record(gateId, "steady", "commit-a", "passed");
    await record(gateId, "steady", "commit-b", "failed");
    await record(gateId, "steady", "commit-b", "failed");

    expect(await flakeEvidence(PROJECT)).toEqual([]);
  });

  it("excludes dirty runs, whose outputs are not comparable", async () => {
    const gateId = await makeGate("edited-between");
    await record(gateId, "edited-between", "commit-a", "passed", { dirty: true });
    await record(gateId, "edited-between", "commit-a", "failed", { dirty: true });

    // Same reason the rate excludes them: the commit does not identify the
    // code, so there is no "same input" to show two answers for.
    expect(await flakeEvidence(PROJECT)).toEqual([]);
  });

  it("reports each flaky commit separately, newest first", async () => {
    const gateId = await makeGate("flaky");
    await record(gateId, "flaky", "commit-old", "passed");
    await record(gateId, "flaky", "commit-old", "failed");
    await record(gateId, "flaky", "commit-new", "failed");
    await record(gateId, "flaky", "commit-new", "passed");

    const evidence = await flakeEvidence(PROJECT);
    expect(evidence.map((entry) => entry.commitSha)).toEqual([
      "commit-new",
      "commit-old",
    ]);
  });
});

describe("tallyAttempts", () => {
  const attempt = (...statuses: GateAttempt["status"][]): GateAttempt[] =>
    statuses.map((status, index) => ({
      gateKey: `g${index}`,
      gateName: `G${index}`,
      status,
    }));

  it("flags a gate that both passed and failed across the burst", async () => {
    const tally = tallyAttempts([
      attempt("passed"),
      attempt("failed"),
      attempt("passed"),
    ]);

    // Same commit, same gate, two different answers.
    expect(tally[0]!.inconsistent).toBe(true);
    expect(tally[0]!.passed).toBe(2);
    expect(tally[0]!.ran).toBe(3);
  });

  it("does not flag a gate that failed every time", async () => {
    const tally = tallyAttempts([attempt("failed"), attempt("failed")]);

    // Consistently failing is a real signal, not flakiness.
    expect(tally[0]!.inconsistent).toBe(false);
    expect(tally[0]!.passed).toBe(0);
  });

  it("does not flag a gate that passed every time", async () => {
    const tally = tallyAttempts([attempt("passed"), attempt("passed")]);
    expect(tally[0]!.inconsistent).toBe(false);
  });

  it("counts a timeout and an error as non-passes", async () => {
    const tally = tallyAttempts([
      attempt("passed"),
      attempt("timed_out"),
      attempt("error"),
    ]);

    // A gate that sometimes times out is disagreeing with itself just as
    // much as one that sometimes fails.
    expect(tally[0]!.inconsistent).toBe(true);
    expect(tally[0]!.ran).toBe(3);
  });

  it("leaves out a gate that was skipped every time", async () => {
    // No attempts is not the same as no failures, so it gets no 0/0 row.
    expect(tallyAttempts([attempt("skipped"), attempt("skipped")])).toEqual([]);
  });

  it("does not let a skipped attempt count against a gate", async () => {
    const tally = tallyAttempts([
      attempt("passed"),
      attempt("skipped"),
      attempt("passed"),
    ]);

    expect(tally[0]!.ran).toBe(2);
    expect(tally[0]!.inconsistent).toBe(false);
  });

  it("tallies each gate separately", async () => {
    const tally = tallyAttempts([
      [
        { gateKey: "lint", gateName: "Lint", status: "passed" },
        { gateKey: "test", gateName: "Tests", status: "failed" },
      ],
      [
        { gateKey: "lint", gateName: "Lint", status: "passed" },
        { gateKey: "test", gateName: "Tests", status: "passed" },
      ],
    ]);

    expect(tally.find((entry) => entry.gateKey === "lint")!.inconsistent).toBe(false);
    expect(tally.find((entry) => entry.gateKey === "test")!.inconsistent).toBe(true);
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

  it("ignores skipped results, which say nothing about the gate", async () => {
    const gateId = await makeGate("sometimes-skipped");
    await record(gateId, "sometimes-skipped", "c1", "passed", { durationMs: 500 });
    await record(gateId, "sometimes-skipped", "c2", "skipped", { durationMs: 0 });
    await record(gateId, "sometimes-skipped", "c3", "skipped", { durationMs: 0 });

    const [entry] = await gateReliability(PROJECT);

    // Being left out of somebody else's `--only` run is not a mark against
    // the gate. Counting it would drop this to 33% and pull the durations
    // toward zero.
    expect(entry!.runs).toBe(1);
    expect(entry!.passRate).toBe(1);
    expect(entry!.medianDurationMs).toBe(500);
  });

  it("omits a gate that has only ever been skipped rather than scoring it", async () => {
    const gateId = await makeGate("never-run");
    await record(gateId, "never-run", "c1", "skipped", { durationMs: 0 });

    // No evidence means no row, not a 0% row.
    expect(await gateReliability(PROJECT)).toEqual([]);
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

describe("metricDrift", () => {
  /** Record `values` in order as a metric history for one gate. */
  async function history(gateId: string, key: string, values: number[]) {
    for (const [index, value] of values.entries()) {
      await record(gateId, key, `c${index}`, "passed", { metricValue: value });
    }
  }

  it("sees a downward trend that the step comparison reports as an improvement", async () => {
    const gateId = await makeGate("cov", {
      name: "coverage",
      direction: "higher_is_better",
    });
    // Jittery, but clearly sliding: ~90 down to ~84. The last hop happens to
    // tick upward, which is all findRegressions looks at.
    await history(gateId, "cov", [91, 89, 92, 88, 90, 87, 86, 88, 84, 86, 83, 85]);

    // Two points cannot tell noise from a trend: the final 83 → 85 reads as
    // an improvement, so nothing is reported.
    expect(await findRegressions(PROJECT)).toEqual([]);

    // Comparing halves sees the slide the last hop hid.
    const [drift] = await metricDrift(PROJECT, { window: 12 });
    expect(drift!.metricName).toBe("coverage");
    expect(drift!.earlierMedian).toBeGreaterThan(drift!.recentMedian);
    expect(drift!.delta).toBeLessThan(0);
  });

  it("reports the size of the slide, not the size of the last hop", async () => {
    const gateId = await makeGate("cov", {
      name: "coverage",
      direction: "higher_is_better",
    });
    // Monotonic, half a point per run. findRegressions does fire here, but
    // only ever describes the final 0.5 — which reads as trivial when the
    // metric is really five and a half points down.
    await history(
      gateId,
      "cov",
      Array.from({ length: 12 }, (_, index) => 90 - index * 0.5),
    );

    expect((await findRegressions(PROJECT))[0]!.delta).toBeCloseTo(-0.5);

    const [drift] = await metricDrift(PROJECT, { window: 12 });
    expect(drift!.delta).toBeCloseTo(-3);
  });

  it("respects direction — a falling bundle size is good news", async () => {
    const gateId = await makeGate("size", {
      name: "bundle",
      direction: "lower_is_better",
    });
    await history(
      gateId,
      "size",
      Array.from({ length: 12 }, (_, index) => 500 - index * 5),
    );

    // A coverage drop and a bundle-size drop are opposite news.
    expect(await metricDrift(PROJECT, { window: 12 })).toEqual([]);
  });

  it("reports a rising bundle size as drift", async () => {
    const gateId = await makeGate("size", {
      name: "bundle",
      direction: "lower_is_better",
    });
    await history(
      gateId,
      "size",
      Array.from({ length: 12 }, (_, index) => 500 + index * 5),
    );

    const [drift] = await metricDrift(PROJECT, { window: 12 });
    expect(drift!.delta).toBeGreaterThan(0);
  });

  it("says nothing when the halves are too thin to tell a trend from noise", async () => {
    const gateId = await makeGate("cov", {
      name: "coverage",
      direction: "higher_is_better",
    });
    await history(gateId, "cov", [90, 80, 70]);

    // A trend claimed from three points is a guess. Reporting nothing is the
    // honest answer, not a finding shaped like one.
    expect(await metricDrift(PROJECT, { window: 12 })).toEqual([]);
  });

  it("uses the history that exists rather than demanding a full window", async () => {
    const gateId = await makeGate("cov", {
      name: "coverage",
      direction: "higher_is_better",
    });
    // Ten points against a window of 20: a young project should still get an
    // answer, so long as each half is thick enough to mean something.
    await history(gateId, "cov", [90, 91, 89, 90, 91, 84, 83, 85, 84, 83]);

    const [drift] = await metricDrift(PROJECT, { window: 20 });
    expect(drift!.halfSize).toBe(5);
    expect(drift!.delta).toBeLessThan(0);
  });

  it("is not fooled by a single outlier", async () => {
    const gateId = await makeGate("cov", {
      name: "coverage",
      direction: "higher_is_better",
    });
    // Steady at 90, with one bad reading in the recent half. A mean would
    // show a drop; the median holds.
    await history(gateId, "cov", [90, 90, 90, 90, 90, 90, 90, 90, 90, 0, 90, 90]);

    expect(await metricDrift(PROJECT, { window: 12 })).toEqual([]);
  });

  it("ignores a metric with no direction, which cannot be judged", async () => {
    const gateId = await makeGate("plain");
    await history(
      gateId,
      "plain",
      Array.from({ length: 12 }, (_, index) => 90 - index),
    );

    // Without a direction there is no way to know which way is worse.
    expect(await metricDrift(PROJECT, { window: 12 })).toEqual([]);
  });

  it("says nothing about a metric holding steady", async () => {
    const gateId = await makeGate("cov", {
      name: "coverage",
      direction: "higher_is_better",
    });
    await history(gateId, "cov", Array(12).fill(85));

    expect(await metricDrift(PROJECT, { window: 12 })).toEqual([]);
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

  it("keeps partial and canceled runs out of the pass rate but visible", async () => {
    const gateId = await makeGate("g");
    await record(gateId, "g", "c1", "passed");
    await record(gateId, "g", "c2", "failed");
    await record(gateId, "g", "c3", "skipped"); // makes a partial run
    await makeRun("canceled");

    const summary = await projectSummary(PROJECT);

    // A partial run credits checks that never ran; a canceled run
    // established nothing. Neither gets a vote...
    expect(summary.passRate).toBe(0.5);
    // ...but both are counted and named, not quietly dropped.
    expect(summary.totalRuns).toBe(4);
    expect(summary.partial).toBe(1);
    expect(summary.canceled).toBe(1);
  });

  it("reports a null pass rate when every run was partial", async () => {
    const gateId = await makeGate("g");
    await record(gateId, "g", "c1", "skipped");

    const summary = await projectSummary(PROJECT);

    // Nothing has judged the full gate set, so there is no rate to report.
    expect(summary.passRate).toBeNull();
    expect(summary.partial).toBe(1);
  });

  it("excludes a still-running run from the totals", async () => {
    await makeRun("running");

    const summary = await projectSummary(PROJECT);
    expect(summary.totalRuns).toBe(0);
  });
});
