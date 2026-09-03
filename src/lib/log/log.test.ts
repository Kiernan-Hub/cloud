import { afterEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/log";

function captureLines(fn: () => void): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = [];
  const spy = vi
    .spyOn(console, "log")
    .mockImplementation((line: string) => void lines.push(JSON.parse(line)));
  const errSpy = vi
    .spyOn(console, "error")
    .mockImplementation((line: string) => void lines.push(JSON.parse(line)));
  fn();
  spy.mockRestore();
  errSpy.mockRestore();
  return lines;
}

afterEach(() => vi.restoreAllMocks());

describe("structured logging", () => {
  it("emits one JSON object per line with level, time and msg", () => {
    const [line] = captureLines(() => logger.error("something happened"));

    expect(line).toMatchObject({ level: "error", msg: "something happened" });
    expect(typeof line!.time).toBe("string");
  });

  it("redacts secret-looking fields", () => {
    // CLAUDE.md: no secrets in logs. This asserts the guard actually bites.
    const [line] = captureLines(() =>
      logger.error("connecting", {
        password: "hunter2",
        api_key: "sk-live-123",
        DATABASE_TOKEN: "abc",
        source_id: "uva-demo",
      }),
    );

    expect(line!.password).toBe("[redacted]");
    expect(line!.api_key).toBe("[redacted]");
    expect(line!.DATABASE_TOKEN).toBe("[redacted]");
    // Non-secret context must survive.
    expect(line!.source_id).toBe("uva-demo");
  });

  it("carries bound context onto every line", () => {
    const bound = logger.withContext({ run_id: "run-123" });
    const [line] = captureLines(() => bound.error("run started"));

    expect(line!.run_id).toBe("run-123");
  });
});
