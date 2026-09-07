// Gatekeeper CLI.
//
//   gatekeeper init  [--repo <path>]   write a starter gatekeeper.json
//   gatekeeper sync  [--repo <path>]   register the project and its gates
//   gatekeeper run   [--repo <path>] [--only lint,test]
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
import {
  listProjects,
  removeGatesNotIn,
  upsertGate,
  upsertProject,
} from "@/modules/projects";
import { runChecks } from "@/modules/runs";

const { values, positionals } = parseArgs({
  options: {
    repo: { type: "string" },
    only: { type: "string" },
    trigger: { type: "string", default: "manual" },
    help: { type: "boolean", default: false },
  },
  allowPositionals: true,
});

const USAGE = `
gatekeeper — run and track your project's quality gates

  gatekeeper init   [--repo <path>]        write a starter ${GATEFILE_NAME}
  gatekeeper sync   [--repo <path>]        register the project and its gates
  gatekeeper run    [--repo <path>] [--only lint,test]
  gatekeeper list                          list registered projects

--repo defaults to the current directory.
run exits non-zero if a blocking gate fails.
`;

const out = (text: string) => process.stdout.write(`${text}\n`);
const err = (text: string) => process.stderr.write(`${text}\n`);

const repoPath = resolve(values.repo ?? process.cwd());

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

  const summary = await runChecks({
    projectId: config.project.id,
    repoPath,
    trigger,
    only,
    onGateStart: (gate) => out(`  … ${gate.name}`),
  });

  out("");
  for (const result of summary.results) {
    const icon = ICONS[result.status] ?? "?";
    const tag = result.blocking ? "" : " (non-blocking)";
    const metric = result.metricValue !== null ? `  [${result.metricValue}]` : "";
    out(
      `  ${icon} ${result.gateName.padEnd(20)} ${formatDuration(result.durationMs).padStart(8)}${metric}${tag}`,
    );
  }

  out("");
  out(
    `${summary.status.toUpperCase()} in ${formatDuration(summary.durationMs)}  ` +
      `(run ${summary.runId.slice(0, 8)})`,
  );

  if (summary.status !== "passed") {
    const broken = summary.results.filter(
      (result) => result.blocking && result.status !== "passed",
    );
    out("");
    for (const result of broken) {
      out(`  ${result.gateName}: ${result.status}, exit ${result.exitCode ?? "n/a"}`);
    }
    out("");
    out("Full output: npm run dev  →  the dashboard shows captured logs.");
  }

  // Non-zero on failure, so this works as a pre-push hook.
  return summary.status === "passed" ? 0 : 1;
}

async function cmdList(): Promise<number> {
  const all = await listProjects();
  if (all.length === 0) {
    out("No projects registered. Run `gatekeeper sync` inside a repo.");
    return 0;
  }
  for (const project of all) {
    out(`  ${project.id.padEnd(24)} ${project.repoPath}`);
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
