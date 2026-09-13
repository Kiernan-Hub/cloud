import Link from "next/link";
import { notFound } from "next/navigation";

import { getRun } from "@/modules/runs";

import { formatAgo, formatDuration, statusBadgeClass } from "../../_components/format";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: PageProps<"/runs/[runId]">) {
  const { runId } = await params;

  const found = await getRun(runId);
  if (!found) notFound();

  const { run, results } = found;

  return (
    <>
      <Link className="back-link" href={`/projects/${run.projectId}`}>
        ← {run.projectId}
      </Link>

      <h2 style={{ marginTop: 0 }}>
        Run <span className="mono">{run.id.slice(0, 8)}</span>{" "}
        <span className={statusBadgeClass(run.status)}>{run.status}</span>
      </h2>

      <p className="muted">
        <span className="mono">{run.commitSha.slice(0, 12)}</span>
        {run.branch ? ` on ${run.branch}` : " (detached)"} · {formatAgo(run.startedAt)} ·{" "}
        {formatDuration(run.durationMs)} · {run.trigger}
      </p>

      {run.commitSubject ? <p>{run.commitSubject}</p> : null}

      {run.dirty ? (
        <p className="notice notice-warn" role="status">
          <strong>The working tree was dirty.</strong> This result cannot be reproduced
          from the commit alone — uncommitted changes were present when the gates ran.
        </p>
      ) : null}

      {run.status === "partial" ? (
        <p className="notice notice-warn" role="status">
          <strong>Not every gate ran.</strong> The gates below marked <code>skipped</code>{" "}
          were not executed, so this run says nothing about them.
        </p>
      ) : null}

      {run.status === "canceled" ? (
        <p className="notice notice-warn" role="status">
          <strong>This run was interrupted.</strong> It never reached a verdict, so it
          counts neither for nor against the gates and is excluded from the pass rate.
        </p>
      ) : null}

      <h2>Gates</h2>
      {results.map((result) => {
        const output = [result.stdoutTail, result.stderrTail]
          .filter((part) => part && part.trim())
          .join("\n");

        return (
          <div key={result.id} className="card" style={{ marginBottom: "0.75rem" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: "1rem",
              }}
            >
              <strong className="mono">{result.gateKey}</strong>
              <span>
                <span className="muted" style={{ marginRight: "0.6rem" }}>
                  {/* A skipped gate has no duration to report. Showing 0ms
                      would read as a gate that ran instantly. */}
                  {result.status === "skipped"
                    ? "not run"
                    : formatDuration(result.durationMs)}
                  {result.exitCode !== null ? ` · exit ${result.exitCode}` : ""}
                  {result.metricValue !== null ? ` · ${result.metricValue}` : ""}
                </span>
                <span className={statusBadgeClass(result.status)}>{result.status}</span>
              </span>
            </div>

            {output ? (
              <details open={result.status !== "passed"} style={{ marginTop: "0.6rem" }}>
                <summary
                  className="muted"
                  style={{ cursor: "pointer", fontSize: "0.85rem" }}
                >
                  Output{result.truncated ? " (tail only — output was truncated)" : ""}
                </summary>
                <pre className="output" style={{ marginTop: "0.5rem" }}>
                  {output}
                </pre>
              </details>
            ) : (
              <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.85rem" }}>
                {result.status === "skipped"
                  ? "Excluded from this run."
                  : result.outputPruned
                    ? // Output existed; retention dropped it. Saying "no output"
                      // would blame the gate for our housekeeping.
                      "Output aged out of retention — the result itself is kept."
                    : "No output captured."}
              </p>
            )}
          </div>
        );
      })}
    </>
  );
}
