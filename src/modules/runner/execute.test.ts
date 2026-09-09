// Runs real subprocesses. No database, no mocks — the whole point of this
// module is what actually happens when you execute a command, so stubbing it
// would test nothing.

import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { execute, extractMetric } from "./execute";

const cwd = tmpdir();

describe("execute", () => {
  it("reports a zero exit as passed", async () => {
    const result = await execute({ command: "exit 0", cwd, timeoutSeconds: 10 });

    expect(result.status).toBe("passed");
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("reports a non-zero exit as failed, keeping the code", async () => {
    const result = await execute({ command: "exit 3", cwd, timeoutSeconds: 10 });

    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(3);
  });

  it("captures stdout and stderr separately", async () => {
    const result = await execute({
      command: "echo to-stdout; echo to-stderr 1>&2",
      cwd,
      timeoutSeconds: 10,
    });

    expect(result.stdoutTail).toContain("to-stdout");
    expect(result.stderrTail).toContain("to-stderr");
    // Keeping them apart matters: a passing command that writes warnings to
    // stderr should not look like it failed.
    expect(result.stdoutTail).not.toContain("to-stderr");
  });

  it("kills a hanging command and reports it as timed out, not failed", async () => {
    const result = await execute({
      command: "sleep 30",
      cwd,
      timeoutSeconds: 1,
    });

    // These need different responses from a human, so they are different
    // statuses rather than both being 'failed'.
    expect(result.status).toBe("timed_out");
    expect(result.durationMs).toBeLessThan(10_000);
  });

  it("kills the whole process group, not just the shell", async () => {
    // A test runner that spawns children must not survive the timeout as an
    // orphan holding a port open.
    const result = await execute({
      command: "sleep 30 & sleep 30",
      cwd,
      timeoutSeconds: 1,
    });

    expect(result.status).toBe("timed_out");
  });

  it("stops on abort and does not resolve until the child is dead", async () => {
    const aborter = new AbortController();
    setTimeout(() => aborter.abort(), 200);

    const result = await execute({
      command: "sleep 30",
      cwd,
      timeoutSeconds: 60,
      signal: aborter.signal,
    });

    // We killed it before it could answer, so it did not fail — reporting
    // `failed` would blame the command for our interrupt.
    expect(result.status).toBe("error");
    // Resolving early would let the caller exit while the command kept
    // running, detached, on the user's machine.
    expect(result.durationMs).toBeLessThan(10_000);
  });

  it("reports an unusable working directory as error, not failure", async () => {
    const result = await execute({
      command: "echo hi",
      cwd: "/definitely/not/a/real/path",
      timeoutSeconds: 10,
    });

    // A broken gate definition is not the same as a gate catching a problem.
    expect(result.status).toBe("error");
  });

  it("keeps the tail of large output and flags the truncation", async () => {
    const result = await execute({
      command: 'for i in $(seq 1 4000); do echo "line $i"; done',
      cwd,
      timeoutSeconds: 30,
      maxOutputBytes: 2000,
    });

    expect(result.status).toBe("passed");
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.stdoutTail)).toBeLessThanOrEqual(2100);
    // The tail is what tells you what broke, so the end must survive.
    expect(result.stdoutTail).toContain("line 4000");
    expect(result.stdoutTail).not.toContain("line 1\n");
  });

  it("does not flag truncation for small output", async () => {
    const result = await execute({
      command: "echo small",
      cwd,
      timeoutSeconds: 10,
      maxOutputBytes: 2000,
    });

    expect(result.truncated).toBe(false);
  });

  it("sets CI=1 so tools pick their non-interactive behavior", async () => {
    const result = await execute({
      command: "echo CI=$CI",
      cwd,
      timeoutSeconds: 10,
    });

    expect(result.stdoutTail).toContain("CI=1");
  });

  it("passes through extra environment variables", async () => {
    const result = await execute({
      command: "echo VAL=$GATEKEEPER_TEST_VAR",
      cwd,
      timeoutSeconds: 10,
      env: { GATEKEEPER_TEST_VAR: "hello" },
    });

    expect(result.stdoutTail).toContain("VAL=hello");
  });

  it("records start and finish times that bracket the run", async () => {
    const result = await execute({ command: "sleep 0.2", cwd, timeoutSeconds: 10 });

    expect(result.finishedAt.getTime()).toBeGreaterThanOrEqual(
      result.startedAt.getTime(),
    );
    expect(result.durationMs).toBeGreaterThanOrEqual(150);
  });
});

describe("extractMetric", () => {
  it("pulls the first capture group as a number", () => {
    expect(extractMetric("Coverage: 87.5% of statements", "Coverage: ([\\d.]+)")).toBe(
      87.5,
    );
  });

  it("strips commas and percent signs", () => {
    expect(extractMetric("Bundle: 1,234 kB", "Bundle: ([\\d,]+)")).toBe(1234);
    expect(extractMetric("Coverage 91%", "Coverage (\\d+%)")).toBe(91);
  });

  it("matches across multiple lines", () => {
    const output = "building...\ndone\nTests  128 passed\n";
    expect(extractMetric(output, "Tests\\s+(\\d+) passed")).toBe(128);
  });

  it("returns null when the pattern does not match", () => {
    // A metric regex drifting must not fail a gate that really passed.
    expect(extractMetric("no numbers here", "Coverage: ([\\d.]+)")).toBeNull();
  });

  it("returns null for an invalid regex instead of throwing", () => {
    expect(extractMetric("anything", "([unclosed")).toBeNull();
  });

  it("returns null when the capture is not numeric", () => {
    expect(extractMetric("Coverage: high", "Coverage: (\\w+)")).toBeNull();
  });

  it("falls back to the whole match when there is no capture group", () => {
    expect(extractMetric("value 42 here", "\\d+")).toBe(42);
  });
});
