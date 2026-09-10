// Turning a pile of gate results into the three things worth knowing:
// what blocks you, what lies to you, and what is getting worse.

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { checkRuns, gateResults, gates } from "@/lib/db/schema";

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
 * Runs from a dirty working tree are excluded entirely. The whole claim rests
 * on two runs having had the same input, and a commit SHA does not identify
 * the code when there are uncommitted changes on top of it: editing a file
 * between two runs would otherwise be reported as the gate contradicting
 * itself. That is the one place where this metric can lie outright, so the
 * evidence it will not stand behind is thrown away rather than counted.
 *
 * A gate that was never run twice on one clean commit has `flakeRate: null`,
 * not zero. No evidence is not evidence of reliability.
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
        r.gate_key,
        r.commit_sha,
        COUNT(*)                                          AS attempts,
        COUNT(*) FILTER (WHERE r.status = 'passed')       AS passes,
        COUNT(*) FILTER (WHERE r.status <> 'passed')      AS non_passes
      FROM gate_results r
      JOIN check_runs cr ON cr.id = r.run_id
      WHERE r.project_id = ${projectId}
        AND r.status IN ('passed', 'failed', 'timed_out')
        AND NOT cr.dirty
      GROUP BY r.gate_key, r.commit_sha
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

export type FlakeEvidence = {
  gateKey: string;
  commitSha: string;
  commitSubject: string | null;
  attempts: number;
  passes: number;
  /** A run where it passed and one where it did not — the same code, both ways. */
  passingRunId: string;
  failingRunId: string;
  failingStatus: "failed" | "timed_out";
  lastSeen: Date;
};

/**
 * The commits where a gate contradicted itself, with a run of each outcome.
 *
 * A flake rate on its own is an accusation without evidence: the next
 * question is always "which commit, and can I see it both ways?". Returning a
 * passing and a failing run for the same commit makes the two outputs
 * directly comparable, which is usually where the cause is visible.
 *
 * Dirty runs are excluded here for the same reason they are excluded from the
 * rate itself — the commit does not identify the code that ran, so the two
 * outputs would not be comparable.
 */
export async function flakeEvidence(
  projectId: string,
  limit = 20,
): Promise<FlakeEvidence[]> {
  const rows = await db.execute<{
    gate_key: string;
    commit_sha: string;
    commit_subject: string | null;
    attempts: number;
    passes: number;
    passing_run_id: string;
    failing_run_id: string;
    failing_status: "failed" | "timed_out";
    last_seen: Date;
  }>(sql`
    WITH clean AS (
      SELECT r.gate_key, r.commit_sha, r.status, r.run_id, r.started_at, cr.commit_subject
      FROM gate_results r
      JOIN check_runs cr ON cr.id = r.run_id
      WHERE r.project_id = ${projectId}
        AND r.status IN ('passed', 'failed', 'timed_out')
        AND NOT cr.dirty
    )
    SELECT
      gate_key,
      commit_sha,
      MAX(commit_subject)                                     AS commit_subject,
      COUNT(*)::int                                           AS attempts,
      COUNT(*) FILTER (WHERE status = 'passed')::int          AS passes,
      (ARRAY_AGG(run_id ORDER BY started_at DESC)
         FILTER (WHERE status = 'passed'))[1]                 AS passing_run_id,
      (ARRAY_AGG(run_id ORDER BY started_at DESC)
         FILTER (WHERE status <> 'passed'))[1]                AS failing_run_id,
      (ARRAY_AGG(status ORDER BY started_at DESC)
         FILTER (WHERE status <> 'passed'))[1]                AS failing_status,
      MAX(started_at)                                         AS last_seen
    FROM clean
    GROUP BY gate_key, commit_sha
    HAVING COUNT(*) FILTER (WHERE status = 'passed') > 0
       AND COUNT(*) FILTER (WHERE status <> 'passed') > 0
    ORDER BY MAX(started_at) DESC
    LIMIT ${Math.min(Math.max(1, limit), 100)}
  `);

  return rows.map((row) => ({
    gateKey: row.gate_key,
    commitSha: row.commit_sha,
    commitSubject: row.commit_subject,
    attempts: row.attempts,
    passes: row.passes,
    passingRunId: row.passing_run_id,
    failingRunId: row.failing_run_id,
    failingStatus: row.failing_status,
    lastSeen: new Date(row.last_seen),
  }));
}

/**
 * One gate's behaviour across a deliberate burst of repeats.
 *
 * `gateFlakiness` reads history out of the database; this reads a single
 * flake-hunting session that just happened, before anyone asks the database
 * anything. The two agree on what flaky means: it disagreed with itself.
 */
export type GateAttempt = {
  gateKey: string;
  gateName: string;
  status: "passed" | "failed" | "timed_out" | "skipped" | "error";
};

export type AttemptTally = {
  gateKey: string;
  gateName: string;
  /** Attempts that actually ran. Skipped ones are not attempts. */
  ran: number;
  passed: number;
  /** It both passed and did not pass — the same input, two answers. */
  inconsistent: boolean;
};

/**
 * Tally repeated attempts at the same gates on one commit.
 *
 * A gate that never ran (every attempt skipped) is left out rather than
 * reported as 0/0: no attempts is not the same as no failures.
 */
export function tallyAttempts(attempts: GateAttempt[][]): AttemptTally[] {
  const byKey = new Map<string, AttemptTally>();

  for (const attempt of attempts) {
    for (const result of attempt) {
      if (result.status === "skipped") continue;

      const entry = byKey.get(result.gateKey) ?? {
        gateKey: result.gateKey,
        gateName: result.gateName,
        ran: 0,
        passed: 0,
        inconsistent: false,
      };
      entry.ran += 1;
      if (result.status === "passed") entry.passed += 1;
      byKey.set(result.gateKey, entry);
    }
  }

  for (const entry of byKey.values()) {
    entry.inconsistent = entry.passed > 0 && entry.passed < entry.ran;
  }

  return [...byKey.values()];
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

/**
 * How each gate has actually behaved.
 *
 * `skipped` results are excluded throughout. A skipped result is a fact about
 * the run, not about the gate — counting it would drop the gate's pass rate
 * and its p95 duration for no reason other than someone having run
 * `--only` on something else.
 */
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
      AND status <> 'skipped'
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

export type MetricDrift = {
  gateKey: string;
  metricName: string;
  direction: "higher_is_better" | "lower_is_better";
  /** Median of the older half of the window. */
  earlierMedian: number;
  /** Median of the newer half. */
  recentMedian: number;
  delta: number;
  percentChange: number | null;
  /** Points in each half. Both halves are this size, or there is no finding. */
  halfSize: number;
  worsening: boolean;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

/**
 * Metrics sliding the wrong way over time, as opposed to in one step.
 *
 * `findRegressions` compares the two most recent values, which answers a
 * different question and answers it badly for a noisy metric. A coverage
 * number that jitters a point either way while trending down reports nothing
 * whenever the last hop happens to tick up, and when it does fire it reports
 * the size of that one hop rather than the size of the slide. Both are the
 * same mistake: two points cannot distinguish noise from a trend.
 *
 * So this compares the median of the recent half of a window against the
 * median of the earlier half. Medians rather than means, because one flaky
 * reading should not be able to manufacture a trend — or hide one.
 *
 * `window` is the most history to consider, not a requirement: whatever is
 * available up to that is used. But each half must hold at least `minHalf`
 * points, because a trend claimed from three data points is a guess, and this
 * tool would rather report nothing than something shaped like a finding.
 */
export async function metricDrift(
  projectId: string,
  options?: { window?: number; minHalf?: number },
): Promise<MetricDrift[]> {
  const minHalf = Math.max(2, options?.minHalf ?? 4);
  // An even window so the two halves are the same size and comparable.
  const window = Math.max(minHalf * 2, Math.min(options?.window ?? 20, 200)) & ~1;

  const gateRows = await db
    .select({
      gateKey: gates.key,
      metricName: gates.metricName,
      metricDirection: gates.metricDirection,
    })
    .from(gates)
    .where(
      and(eq(gates.projectId, projectId), sql`${gates.metricDirection} IS NOT NULL`),
    );

  const drifts: MetricDrift[] = [];

  for (const gate of gateRows) {
    const points = await metricHistory(projectId, gate.gateKey, window);

    // Use what history there is, but split it evenly and refuse to work from
    // halves too thin to tell a trend from a coin flip.
    const halfSize = Math.floor(points.length / 2);
    if (halfSize < minHalf) continue;

    const values = points.map((point) => point.value);
    const earlierMedian = median(values.slice(0, halfSize));
    const recentMedian = median(values.slice(-halfSize));

    const worsening =
      gate.metricDirection === "higher_is_better"
        ? recentMedian < earlierMedian
        : recentMedian > earlierMedian;

    // A metric holding steady or improving is not drift. Reporting it as a
    // finding would train people to ignore the section.
    if (!worsening) continue;

    drifts.push({
      gateKey: gate.gateKey,
      metricName: gate.metricName!,
      direction: gate.metricDirection!,
      earlierMedian,
      recentMedian,
      delta: recentMedian - earlierMedian,
      percentChange:
        earlierMedian === 0 ? null : (recentMedian - earlierMedian) / earlierMedian,
      halfSize,
      worsening,
    });
  }

  return drifts;
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
  /** Runs that checked only part of the gate set. */
  partial: number;
  /** Runs that never reached a verdict. */
  canceled: number;
  /** Of the runs that judged the full gate set. Null when there are none. */
  passRate: number | null;
  lastRunAt: Date | null;
  lastStatus: "passed" | "partial" | "failed" | "error" | "canceled" | "running" | null;
  medianRunMs: number | null;
};

/**
 * The headline numbers for a project.
 *
 * The pass rate counts only runs that reached a verdict on the *whole* gate
 * set. A partial run cannot vote: counting it as a pass would credit checks
 * that never ran, and counting it as a failure would blame gates that never
 * ran either. Same for canceled runs, which established nothing at all. Both
 * are reported separately so they are visible rather than quietly dropped.
 */
export async function projectSummary(projectId: string): Promise<ProjectSummary> {
  const [row] = await db.execute<{
    judged: number;
    passed: number;
    failed: number;
    errored: number;
    partial: number;
    canceled: number;
    median_ms: number | null;
  }>(sql`
    SELECT
      COUNT(*) FILTER (WHERE status IN ('passed', 'failed', 'error'))::int AS judged,
      COUNT(*) FILTER (WHERE status = 'passed')::int    AS passed,
      COUNT(*) FILTER (WHERE status = 'failed')::int    AS failed,
      COUNT(*) FILTER (WHERE status = 'error')::int     AS errored,
      COUNT(*) FILTER (WHERE status = 'partial')::int   AS partial,
      COUNT(*) FILTER (WHERE status = 'canceled')::int  AS canceled,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY duration_ms
      ) FILTER (WHERE duration_ms IS NOT NULL)::int AS median_ms
    FROM check_runs
    WHERE project_id = ${projectId} AND status <> 'running'
  `);

  const [latest] = await db
    .select({ startedAt: checkRuns.startedAt, status: checkRuns.status })
    .from(checkRuns)
    .where(eq(checkRuns.projectId, projectId))
    .orderBy(desc(checkRuns.startedAt))
    .limit(1);

  const judged = row?.judged ?? 0;
  const partial = row?.partial ?? 0;
  const canceled = row?.canceled ?? 0;

  return {
    totalRuns: judged + partial + canceled,
    passed: row?.passed ?? 0,
    failed: row?.failed ?? 0,
    errored: row?.errored ?? 0,
    partial,
    canceled,
    passRate: judged > 0 ? (row?.passed ?? 0) / judged : null,
    lastRunAt: latest?.startedAt ?? null,
    lastStatus: latest?.status ?? null,
    medianRunMs: row?.median_ms ?? null,
  };
}
