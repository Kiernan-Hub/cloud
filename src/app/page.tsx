import Link from "next/link";

import {
  findRegressions,
  gateFlakiness,
  metricDrift,
  projectSummary,
} from "@/modules/analysis";
import { listProjects } from "@/modules/projects";

import { formatAgo, formatRate, statusBadgeClass } from "./_components/format";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let projects;
  try {
    projects = await listProjects();
  } catch {
    return (
      <div className="notice" role="alert">
        <h2>Can&apos;t reach the database</h2>
        <p>
          Start Postgres (<code>docker compose up -d</code>) and apply migrations with{" "}
          <code>npm run db:migrate</code>.
        </p>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="notice">
        <h2>No projects yet</h2>
        <p>Register one from inside any repo on this machine:</p>
        <pre className="output">
          {`cd ~/code/your-project
npm run gk -- init     # writes gatekeeper.json
npm run gk -- sync     # registers it here
npm run gk -- run      # runs the gates`}
        </pre>
      </div>
    );
  }

  const summaries = await Promise.all(
    projects.map(async (project) => ({
      project,
      summary: await projectSummary(project.id),
    })),
  );

  // The findings are the point of the tool, and they were only reachable by
  // opening each project in turn. A handful of extra queries on a local tool
  // with a handful of projects is a fair price for not having to hunt.
  const findings = (
    await Promise.all(
      projects.map(async (project) => {
        const [flakiness, drifts, regressions] = await Promise.all([
          gateFlakiness(project.id),
          metricDrift(project.id),
          findRegressions(project.id),
        ]);

        return [
          ...flakiness
            .filter((gate) => gate.flakeRate !== null && gate.flakeRate > 0)
            .map((gate) => ({
              project,
              key: `flaky-${project.id}-${gate.gateKey}`,
              what: `${gate.gateKey} is flaky`,
              detail: `disagreed with itself on ${gate.commitsInconsistent} of ${gate.commitsRetried} commits it was re-run on`,
            })),
          ...drifts.map((drift) => ({
            project,
            key: `drift-${project.id}-${drift.gateKey}`,
            what: `${drift.metricName} is drifting`,
            detail: `${drift.earlierMedian} → ${drift.recentMedian} across the last ${drift.halfSize * 2} runs`,
          })),
          ...regressions.map((regression) => ({
            project,
            key: `regression-${project.id}-${regression.gateKey}`,
            what: `${regression.metricName} regressed`,
            detail: `${regression.previous.value} → ${regression.current.value} on ${regression.current.commitSha.slice(0, 8)}`,
          })),
        ];
      }),
    )
  ).flat();

  // A project with no runs is not a healthy project, it is an unmeasured one.
  // Counting it as quiet would be the same lie as a 0% flake rate.
  const unmeasured = summaries.filter(({ summary }) => summary.totalRuns === 0).length;

  return (
    <>
      {findings.length > 0 ? (
        <>
          <h2 style={{ marginTop: 0 }}>Needs attention</h2>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>What</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((finding) => (
                  <tr key={finding.key}>
                    <td>
                      <Link href={`/projects/${finding.project.id}`}>
                        {finding.project.name}
                      </Link>
                    </td>
                    <td>{finding.what}</td>
                    <td className="muted">{finding.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <h2 style={findings.length > 0 ? undefined : { marginTop: 0 }}>Projects</h2>
      {unmeasured > 0 ? (
        <p className="muted" style={{ marginTop: "-0.5rem", fontSize: "0.85rem" }}>
          {unmeasured} of {summaries.length}{" "}
          {unmeasured === 1 ? "project has" : "projects have"} no runs yet — nothing is
          known about {unmeasured === 1 ? "it" : "them"} either way.
        </p>
      ) : null}
      <div className="grid">
        {summaries.map(({ project, summary }) => (
          <div key={project.id} className="card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "1rem",
                alignItems: "baseline",
              }}
            >
              <h3 style={{ margin: 0, fontSize: "1rem" }}>
                <Link href={`/projects/${project.id}`}>{project.name}</Link>
              </h3>
              {summary.lastStatus ? (
                <span className={statusBadgeClass(summary.lastStatus)}>
                  {summary.lastStatus}
                </span>
              ) : (
                <span className="badge">no runs</span>
              )}
            </div>

            <p className="muted mono" style={{ margin: "0.3rem 0 0.75rem" }}>
              {project.repoPath}
            </p>

            <div className="grid grid-4">
              <div className="stat">
                <div className="stat-value">{formatRate(summary.passRate)}</div>
                <div className="stat-label">Pass rate</div>
              </div>
              <div className="stat">
                <div className="stat-value">{summary.totalRuns}</div>
                <div className="stat-label">Runs</div>
              </div>
              <div className="stat">
                <div className="stat-value">{summary.failed}</div>
                <div className="stat-label">Failed</div>
              </div>
              <div className="stat">
                <div className="stat-value">{formatAgo(summary.lastRunAt)}</div>
                <div className="stat-label">Last run</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
