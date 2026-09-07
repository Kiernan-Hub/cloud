// Executing gates and reading repo state.
//
// No database access: this module is about running commands and reporting
// what happened, which makes it testable against real subprocesses with no
// storage involved. Boundary enforced in eslint.config.mjs.

export { execute, extractMetric } from "./execute";
export type { ExecuteOptions, ExecuteResult, GateStatus } from "./execute";

export { NotAGitRepoError, readRepoState, shortSha } from "./git";
export type { RepoState } from "./git";
