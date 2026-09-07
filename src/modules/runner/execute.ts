// Running one gate command and reporting what happened.
//
// This module touches no database (enforced by lint — see the boundary rules
// in eslint.config.mjs), so it can be tested against real subprocesses
// without any storage. Everything here is about being honest and bounded:
//
//   - a command that hangs is killed, and reported as timed out rather than
//     as failed, because those need different responses from a human
//   - output is capped, keeping the tail, since that is where the error is
//   - a command that cannot start at all is `error`, not `failed` — a broken
//     gate definition is not the same as a gate that caught a real problem

import { spawn } from "node:child_process";

export type GateStatus = "passed" | "failed" | "timed_out" | "skipped" | "error";

export type ExecuteOptions = {
  command: string;
  cwd: string;
  timeoutSeconds: number;
  /** Extra environment for the child. Merged over the parent's. */
  env?: Record<string, string>;
  /** Bytes of stdout/stderr to keep. The tail is kept, not the head. */
  maxOutputBytes?: number;
};

export type ExecuteResult = {
  status: GateStatus;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
  truncated: boolean;
  startedAt: Date;
  finishedAt: Date;
};

const DEFAULT_MAX_OUTPUT = 64 * 1024;

/**
 * Keep the last `maxBytes` of a stream. A ring of chunks rather than one
 * growing string, so a runaway process cannot exhaust memory before the
 * timeout fires.
 */
class TailBuffer {
  private chunks: Buffer[] = [];
  private size = 0;
  public truncated = false;

  constructor(private readonly maxBytes: number) {}

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;

    while (this.size > this.maxBytes && this.chunks.length > 1) {
      const dropped = this.chunks.shift()!;
      this.size -= dropped.length;
      this.truncated = true;
    }

    // A single chunk larger than the cap still needs trimming.
    if (this.size > this.maxBytes && this.chunks.length === 1) {
      const only = this.chunks[0]!;
      this.chunks[0] = only.subarray(only.length - this.maxBytes);
      this.size = this.maxBytes;
      this.truncated = true;
    }
  }

  toString(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

export function execute(options: ExecuteOptions): Promise<ExecuteResult> {
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  const startedAt = new Date();
  const startedHr = process.hrtime.bigint();

  return new Promise<ExecuteResult>((resolve) => {
    const stdout = new TailBuffer(maxOutputBytes);
    const stderr = new TailBuffer(maxOutputBytes);

    let timedOut = false;
    let settled = false;

    const finish = (
      status: GateStatus,
      exitCode: number | null,
      signal: NodeJS.Signals | null,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const durationMs = Number((process.hrtime.bigint() - startedHr) / 1_000_000n);

      resolve({
        status,
        exitCode,
        signal,
        durationMs,
        stdoutTail: stdout.toString(),
        stderrTail: stderr.toString(),
        truncated: stdout.truncated || stderr.truncated,
        startedAt,
        finishedAt: new Date(),
      });
    };

    let child;
    try {
      child = spawn(options.command, {
        cwd: options.cwd,
        shell: true,
        env: { ...process.env, ...options.env, CI: "1" },
        // Own process group, so killing the gate kills anything it spawned
        // rather than orphaning a test runner.
        detached: true,
      });
    } catch (error: unknown) {
      // Could not even start: a bad cwd, usually.
      finish("error", null, null);
      stderr.push(Buffer.from(error instanceof Error ? error.message : String(error)));
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        // Negative pid targets the whole group.
        process.kill(-child.pid!, "SIGTERM");
        // If it ignores SIGTERM, escalate rather than hang forever.
        setTimeout(() => {
          try {
            process.kill(-child.pid!, "SIGKILL");
          } catch {
            /* already gone */
          }
        }, 5000).unref();
      } catch {
        child.kill("SIGKILL");
      }
    }, options.timeoutSeconds * 1000);

    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

    child.on("error", (error) => {
      stderr.push(Buffer.from(`\n${error.message}`));
      finish("error", null, null);
    });

    child.on("close", (code, signal) => {
      if (timedOut) {
        finish("timed_out", code, signal);
        return;
      }
      finish(code === 0 ? "passed" : "failed", code, signal);
    });
  });
}

/**
 * Pull a numeric metric out of a gate's output.
 *
 * Returns null rather than throwing on a pattern that does not match or a
 * capture that is not a number: a gate that passed its real check should not
 * be recorded as broken just because a metric regex drifted.
 */
export function extractMetric(output: string, pattern: string): number | null {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "m");
  } catch {
    return null;
  }

  const match = regex.exec(output);
  if (!match) return null;

  // Prefer the first capture group; fall back to the whole match.
  const raw = match[1] ?? match[0];
  const value = Number(raw.replace(/[,%\s]/g, ""));

  return Number.isFinite(value) ? value : null;
}
