import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GATEFILE_NAME, GatefileError, exampleGatefile, loadGatefile } from "./gatefile";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "gatefile-test-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(content: string): Promise<string> {
  await writeFile(join(dir, GATEFILE_NAME), content, "utf8");
  return dir;
}

const valid = {
  project: { id: "demo", name: "Demo" },
  gates: [{ key: "lint", name: "Lint", command: "npm run lint" }],
};

describe("loadGatefile", () => {
  it("loads a valid config and applies defaults", async () => {
    await write(JSON.stringify(valid));
    const config = await loadGatefile(dir);

    expect(config.project.id).toBe("demo");
    expect(config.project.defaultBranch).toBe("main");
    expect(config.gates[0]!.timeoutSeconds).toBe(300);
    expect(config.gates[0]!.blocking).toBe(true);
  });

  it("reports a missing file clearly", async () => {
    await expect(loadGatefile("/definitely/not/here")).rejects.toThrow(GatefileError);
  });

  it("reports invalid JSON rather than crashing", async () => {
    await write("{ not json");
    await expect(loadGatefile(dir)).rejects.toThrow(/Invalid JSON/);
  });

  it("rejects a config with no gates", async () => {
    await write(JSON.stringify({ project: valid.project, gates: [] }));
    await expect(loadGatefile(dir)).rejects.toThrow(/at least one gate/);
  });

  it("rejects duplicate gate keys", async () => {
    await write(
      JSON.stringify({
        project: valid.project,
        gates: [
          { key: "a", name: "A", command: "x" },
          { key: "a", name: "B", command: "y" },
        ],
      }),
    );
    await expect(loadGatefile(dir)).rejects.toThrow(/duplicate gate key/);
  });

  it("rejects a non-slug gate key", async () => {
    await write(
      JSON.stringify({
        project: valid.project,
        gates: [{ key: "Not A Slug", name: "X", command: "x" }],
      }),
    );
    await expect(loadGatefile(dir)).rejects.toThrow(/lowercase slug/);
  });

  it("rejects an unknown field instead of ignoring it", async () => {
    // A typo'd key that is silently dropped is worse than an error.
    await write(
      JSON.stringify({
        project: valid.project,
        gates: [{ key: "a", name: "A", command: "x", timeoutSecond: 5 }],
      }),
    );
    await expect(loadGatefile(dir)).rejects.toThrow(/Invalid config/);
  });

  it("rejects a metric regex that does not compile", async () => {
    // It would silently never match, so it is caught at load time.
    await write(
      JSON.stringify({
        project: valid.project,
        gates: [
          {
            key: "a",
            name: "A",
            command: "x",
            metric: { name: "m", pattern: "([unclosed", direction: "higher_is_better" },
          },
        ],
      }),
    );
    await expect(loadGatefile(dir)).rejects.toThrow(/invalid metric pattern/);
  });

  it("requires a direction alongside a metric", async () => {
    await write(
      JSON.stringify({
        project: valid.project,
        gates: [
          { key: "a", name: "A", command: "x", metric: { name: "m", pattern: "(\\d+)" } },
        ],
      }),
    );
    await expect(loadGatefile(dir)).rejects.toThrow(/Invalid config/);
  });

  it("rejects an absurd timeout", async () => {
    await write(
      JSON.stringify({
        project: valid.project,
        gates: [{ key: "a", name: "A", command: "x", timeoutSeconds: 99999 }],
      }),
    );
    await expect(loadGatefile(dir)).rejects.toThrow(/Invalid config/);
  });
});

describe("exampleGatefile", () => {
  it("produces a config that actually loads", async () => {
    // A starter file that fails its own validator would be a bad first
    // impression.
    await write(exampleGatefile("My Project", "my-project"));
    const config = await loadGatefile(dir);

    expect(config.project.id).toBe("my-project");
    expect(config.gates.length).toBeGreaterThan(0);
  });
});
