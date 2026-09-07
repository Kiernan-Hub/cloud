import Link from "next/link";
import { notFound } from "next/navigation";

import {
  findRegressions,
  gateFlakiness,
  gateReliability,
  metricHistory,
  projectSummary,
} from "@/modules/analysis";
import { getProject, listGates } from "@/modules/projects";
import { listRuns } from "@/modules/runs";

import {
  formatAgo,
  formatDuration,
  formatRate,
  statusBadgeClass,
} from "../../_components/format";
import { Sparkline } from "../../_components/sparkline";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;

  const project = await getProject(id);
  if (!project) notFound();

  const [summary, runs, reliability, flakiness, regressions, gates] = await Promise.all([
    projectSummary(id),
    listRuns(id, 20),
    gateReliability(id),
    gateFlakiness(id),
    findRegressions(id),
    listGates(id),
  ]);

  const metricGates = gates.filter((gate) => gate.metricName && gate.metricDirection);
  const histories = await Promise.all(
    metricGates.map(async (gate) => ({
      gate,
      points: await metricHistory(id, gate.key, 40),
    })),
  );

  const flakeByKey = new Map(flakiness.map((entry) => [entry.gateKey, entry]));

  return (
    <>
      <Link className="back-link" href="/">
        ← All projects
      </Link>

      <h2 style={{ marginTop: 0 }}>{project.name}</h2>
      <p className="muted mono">{project.repoPath}</p>

      <div className="grid grid-4" style={{ marginTop: "1rem" }}>
        <div className="card stat">
          <div className="stat-value">{formatRate(summary.passRate)}</div>
          <div className="stat-label">Pass rate</div>
        </div>
        <div className="card stat">
          <div className="stat-value">{summary.totalRuns}</div>
          <div className="stat-label">Total runs</div>
        </div>
        <div className="card stat">
          <div className="stat-value">{formatDuration(summary.medianRunMs)}</div>
          <div className="stat-label">Median run</div>
        </div>
        <div className="card stat">
          <div className="stat-value">{formatAgo(summary.lastRunAt)}</div>
          <div className="stat-label">Last run</div>
        </div>
      </div>

      {regressions.length > 0 ? (
        <>
          <h2>Regressions</h2>
          <div className="notice notice-warn">
            <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
              {regressions.map((regression) => (
                <li key={regression.gateKey}>
                  <strong>{regression.metricName}</strong> moved{" "}
                  {regression.previous.value} → {regression.current.value}
                  {regression.percentChange !== null
                    ? ` (${(regression.percentChange * 100).toFixed(1)}%)`
                    : ""}{" "}
                  on{" "}
                  <span className="mono">{regression.current.commitSha.slice(0, 8)}</span>
                  {regression.breachedThreshold
                    ? ` — below the ${regression.threshold} threshold`
                    : ""}
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}

      <h2>Gates</h2>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Gate</th>
              <th className="num">Runs</th>
              <th className="num">Pass rate</th>
              <th className="num">Median</th>
              <th className="num">p95</th>
              <th className="num">Flake rate</th>
            </tr>
          </thead>
          <tbody>
            {reliability.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No results yet. Run <code>npm run gk -- run</code> in the repo.
                </td>
              </tr>
            ) : (
              reliability.map((gate) => {
                const flake = flakeByKey.get(gate.gateKey);
                return (
                  <tr key={gate.gateKey}>
                    <td className="mono">{gate.gateKey}</td>
                    <td className="num">{gate.runs}</td>
                    <td className="num">{formatRate(gate.passRate)}</td>
                    <td className="num">{formatDuration(gate.medianDurationMs)}</td>
                    <td className="num">{formatDuration(gate.p95DurationMs)}</td>
                    <td className="num">
                      {/* null means never retried — no evidence, which is
                          not the same as evidence of reliability. */}
                      {flake?.flakeRate === null || flake === undefined ? (
                        <span className="muted" title="Never run twice on one commit">
                          —
                        </span>
                      ) : flake.flakeRate > 0 ? (
                        <span className="badge badge-warn">
                          {formatRate(flake.flakeRate)}
                        </span>
                      ) : (
                        formatRate(flake.flakeRate)
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {histories.some((entry) => entry.points.length > 1) ? (
        <>
          <h2>Metrics</h2>
          <div className="grid grid-2">
            {histories
              .filter((entry) => entry.points.length > 1)
              .map(({ gate, points }) => (
                <div key={gate.key} className="card">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                    }}
                  >
                    <strong>{gate.metricName}</strong>
                    <span className="mono">{points[points.length - 1]!.value}</span>
                  </div>
                  <Sparkline
                    values={points.map((point) => point.value)}
                    direction={gate.metricDirection!}
                  />
                  <div className="muted" style={{ fontSize: "0.78rem" }}>
                    {points.length} points ·{" "}
                    {gate.metricDirection === "higher_is_better"
                      ? "higher is better"
                      : "lower is better"}
                  </div>
                </div>
              ))}
          </div>
        </>
      ) : null}

      <h2>Recent runs</h2>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Commit</th>
              <th>Status</th>
              <th className="num">Duration</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No runs yet.
                </td>
              </tr>
            ) : (
              runs.map((run) => (
                <tr key={run.id}>
                  <td>
                    <Link href={`/runs/${run.id}`}>{formatAgo(run.startedAt)}</Link>
                  </td>
                  <td className="mono">
                    {run.commitSha.slice(0, 8)}
                    {/* A dirty tree means the result is not reproducible
                        from the commit alone. Say so rather than implying it. */}
                    {run.dirty ? (
                      <span className="badge badge-warn" style={{ marginLeft: "0.4rem" }}>
                        dirty
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <span className={statusBadgeClass(run.status)}>{run.status}</span>
                  </td>
                  <td className="num">{formatDuration(run.durationMs)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
