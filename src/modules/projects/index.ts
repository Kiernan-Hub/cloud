// Projects and their gates.
//
// A project is a repo on disk; gates are the commands that must pass for it.
// Gate definitions come from a config file the owner writes (see
// src/cli/sync-config.ts), so the command strings are trusted input from the
// person running the tool — the same trust level as a Makefile or a CI YAML.

import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { gates, projects } from "@/lib/db/schema";

export type Project = typeof projects.$inferSelect;
export type Gate = typeof gates.$inferSelect;

export type GateInput = {
  key: string;
  name: string;
  command: string;
  workingDir?: string | null;
  timeoutSeconds?: number;
  blocking?: boolean;
  enabled?: boolean;
  position?: number;
  metricName?: string | null;
  metricPattern?: string | null;
  metricDirection?: "higher_is_better" | "lower_is_better" | null;
  metricThreshold?: number | null;
};

export async function listProjects(): Promise<Project[]> {
  return db.select().from(projects).orderBy(asc(projects.name));
}

export async function getProject(id: string): Promise<Project | null> {
  const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return row ?? null;
}

export async function upsertProject(input: {
  id: string;
  name: string;
  repoPath: string;
  defaultBranch?: string;
  scheduleMinutes?: number | null;
}): Promise<Project> {
  const values = {
    id: input.id,
    name: input.name,
    repoPath: input.repoPath,
    defaultBranch: input.defaultBranch ?? "main",
    scheduleMinutes: input.scheduleMinutes ?? null,
  };

  const [row] = await db
    .insert(projects)
    .values(values)
    .onConflictDoUpdate({
      target: projects.id,
      set: { ...values, updatedAt: new Date() },
    })
    .returning();

  return row!;
}

export type DueProject = Project & {
  /** The last run that judged the full gate set, or null if there is none. */
  lastFullRunAt: Date | null;
};

/**
 * Projects the worker should run now.
 *
 * "Due" is measured from the last run that judged the *full* gate set. A
 * partial run deliberately does not reset the clock: it left gates unchecked,
 * so it is not a substitute for the scheduled sweep. Neither does a canceled
 * or still-running one, which established nothing yet.
 *
 * A project with no `scheduleMinutes` is never returned. Scheduled runs
 * execute the repo's own commands, so they happen only where the repo's
 * config asked for them.
 */
export async function projectsDueForRun(now = new Date()): Promise<DueProject[]> {
  const rows = await db
    .select({
      project: projects,
      // A `partial` or `canceled` run is not in this list, so it cannot
      // satisfy a schedule it never actually checked the gate set for.
      // The column is written out rather than interpolated: drizzle emits a
      // bare "id" inside a raw fragment, which the subquery would resolve
      // against check_runs instead of projects.
      lastFullRunAt: sql<Date | null>`(
        SELECT MAX(r.started_at)
        FROM check_runs r
        WHERE r.project_id = "projects"."id"
          AND r.status IN ('passed', 'failed', 'error')
      )`,
    })
    .from(projects)
    .where(sql`${projects.scheduleMinutes} IS NOT NULL`)
    .orderBy(asc(projects.name));

  return rows
    .map((row) => ({
      ...row.project,
      lastFullRunAt: row.lastFullRunAt === null ? null : new Date(row.lastFullRunAt),
    }))
    .filter((project) => {
      // Never run on this schedule before: due immediately.
      if (project.lastFullRunAt === null) return true;
      const dueAt = project.lastFullRunAt.getTime() + project.scheduleMinutes! * 60_000;
      return now.getTime() >= dueAt;
    });
}

export async function listGates(
  projectId: string,
  options?: { enabledOnly?: boolean },
): Promise<Gate[]> {
  const where = options?.enabledOnly
    ? and(eq(gates.projectId, projectId), eq(gates.enabled, true))
    : eq(gates.projectId, projectId);

  return db
    .select()
    .from(gates)
    .where(where)
    .orderBy(asc(gates.position), asc(gates.key));
}

export async function upsertGate(projectId: string, input: GateInput): Promise<Gate> {
  const values = {
    projectId,
    key: input.key,
    name: input.name,
    command: input.command,
    workingDir: input.workingDir ?? null,
    timeoutSeconds: input.timeoutSeconds ?? 300,
    blocking: input.blocking ?? true,
    enabled: input.enabled ?? true,
    position: input.position ?? 0,
    metricName: input.metricName ?? null,
    metricPattern: input.metricPattern ?? null,
    metricDirection: input.metricDirection ?? null,
    metricThreshold:
      input.metricThreshold === null || input.metricThreshold === undefined
        ? null
        : String(input.metricThreshold),
  };

  const [row] = await db
    .insert(gates)
    .values(values)
    .onConflictDoUpdate({
      target: [gates.projectId, gates.key],
      set: { ...values, updatedAt: new Date() },
    })
    .returning();

  return row!;
}

/**
 * Delete a project, its gates, and every result ever recorded for it.
 *
 * This is the one destructive operation in the tool, and it is deliberately
 * not something any other code path can reach: `gk sync` never removes a
 * project, and the worker never does either. Everywhere else, history is kept
 * — a deleted gate keeps its results, and retention drops output but never
 * rows. Here the caller is asking for the records to be gone, so they go, and
 * the caller is told what the count was first.
 *
 * Returns null when there is no such project, so the caller can say so rather
 * than reporting a successful deletion of nothing.
 */
export async function forgetProject(projectId: string): Promise<{ runs: number } | null> {
  const project = await getProject(projectId);
  if (!project) return null;

  const [counted] = await db.execute<{ runs: number }>(
    sql`SELECT COUNT(*)::int AS runs FROM check_runs WHERE project_id = ${projectId}`,
  );

  // gates and check_runs cascade from projects; gate_results cascades from
  // check_runs.
  await db.delete(projects).where(eq(projects.id, projectId));

  return { runs: counted?.runs ?? 0 };
}

/** How many runs a project has, for warning before `forgetProject`. */
export async function countRuns(projectId: string): Promise<number> {
  const [row] = await db.execute<{ runs: number }>(
    sql`SELECT COUNT(*)::int AS runs FROM check_runs WHERE project_id = ${projectId}`,
  );
  return row?.runs ?? 0;
}

/**
 * Remove gates that are no longer in the config.
 *
 * Their historical results survive: gate_results denormalizes gate_key,
 * project_id and commit_sha, so past runs stay readable after the gate
 * definition is gone. Deleting a gate discards the rule, not the record of
 * what it once found.
 */
export async function removeGatesNotIn(
  projectId: string,
  keepKeys: string[],
): Promise<string[]> {
  const existing = await listGates(projectId);
  const stale = existing.filter((gate) => !keepKeys.includes(gate.key));

  for (const gate of stale) {
    await db.delete(gates).where(eq(gates.id, gate.id));
  }

  return stale.map((gate) => gate.key);
}
