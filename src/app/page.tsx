import Link from "next/link";

import { projectSummary } from "@/modules/analysis";
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

  return (
    <>
      <h2>Projects</h2>
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
