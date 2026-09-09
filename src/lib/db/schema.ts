// Gatekeeper schema.
//
// The domain: a *project* is a repo on disk. It has *gates* — commands that
// must pass (lint, typecheck, tests, build). A *check run* executes every
// enabled gate against one commit and records a *gate result* for each.
//
// Two things drive most of the design:
//
//   1. The same gate can run repeatedly on the *same commit*. That is not a
//      mistake to be deduplicated away — it is the only way to detect a
//      flaky gate, so the schema keeps every attempt rather than the latest.
//   2. A gate can emit a metric (coverage %, bundle size, duration). Those
//      need to be comparable over time to spot a regression, so they are a
//      first-class column, not buried in captured output.

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const projects = pgTable("projects", {
  id: text("id").primaryKey(), // slug
  name: text("name").notNull(),
  repoPath: text("repo_path").notNull(), // absolute path on this machine
  defaultBranch: text("default_branch").notNull().default("main"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

// Which direction is "better" for a gate's metric. Without this, a regression
// check cannot tell a coverage drop from a bundle-size drop.
export const metricDirectionEnum = pgEnum("metric_direction", [
  "higher_is_better",
  "lower_is_better",
]);

export const gates = pgTable(
  "gates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(), // slug, unique within the project
    name: text("name").notNull(),
    command: text("command").notNull(),
    workingDir: text("working_dir"), // relative to repoPath; null = repo root
    timeoutSeconds: integer("timeout_seconds").notNull().default(300),

    // A non-blocking gate still runs and is still recorded — it just does not
    // fail the run. Useful for a check you are trialling before enforcing.
    blocking: boolean("blocking").notNull().default(true),
    enabled: boolean("enabled").notNull().default(true),
    position: integer("position").notNull().default(0),

    // Optional metric extraction: a regex with one capture group, applied to
    // the gate's combined output.
    metricName: text("metric_name"),
    metricPattern: text("metric_pattern"),
    metricDirection: metricDirectionEnum("metric_direction"),
    metricThreshold: numeric("metric_threshold"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("gate_key_unique").on(table.projectId, table.key),
    index("gates_project_idx").on(table.projectId, table.position),
    check("positive_timeout", sql`${table.timeoutSeconds} > 0`),
    // A metric needs a name, a pattern and a direction, or none of them.
    // Half-configured metric extraction silently produces nothing.
    check(
      "metric_fully_configured",
      sql`(${table.metricName} IS NULL AND ${table.metricPattern} IS NULL AND ${table.metricDirection} IS NULL)
          OR (${table.metricName} IS NOT NULL AND ${table.metricPattern} IS NOT NULL AND ${table.metricDirection} IS NOT NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Check runs
// ---------------------------------------------------------------------------

// A run's verdict. Three of these exist because they call for different
// responses: `passed` means the full gate set ran clean, `partial` means it
// ran clean but not all of it ran, and `canceled` means it never reached a
// verdict at all. Collapsing the last two into `passed` or `failed` would
// invent news in one direction or the other.
export const runStatusEnum = pgEnum("run_status", [
  "running",
  "passed",
  "partial",
  "failed",
  "error",
  "canceled",
]);

export const triggerEnum = pgEnum("run_trigger", ["manual", "scheduled", "watch"]);

export const checkRuns = pgTable(
  "check_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    // Repo state at the moment of the run. Kept even if the commit is later
    // rebased away — the record is of what was checked, not of what still
    // exists.
    commitSha: text("commit_sha").notNull(),
    commitSubject: text("commit_subject"),
    branch: text("branch"),
    dirty: boolean("dirty").notNull().default(false), // uncommitted changes present

    status: runStatusEnum("status").notNull().default("running"),
    trigger: triggerEnum("trigger").notNull().default("manual"),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
  },
  (table) => [
    index("runs_project_time_idx").on(table.projectId, table.startedAt),
    // Flake detection reads every run for a commit, so this is the hot path.
    index("runs_commit_idx").on(table.projectId, table.commitSha),
    check(
      "finished_runs_have_end",
      sql`${table.status} = 'running' OR ${table.finishedAt} IS NOT NULL`,
    ),
    // Finding runs abandoned by a killed process, so they can be reconciled
    // instead of sitting in 'running' forever.
    index("runs_unfinished_idx")
      .on(table.startedAt)
      .where(sql`status = 'running'`),
  ],
);

// ---------------------------------------------------------------------------
// Gate results
// ---------------------------------------------------------------------------

export const gateStatusEnum = pgEnum("gate_status", [
  "passed",
  "failed",
  "timed_out",
  "skipped",
  "error", // could not execute at all (bad command, missing dir)
]);

export const gateResults = pgTable(
  "gate_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => checkRuns.id, { onDelete: "cascade" }),
    gateId: uuid("gate_id")
      .notNull()
      .references(() => gates.id, { onDelete: "cascade" }),

    // Denormalized so history survives a gate being renamed or deleted.
    // A result must stay readable even when its gate is gone.
    gateKey: text("gate_key").notNull(),
    projectId: text("project_id").notNull(),
    commitSha: text("commit_sha").notNull(),

    status: gateStatusEnum("status").notNull(),
    exitCode: integer("exit_code"),
    durationMs: integer("duration_ms").notNull(),

    // Output is capped, not stored whole: a failing test suite can emit
    // megabytes and the tail is what tells you what broke.
    stdoutTail: text("stdout_tail"),
    stderrTail: text("stderr_tail"),
    truncated: boolean("truncated").notNull().default(false),

    metricValue: numeric("metric_value"),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // One result per gate per run. Repeated runs of the same commit are
    // separate rows — that repetition is the flake signal.
    uniqueIndex("one_result_per_gate_per_run").on(table.runId, table.gateId),
    index("results_gate_history_idx").on(table.gateId, table.startedAt),
    index("results_flake_idx").on(table.projectId, table.gateKey, table.commitSha),
    check("non_negative_duration", sql`${table.durationMs} >= 0`),
  ],
);
