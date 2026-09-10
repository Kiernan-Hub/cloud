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

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const CLI = join(process.cwd(), "src", "cli", "gatekeeper.ts");

let repoPath: string;

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), "gatekeeper-cli-"));
});

afterEach(async () => {
  await rm(repoPath, { recursive: true, force: true });
});

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
