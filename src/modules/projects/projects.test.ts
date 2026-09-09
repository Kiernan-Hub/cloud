// The registry, and the one piece of real logic in it: deciding which
// projects the worker is allowed to run, and when.

import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, sqlClient } from "@/lib/db";
import { checkRuns } from "@/lib/db/schema";
import { projectsDueForRun, upsertProject } from "./index";

const SCHEDULED = "test-projects-scheduled";
const MANUAL = "test-projects-manual";

async function cleanup() {
  await db.execute(sql`DELETE FROM projects WHERE id IN (${SCHEDULED}, ${MANUAL})`);
}

/** A finished run, backdated by `minutesAgo`. */
async function recordRun(
  projectId: string,
  status: "passed" | "failed" | "error" | "partial" | "canceled" | "running",
  minutesAgo: number,
) {
  const at = new Date(Date.now() - minutesAgo * 60_000);
  await db.insert(checkRuns).values({
    projectId,
    commitSha: "a".repeat(40),
    status,
    startedAt: at,
    finishedAt: status === "running" ? null : at,
    durationMs: status === "running" ? null : 1000,
  });
}

beforeEach(cleanup);

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("projectsDueForRun", () => {
  it("never returns a project that did not ask for scheduled runs", async () => {
    await upsertProject({ id: MANUAL, name: "Manual", repoPath: "/tmp/manual" });

    // The worker executes the repo's own commands on this machine. Doing
    // that unasked, on a loop, is not a surprise anyone should discover.
    expect(await projectsDueForRun()).toEqual([]);
  });

  it("returns a scheduled project that has never run", async () => {
    await upsertProject({
      id: SCHEDULED,
      name: "Scheduled",
      repoPath: "/tmp/scheduled",
      scheduleMinutes: 60,
    });

    const due = await projectsDueForRun();
    expect(due.map((project) => project.id)).toEqual([SCHEDULED]);
    expect(due[0]!.lastFullRunAt).toBeNull();
  });

  it("holds off until the interval has elapsed", async () => {
    await upsertProject({
      id: SCHEDULED,
      name: "Scheduled",
      repoPath: "/tmp/scheduled",
      scheduleMinutes: 60,
    });
    await recordRun(SCHEDULED, "passed", 30);

    expect(await projectsDueForRun()).toEqual([]);

    await recordRun(SCHEDULED, "passed", 61);
    // The most recent full run is still 30 minutes ago, so still not due.
    expect(await projectsDueForRun()).toEqual([]);
  });

  it("comes due once the interval has passed", async () => {
    await upsertProject({
      id: SCHEDULED,
      name: "Scheduled",
      repoPath: "/tmp/scheduled",
      scheduleMinutes: 60,
    });
    await recordRun(SCHEDULED, "passed", 61);

    expect((await projectsDueForRun()).map((p) => p.id)).toEqual([SCHEDULED]);
  });

  it("counts a failed run — the schedule is about cadence, not success", async () => {
    await upsertProject({
      id: SCHEDULED,
      name: "Scheduled",
      repoPath: "/tmp/scheduled",
      scheduleMinutes: 60,
    });
    await recordRun(SCHEDULED, "failed", 10);

    // A failing gate suite must not be re-run every tick just for failing.
    expect(await projectsDueForRun()).toEqual([]);
  });

  it("does not let a partial run reset the clock", async () => {
    await upsertProject({
      id: SCHEDULED,
      name: "Scheduled",
      repoPath: "/tmp/scheduled",
      scheduleMinutes: 60,
    });
    await recordRun(SCHEDULED, "partial", 1);

    // A partial run left gates unchecked, so it is not a substitute for the
    // scheduled sweep over the full gate set.
    expect((await projectsDueForRun()).map((p) => p.id)).toEqual([SCHEDULED]);
  });

  it("does not let a canceled or still-running run reset the clock", async () => {
    await upsertProject({
      id: SCHEDULED,
      name: "Scheduled",
      repoPath: "/tmp/scheduled",
      scheduleMinutes: 60,
    });
    await recordRun(SCHEDULED, "canceled", 1);
    await recordRun(SCHEDULED, "running", 1);

    // Neither established anything, so neither is evidence the project was
    // checked.
    expect((await projectsDueForRun()).map((p) => p.id)).toEqual([SCHEDULED]);
  });

  it("rejects a schedule too short to be a schedule", async () => {
    // A gate suite slower than its own interval would run back-to-back
    // forever, which is a busy loop wearing a schedule's clothes.
    await expect(
      upsertProject({
        id: SCHEDULED,
        name: "Scheduled",
        repoPath: "/tmp/scheduled",
        scheduleMinutes: 1,
      }),
    ).rejects.toThrow();
  });

  it("turns scheduling back off when the config drops it", async () => {
    const base = { id: SCHEDULED, name: "Scheduled", repoPath: "/tmp/scheduled" };
    await upsertProject({ ...base, scheduleMinutes: 60 });
    expect(await projectsDueForRun()).toHaveLength(1);

    // Removing the field from gatekeeper.json must actually stop the worker,
    // not leave the old cadence running invisibly.
    await upsertProject(base);
    expect(await projectsDueForRun()).toEqual([]);
  });
});
