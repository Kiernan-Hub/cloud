// The CLI as a user meets it: a real subprocess, a real temp directory.
//
// These spawn the command rather than importing it, because what is being
// tested is the process — its exit code, and what it needs from the
// environment before it will run at all.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDb, db } from "@/lib/db";
import { getProject, upsertProject } from "@/modules/projects";

const run = promisify(execFile);
const CLI = join(process.cwd(), "src", "cli", "gatekeeper.ts");

let repoPath: string;

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), "gatekeeper-cli-"));
});

afterEach(async () => {
  await rm(repoPath, { recursive: true, force: true });
});

/** Run the CLI with the test runner's environment, database included. */
async function withDatabase(args: string[]) {
  try {
    const { stdout } = await run("npx", ["tsx", CLI, ...args], { env: process.env });
    return { code: 0, stdout };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: failure.code ?? 1,
      stdout: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

/** Run the CLI with DATABASE_URL removed, whatever the test runner has set. */
async function withoutDatabase(args: string[]) {
  const env = { ...process.env };
  delete env.DATABASE_URL;

  try {
    const { stdout } = await run("npx", ["tsx", CLI, ...args], { env });
    return { code: 0, stdout };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: failure.code ?? 1,
      stdout: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

describe("gatekeeper init", () => {
  it("works with no database configured at all", async () => {
    // The first command anyone runs, in a repo where nothing is set up yet.
    // It writes a file and touches no storage, so requiring a database would
    // be a wall in front of the front door — and it used to be one: init
    // wrote the file, printed success, then exited non-zero because the exit
    // path opened a connection purely in order to close it.
    const result = await withoutDatabase(["init", "--repo", repoPath]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Wrote");

    const written = await readFile(join(repoPath, "gatekeeper.json"), "utf8");
    expect(JSON.parse(written)).toMatchObject({ project: { id: expect.any(String) } });
  });

  it("refuses to overwrite an existing config", async () => {
    await withoutDatabase(["init", "--repo", repoPath]);
    const second = await withoutDatabase(["init", "--repo", repoPath]);

    // Clobbering someone's gate definitions is not a thing to do quietly.
    expect(second.code).toBe(1);
    expect(second.stdout).toContain("already exists");
  });
});

describe("commands that need the database", () => {
  it("still fail loudly when it is not configured", async () => {
    const result = await withoutDatabase(["list"]);

    // The loud failure moved to where it belongs; it did not go away.
    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain("DATABASE_URL");
  });
});

describe("gatekeeper forget", () => {
  const PROJECT = "test-cli-forget";

  afterEach(async () => {
    await db.execute(sql`DELETE FROM projects WHERE id = ${PROJECT}`);
  });

  it("reports what would be lost and deletes nothing without --force", async () => {
    await upsertProject({ id: PROJECT, name: "Forget me", repoPath: "/tmp/forget-me" });

    const result = await withDatabase(["forget", PROJECT]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("recorded run(s)");
    expect(result.stdout).toContain("--force");
    // Asking what would happen must not make it happen.
    expect(await getProject(PROJECT)).not.toBeNull();
  });

  it("deletes it with --force", async () => {
    await upsertProject({ id: PROJECT, name: "Forget me", repoPath: "/tmp/forget-me" });

    const result = await withDatabase(["forget", PROJECT, "--force"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`Forgot '${PROJECT}'`);
    expect(await getProject(PROJECT)).toBeNull();
  });

  it("says so for a project that is not registered", async () => {
    const result = await withDatabase(["forget", "never-registered", "--force"]);

    // Reporting a successful deletion of nothing would be worse than useless.
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("No project registered");
  });

  it("asks for an id rather than guessing", async () => {
    const result = await withDatabase(["forget"]);

    expect(result.code).toBe(2);
    expect(result.stdout).toContain("Usage:");
  });
});

afterAll(async () => {
  await closeDb();
});
