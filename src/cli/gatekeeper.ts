// Gatekeeper CLI.
//
//   gatekeeper init  [--repo <path>]   write a starter gatekeeper.json
//   gatekeeper sync  [--repo <path>]   register the project and its gates
//   gatekeeper run   [--repo <path>] [--only lint,test] [--repeat N]
//   gatekeeper show  [run-id]          replay a run's captured output
//   gatekeeper list                    show registered projects
//
// `run` exits non-zero when a blocking gate fails, so it works as a git hook
// or as the last step of a script.

import { access, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  exampleGatefile,
  GATEFILE_NAME,
  GatefileError,
  loadGatefile,
} from "@/lib/config";
import { sqlClient } from "@/lib/db";
import { logger } from "@/lib/log";
import { tallyAttempts } from "@/modules/analysis";
import {
  listProjects,
  removeGatesNotIn,
  upsertGate,
  upsertProject,
} from "@/modules/projects";
import {
  getRun,
  latestRun,
  RunCanceled,
  runChecks,
  type RunSummary,
} from "@/modules/runs";

const { values, positionals } = parseArgs({
  options: {
    repo: { type: "string" },
    only: { type: "string" },
    trigger: { type: "string", default: "manual" },
    repeat: { type: "string" },
    all: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
  allowPositionals: true,
});

const USAGE = `
gatekeeper — run and track your project's quality gates

  gatekeeper init   [--repo <path>]        write a starter ${GATEFILE_NAME}
  gatekeeper sync   [--repo <path>]        register the project and its gates
  gatekeeper run    [--repo <path>] [--only lint,test] [--repeat N]
  gatekeeper show   [run-id] [--all]       replay a run's captured output
  gatekeeper list                          list registered projects

--repeat runs the gates N times on one commit to hunt a flaky gate.
--repo defaults to the current directory.
show defaults to the latest run, and to the gates that did not pass.
run exits non-zero if a blocking gate fails.
`;

const out = (text: string) => process.stdout.write(`${text}\n`);
const err = (text: string) => process.stderr.write(`${text}\n`);

const repoPath = resolve(values.repo ?? process.cwd());

// A ceiling on --repeat. Each attempt runs the real gate commands, so a
// mistyped number is somebody's afternoon.
const MAX_REPEAT = 50;

const ICONS: Record<string, string> = {
  passed: "✓",
  failed: "✗",
  timed_out: "⏱",
  error: "!",
  skipped: "-",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
}

async function cmdInit(): Promise<number> {
  const target = `${repoPath}/${GATEFILE_NAME}`;
  try {
    await access(target);
    err(`${GATEFILE_NAME} already exists at ${target}`);
    return 1;
  } catch {
    // Does not exist, which is what we want.
  }

  const name = basename(repoPath);
  const id = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  await writeFile(target, exampleGatefile(name, id || "project"), "utf8");

  out(`Wrote ${target}`);
  out("");
  out("Edit the gates to match your project, then:");
  out("  gatekeeper sync");
  out("  gatekeeper run");
  return 0;
}

async function cmdSync(): Promise<number> {
  const config = await loadGatefile(repoPath);

  await upsertProject({
    id: config.project.id,
    name: config.project.name,
    repoPath,
    defaultBranch: config.project.defaultBranch,
    scheduleMinutes: config.project.scheduleMinutes ?? null,
  });

  for (const [index, gate] of config.gates.entries()) {
    await upsertGate(config.project.id, {
      key: gate.key,
      name: gate.name,
      command: gate.command,
      workingDir: gate.workingDir ?? null,
      timeoutSeconds: gate.timeoutSeconds,
      blocking: gate.blocking,
      enabled: gate.enabled,
      position: index,
      metricName: gate.metric?.name ?? null,
      metricPattern: gate.metric?.pattern ?? null,
      metricDirection: gate.metric?.direction ?? null,
      metricThreshold: gate.metric?.threshold ?? null,
    });
  }

  const removed = await removeGatesNotIn(
    config.project.id,
    config.gates.map((gate) => gate.key),
  );

  out(`Synced '${config.project.id}': ${config.gates.length} gate(s).`);
  // Say plainly whether the worker will now run these commands unprompted.
  out(
    config.project.scheduleMinutes
      ? `Scheduled runs: every ${formatMinutes(config.project.scheduleMinutes)} (needs \`npm run worker\`).`
      : "Scheduled runs: off. Add project.scheduleMinutes to enable them.",
  );
  if (removed.length > 0) {
    // Say what was dropped and that the history survived it.
    out(`Removed gates no longer in config: ${removed.join(", ")}`);
    out("(Their past results are kept.)");
  }
  return 0;
}

async function cmdRun(): Promise<number> {
  const config = await loadGatefile(repoPath);
  const only = values.only
    ?.split(",")
    .map((key) => key.trim())
    .filter(Boolean);

  const trigger = values.trigger;
  if (trigger !== "manual" && trigger !== "scheduled" && trigger !== "watch") {
    err(`--trigger must be manual, scheduled or watch`);
    return 2;
  }

  const repeat = Number(values.repeat ?? 1);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > MAX_REPEAT) {
    err(`--repeat must be a whole number from 1 to ${MAX_REPEAT}`);
    return 2;
  }

  // Ctrl-C kills the running gate's process group and closes the run as
  // canceled. Without this the gate command would carry on detached, and the
  // run row would sit in 'running' forever — excluded from every statistic,
  // so it would erase itself rather than report that it never finished.
  const aborter = new AbortController();
  // A holder rather than a bare `let`: the assignment happens in a callback,
  // which control-flow analysis cannot see, so a plain variable narrows to
  // `never` by the time the catch reads it.
  const active: { runId: string | null } = { runId: null };
  const interrupt = (signal: string) => {
    if (aborter.signal.aborted) return;
    err(`\nInterrupted (${signal}). Stopping the current gate…`);
    aborter.abort();
  };
  const onSigint = () => interrupt("SIGINT");
  const onSigterm = () => interrupt("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  const attempts: RunSummary[] = [];
  try {
    for (let attempt = 1; attempt <= repeat; attempt += 1) {
      if (repeat > 1) out(`Attempt ${attempt}/${repeat}`);
      attempts.push(
        await runChecks({
          projectId: config.project.id,
          repoPath,
          trigger,
          only,
          signal: aborter.signal,
          onRunStart: (id) => {
            active.runId = id;
          },
          onGateStart: (gate) => out(`  … ${gate.name}`),
        }),
      );
    }
  } catch (error: unknown) {
    if (error instanceof RunCanceled) {
      err(`Run ${active.runId?.slice(0, 8) ?? "?"} recorded as canceled.`);
      return 130;
    }
    throw error;
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }

  if (repeat > 1) return reportRepeats(attempts);

  const summary = attempts[0]!;

  out("");
  for (const result of summary.results) {
    const icon = ICONS[result.status] ?? "?";
    const tag = result.blocking ? "" : " (non-blocking)";
    const metric = result.metricValue !== null ? `  [${result.metricValue}]` : "";
    const duration =
      result.status === "skipped" ? "" : formatDuration(result.durationMs).padStart(8);
    out(`  ${icon} ${result.gateName.padEnd(20)} ${duration}${metric}${tag}`);
  }

  out("");
  out(
    `${summary.status.toUpperCase()} in ${formatDuration(summary.durationMs)}  ` +
      `(run ${summary.runId.slice(0, 8)})`,
  );

  if (summary.skipped.length > 0) {
    // Say what was not checked. A partial run that reads as a pass is the
    // whole problem this status exists to avoid.
    out(`  ${summary.skipped.length} gate(s) not run: ${summary.skipped.join(", ")}`);
  }

  const broken = summary.results.filter(
    (result) =>
      result.blocking && result.status !== "passed" && result.status !== "skipped",
  );
  if (broken.length > 0) {
    out("");
    for (const result of broken) {
      out(`  ${result.gateName}: ${result.status}, exit ${result.exitCode ?? "n/a"}`);
    }
    out("");
    out(`Full output: gatekeeper show ${summary.runId.slice(0, 8)}`);
  }

  // Non-zero on failure, so this works as a pre-push hook. A partial run is
  // not a failure: the caller asked for a subset and got it, and the record
  // says which gates were left out.
  return summary.status === "passed" || summary.status === "partial" ? 0 : 1;
}

/**
 * Report what repeating the gates actually established.
 *
 * Running the same gate on the same commit is the only way to catch one that
 * disagrees with itself, so this is the deliberate version of the measurement
 * the tool is built around. The verdict it can offer depends entirely on
 * whether the input was really held still — see the dirty-tree case below.
 */
function reportRepeats(attempts: RunSummary[]): number {
  const tally = tallyAttempts(attempts.map((attempt) => attempt.results));
  const disagreed = tally.filter((entry) => entry.inconsistent);

  out("");
  for (const entry of tally) {
    const icon = entry.inconsistent ? "~" : entry.passed === entry.ran ? "✓" : "✗";
    out(
      `  ${icon} ${entry.gateName.padEnd(20)} ${entry.passed}/${entry.ran} passed` +
        (entry.inconsistent ? "  — disagreed with itself" : ""),
    );
  }

  out("");
  const commit = attempts[0]!.commitSha.slice(0, 8);

  if (attempts[0]!.dirty) {
    // The whole point of repeating is holding the input still. A dirty tree
    // means it was not held still, so none of this counts as flake evidence
    // and the stored results are excluded from flake detection. Saying
    // "consistent" here would be the exact false confidence the tool exists
    // to remove.
    out(`Ran ${attempts.length} times, but the working tree is dirty.`);
    out("These attempts prove nothing about flakiness: the commit does not");
    out("identify the code that ran. Commit or stash, then repeat.");
    return worstExitCode(attempts);
  }

  if (disagreed.length > 0) {
    out(
      `FLAKY on ${commit}: ${disagreed.length} gate(s) gave different answers ` +
        `across ${attempts.length} attempts.`,
    );
    out("Same commit, same input, different result — that is a gate problem.");
    // Finding the flake is the goal, so it is reported as a finding.
    return 1;
  }

  out(`CONSISTENT across ${attempts.length} attempts on ${commit}.`);
  return worstExitCode(attempts);
}

function worstExitCode(attempts: RunSummary[]): number {
  return attempts.every(
    (attempt) => attempt.status === "passed" || attempt.status === "partial",
  )
    ? 0
    : 1;
}

/**
 * Replay a stored run in the terminal.
 *
 * The output is already captured; needing to start a web server to read it is
 * friction exactly when someone is mid-debug. Defaults to the latest run and
 * to the gates that did not pass, since that is what a person is looking for.
 */
async function cmdShow(): Promise<number> {
  const runId = positionals[1];

  let found;
  if (runId) {
    found = await getRun(runId);
    if (!found) {
      err(`No run found with id '${runId}'.`);
      return 1;
    }
  } else {
    const config = await loadGatefile(repoPath);
    const latest = await latestRun(config.project.id);
    if (!latest) {
      err(`No runs recorded for '${config.project.id}' yet.`);
      return 1;
    }
    found = await getRun(latest.id);
    if (!found) return 1;
  }

  const { run, results } = found;

  out(`Run ${run.id.slice(0, 8)}  ${run.status.toUpperCase()}`);
  out(
    `  ${run.commitSha.slice(0, 12)}${run.branch ? ` on ${run.branch}` : " (detached)"}` +
      `  ${run.durationMs === null ? "—" : formatDuration(run.durationMs)}  ${run.trigger}`,
  );
  if (run.commitSubject) out(`  ${run.commitSubject}`);

  // The same caveats the dashboard shows. A terminal reader deserves them
  // just as much as a browser one.
  if (run.dirty) {
    out("  ! Working tree was dirty — not reproducible from the commit alone.");
  }
  if (run.status === "partial") {
    out("  ! Not every gate ran; the skipped ones say nothing either way.");
  }
  if (run.status === "canceled") {
    out("  ! Interrupted before reaching a verdict.");
  }

  const interesting = values.all
    ? results
    : results.filter((result) => result.status !== "passed");

  out("");
  for (const result of results) {
    const icon = ICONS[result.status] ?? "?";
    const duration =
      result.status === "skipped" ? "not run" : formatDuration(result.durationMs);
    out(`  ${icon} ${result.gateKey.padEnd(20)} ${duration}`);
  }

  for (const result of interesting) {
    const output = [result.stdoutTail, result.stderrTail]
      .filter((part) => part && part.trim())
      .join("\n");
    if (!output) continue;

    out("");
    out(`── ${result.gateKey} ${"─".repeat(Math.max(0, 60 - result.gateKey.length))}`);
    // Say so rather than letting a partial log read as the whole story.
    if (result.truncated) out("(tail only — earlier output was dropped)");
    out(output);
  }

  if (interesting.length === 0) {
    out("");
    out("Everything passed. Use --all to see their output too.");
  }

  return 0;
}

async function cmdList(): Promise<number> {
  const all = await listProjects();
  if (all.length === 0) {
    out("No projects registered. Run `gatekeeper sync` inside a repo.");
    return 0;
  }
  for (const project of all) {
    // Which repos the worker will run unprompted is worth being able to see
    // at a glance, not something to go read a config file for.
    const schedule = project.scheduleMinutes
      ? `every ${formatMinutes(project.scheduleMinutes)}`
      : "manual only";
    out(`  ${project.id.padEnd(24)} ${schedule.padEnd(14)} ${project.repoPath}`);
  }
  return 0;
}

async function main(): Promise<number> {
  const command = positionals[0];

  if (values.help || !command) {
    out(USAGE);
    return command ? 0 : 1;
  }

  switch (command) {
    case "init":
      return cmdInit();
    case "sync":
      return cmdSync();
    case "run":
      return cmdRun();
    case "show":
      return cmdShow();
    case "list":
      return cmdList();
    default:
      err(`Unknown command: ${command}`);
      out(USAGE);
      return 1;
  }
}

main()
  .then(async (code) => {
    await sqlClient.end();
    process.exit(code);
  })
  .catch(async (error: unknown) => {
    if (error instanceof GatefileError) {
      err(`${error.message}\n  at ${error.path}`);
    } else {
      logger.error("command failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await sqlClient.end();
    process.exit(2);
  });
