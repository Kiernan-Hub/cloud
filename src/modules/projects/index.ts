// Projects and their gates.
//
// A project is a repo on disk; gates are the commands that must pass for it.
// Gate definitions come from a config file the owner writes (see
// src/cli/sync-config.ts), so the command strings are trusted input from the
// person running the tool — the same trust level as a Makefile or a CI YAML.

import { and, asc, eq } from "drizzle-orm";

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
}): Promise<Project> {
  const [row] = await db
    .insert(projects)
    .values({
      id: input.id,
      name: input.name,
      repoPath: input.repoPath,
      defaultBranch: input.defaultBranch ?? "main",
    })
    .onConflictDoUpdate({
      target: projects.id,
      set: {
        name: input.name,
        repoPath: input.repoPath,
        defaultBranch: input.defaultBranch ?? "main",
        updatedAt: new Date(),
      },
    })
    .returning();

  return row!;
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
