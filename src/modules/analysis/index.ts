// Turning a pile of gate results into the three things worth knowing:
// what blocks you, what lies to you, and what is getting worse.

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { checkRuns, gateResults } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Flakiness
// ---------------------------------------------------------------------------

export type GateFlakiness = {
  gateKey: string;
  /** Commits this gate ran against more than once. */
  commitsRetried: number;
  /** Of those, commits where it both passed and failed. */
  commitsInconsistent: number;
  /** commitsInconsistent / commitsRetried, or null when never retried. */
  flakeRate: number | null;
  totalRuns: number;
};

/**
 * A gate is flaky if it disagrees with itself.
 *
 * The definition used here is deliberately strict: the *same gate* on the
 * *same commit* produced both a pass and a non-pass. Same input, different
 * answer — that is not a code problem, it is a gate problem.
 *
 * This is why results are never deduplicated by commit. Re-running is the
 * measurement.
 *
 * A gate that was never run twice on any commit has `flakeRate: null`, not
 * zero. No evidence is not evidence of reliability.
 */
export async function gateFlakiness(projectId: string): Promise<GateFlakiness[]> {
  const rows = await db.execute<{
    gate_key: string;
    commits_retried: number;
    commits_inconsistent: number;
    total_runs: number;
  }>(sql`
    WITH per_commit AS (
      SELECT
        gate_key,
        commit_sha,
        COUNT(*)                                        AS attempts,
        COUNT(*) FILTER (WHERE status = 'passed')       AS passes,
        COUNT(*) FILTER (WHERE status <> 'passed')      AS non_passes
      FROM gate_results
      WHERE project_id = ${projectId}
        AND status IN ('passed', 'failed', 'timed_out')
      GROUP BY gate_key, commit_sha
    )
    SELECT
      gate_key,
      COUNT(*) FILTER (WHERE attempts > 1)::int                       AS commits_retried,
      COUNT(*) FILTER (WHERE passes > 0 AND non_passes > 0)::int      AS commits_inconsistent,
      SUM(attempts)::int                                              AS total_runs
    FROM per_commit
    GROUP BY gate_key
    ORDER BY commits_inconsistent DESC, gate_key
  `);

  return rows.map((row) => ({
    gateKey: row.gate_key,
    commitsRetried: row.commits_retried,
    commitsInconsistent: row.commits_inconsistent,
    flakeRate:
      row.commits_retried > 0 ? row.commits_inconsistent / row.commits_retried : null,
    totalRuns: row.total_runs,
  }));
}

// ---------------------------------------------------------------------------
// What blocks you
// ---------------------------------------------------------------------------

export type GateReliability = {
  gateKey: string;
  runs: number;
  passed: number;
  failed: number;
  timedOut: number;
  errored: number;
  passRate: number;
  medianDurationMs: number;
  p95DurationMs: number;
};

export async function gateReliability(projectId: string): Promise<GateReliability[]> {
  const rows = await db.execute<{
    gate_key: string;
    runs: number;
    passed: number;
    failed: number;
    timed_out: number;
    errored: number;
    median_ms: number;
    p95_ms: number;
  }>(sql`
    SELECT
      gate_key,
      COUNT(*)::int                                          AS runs,
      COUNT(*) FILTER (WHERE status = 'passed')::int         AS passed,
      COUNT(*) FILTER (WHERE status = 'failed')::int         AS failed,
      COUNT(*) FILTER (WHERE status = 'timed_out')::int      AS timed_out,
      COUNT(*) FILTER (WHERE status = 'error')::int          AS errored,
      COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms), 0)::int  AS median_ms,
      COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::int AS p95_ms
    FROM gate_results
    WHERE project_id = ${projectId}
    GROUP BY gate_key
    ORDER BY (COUNT(*) FILTER (WHERE status <> 'passed')) DESC, gate_key
  `);

  return rows.map((row) => ({
    gateKey: row.gate_key,
    runs: row.runs,
    passed: row.passed,
    failed: row.failed,
    timedOut: row.timed_out,
    errored: row.errored,
    passRate: row.runs > 0 ? row.passed / row.runs : 0,
    medianDurationMs: row.median_ms,
    p95DurationMs: row.p95_ms,
  }));
}

// ---------------------------------------------------------------------------
// Regressions
// ---------------------------------------------------------------------------

export type MetricPoint = {
  runId: string;
  commitSha: string;
  value: number;
  at: Date;
};

export type Regression = {
  gateKey: string;
  metricName: string;
  direction: "higher_is_better" | "lower_is_better";
  current: MetricPoint;
  previous: MetricPoint;
  delta: number;
  /** Fractional change, or null when the previous value was zero. */
  percentChange: number | null;
  threshold: number | null;
  breachedThreshold: boolean;
};

/**
 * Compare each metric gate's latest value against the one before it.
 *
 * Direction matters: a coverage drop and a bundle-size drop are opposite
 * news, so `metric_direction` is required alongside a metric rather than
 * assumed. Only genuine worsening is returned — an improvement is not a
 * regression, and neither is a value that did not move.
 */
export async function findRegressions(projectId: string): Promise<Regression[]> {
  const rows = await db.execute<{
    gate_key: string;
    metric_name: string;
    metric_direction: "higher_is_better" | "lower_is_better";
    metric_threshold: string | null;
    current_value: string;
    current_run: string;
    current_sha: string;
    current_at: Date;
    previous_value: string;
    previous_run: string;
    previous_sha: string;
    previous_at: Date;
  }>(sql`
    WITH points AS (
      SELECT
        r.gate_key,
        g.metric_name,
        g.metric_direction,
        g.metric_threshold,
        r.metric_value,
        r.run_id,
        r.commit_sha,
        r.started_at,
        ROW_NUMBER() OVER (PARTITION BY r.gate_key ORDER BY r.started_at DESC) AS rn
      FROM gate_results r
      JOIN gates g ON g.id = r.gate_id
      WHERE r.project_id = ${projectId}
        AND r.metric_value IS NOT NULL
        AND g.metric_direction IS NOT NULL
    )
    SELECT
      c.gate_key,
      c.metric_name,
      c.metric_direction,
      c.metric_threshold,
      c.metric_value  AS current_value,
      c.run_id        AS current_run,
      c.commit_sha    AS current_sha,
      c.started_at    AS current_at,
      p.metric_value  AS previous_value,
      p.run_id        AS previous_run,
      p.commit_sha    AS previous_sha,
      p.started_at    AS previous_at
    FROM points c
    JOIN points p ON p.gate_key = c.gate_key AND p.rn = 2
    WHERE c.rn = 1
  `);

  const regressions: Regression[] = [];

  for (const row of rows) {
    const current = Number(row.current_value);
    const previous = Number(row.previous_value);
    const threshold = row.metric_threshold === null ? null : Number(row.metric_threshold);

    const worse =
      row.metric_direction === "higher_is_better"
        ? current < previous
        : current > previous;

    const breachedThreshold =
      threshold !== null &&
      (row.metric_direction === "higher_is_better"
        ? current < threshold
        : current > threshold);

    // Report only actual worsening, or a threshold breach even without
    // movement (a value that has been under the bar all along still matters).
    if (!worse && !breachedThreshold) continue;

    regressions.push({
      gateKey: row.gate_key,
      metricName: row.metric_name,
      direction: row.metric_direction,
      current: {
        runId: row.current_run,
        commitSha: row.current_sha,
        value: current,
        at: new Date(row.current_at),
      },
      previous: {
        runId: row.previous_run,
        commitSha: row.previous_sha,
        value: previous,
        at: new Date(row.previous_at),
      },
      delta: current - previous,
      percentChange: previous === 0 ? null : (current - previous) / previous,
      threshold,
      breachedThreshold,
    });
  }

  return regressions;
}

/** A metric's history, oldest first, for charting. */
export async function metricHistory(
  projectId: string,
  gateKey: string,
  limit = 50,
): Promise<MetricPoint[]> {
  const rows = await db
    .select({
      runId: gateResults.runId,
      commitSha: gateResults.commitSha,
      value: gateResults.metricValue,
      at: gateResults.startedAt,
    })
    .from(gateResults)
    .where(
      and(
        eq(gateResults.projectId, projectId),
        eq(gateResults.gateKey, gateKey),
        sql`${gateResults.metricValue} IS NOT NULL`,
      ),
    )
    .orderBy(desc(gateResults.startedAt))
    .limit(Math.min(Math.max(1, limit), 500));

  return rows
    .map((row) => ({
      runId: row.runId,
      commitSha: row.commitSha,
      value: Number(row.value),
      at: row.at,
    }))
    .reverse();
}

// ---------------------------------------------------------------------------
// Project overview
// ---------------------------------------------------------------------------

export type ProjectSummary = {
  totalRuns: number;
  passed: number;
  failed: number;
  errored: number;
  passRate: number | null;
  lastRunAt: Date | null;
  lastStatus: "passed" | "failed" | "error" | "running" | null;
  medianRunMs: number | null;
};

export async function projectSummary(projectId: string): Promise<ProjectSummary> {
  const [row] = await db.execute<{
    total: number;
    passed: number;
    failed: number;
    errored: number;
    median_ms: number | null;
  }>(sql`
    SELECT
      COUNT(*)::int                                     AS total,
      COUNT(*) FILTER (WHERE status = 'passed')::int    AS passed,
      COUNT(*) FILTER (WHERE status = 'failed')::int    AS failed,
      COUNT(*) FILTER (WHERE status = 'error')::int     AS errored,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::int AS median_ms
    FROM check_runs
    WHERE project_id = ${projectId} AND status <> 'running'
  `);

  const [latest] = await db
    .select({ startedAt: checkRuns.startedAt, status: checkRuns.status })
    .from(checkRuns)
    .where(eq(checkRuns.projectId, projectId))
    .orderBy(desc(checkRuns.startedAt))
    .limit(1);

  const total = row?.total ?? 0;

  return {
    totalRuns: total,
    passed: row?.passed ?? 0,
    failed: row?.failed ?? 0,
    errored: row?.errored ?? 0,
    passRate: total > 0 ? (row?.passed ?? 0) / total : null,
    lastRunAt: latest?.startedAt ?? null,
    lastStatus: latest?.status ?? null,
    medianRunMs: row?.median_ms ?? null,
  };
}
