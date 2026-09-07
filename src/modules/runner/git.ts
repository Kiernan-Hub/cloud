// Reading the repo state a run is checking.
//
// Every run records which commit it checked, so results can be compared over
// time and a flaky gate can be spotted by the same commit producing different
// outcomes. Also records whether the working tree was dirty — a result from a
// dirty tree is not reproducible from the commit alone, and the dashboard
// says so rather than pretending otherwise.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type RepoState = {
  commitSha: string;
  commitSubject: string | null;
  branch: string | null;
  dirty: boolean;
};

export class NotAGitRepoError extends Error {
  constructor(path: string) {
    super(`Not a git repository: ${path}`);
    this.name = "NotAGitRepoError";
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

export async function readRepoState(repoPath: string): Promise<RepoState> {
  try {
    await git(repoPath, ["rev-parse", "--git-dir"]);
  } catch {
    throw new NotAGitRepoError(repoPath);
  }

  // A repo with no commits yet is a real state, not an error.
  let commitSha: string;
  let commitSubject: string | null = null;
  try {
    commitSha = await git(repoPath, ["rev-parse", "HEAD"]);
    commitSubject = await git(repoPath, ["log", "-1", "--pretty=%s"]);
  } catch {
    commitSha = "0000000000000000000000000000000000000000";
    commitSubject = "(no commits yet)";
  }

  let branch: string | null = null;
  try {
    const name = await git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
    branch = name === "HEAD" ? null : name; // detached
  } catch {
    branch = null;
  }

  let dirty = false;
  try {
    dirty = (await git(repoPath, ["status", "--porcelain"])).length > 0;
  } catch {
    dirty = false;
  }

  return { commitSha, commitSubject, branch, dirty };
}

export function shortSha(sha: string): string {
  return sha.slice(0, 8);
}
