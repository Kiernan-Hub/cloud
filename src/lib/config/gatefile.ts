// The gate config file: `gatekeeper.json` in the root of a watched repo.
//
// Gates are commands, and commands are trusted input — the same trust level
// as a Makefile or a CI workflow in the same repo. Gatekeeper runs what this
// file says on the machine that runs it. Only point it at repos you trust.
//
// Validated with Zod so a typo produces a clear message at load time rather
// than a confusing failure three layers into a run.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

export const GATEFILE_NAME = "gatekeeper.json";

const gateSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9-]*$/, "must be a lowercase slug"),
    name: z.string().min(1),
    command: z.string().min(1),
    workingDir: z.string().optional(),
    timeoutSeconds: z.number().int().positive().max(3600).default(300),
    blocking: z.boolean().default(true),
    enabled: z.boolean().default(true),

    // Metric extraction is all-or-nothing; the database enforces the same
    // rule with a check constraint.
    metric: z
      .object({
        name: z.string().min(1),
        pattern: z.string().min(1),
        direction: z.enum(["higher_is_better", "lower_is_better"]),
        threshold: z.number().optional(),
      })
      .optional(),
  })
  .strict();

export const gatefileSchema = z
  .object({
    project: z
      .object({
        id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "must be a lowercase slug"),
        name: z.string().min(1),
        defaultBranch: z.string().default("main"),
      })
      .strict(),
    gates: z.array(gateSchema).min(1, "define at least one gate"),
  })
  .strict()
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    for (const gate of config.gates) {
      if (seen.has(gate.key)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate gate key: ${gate.key}`,
          path: ["gates"],
        });
      }
      seen.add(gate.key);
    }

    // A regex that does not compile would silently never match, so it is
    // rejected at load time instead.
    for (const [index, gate] of config.gates.entries()) {
      if (!gate.metric) continue;
      try {
        new RegExp(gate.metric.pattern);
      } catch (error) {
        ctx.addIssue({
          code: "custom",
          message: `gate '${gate.key}' has an invalid metric pattern: ${
            error instanceof Error ? error.message : String(error)
          }`,
          path: ["gates", index, "metric", "pattern"],
        });
      }
    }
  });

export type Gatefile = z.infer<typeof gatefileSchema>;

export class GatefileError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = "GatefileError";
  }
}

export async function loadGatefile(repoPath: string): Promise<Gatefile> {
  const filePath = join(repoPath, GATEFILE_NAME);

  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    throw new GatefileError(`No ${GATEFILE_NAME} found`, filePath);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new GatefileError(
      `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      filePath,
    );
  }

  const result = gatefileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new GatefileError(`Invalid config:\n${issues}`, filePath);
  }

  return result.data;
}

/** A starter config, written by `gatekeeper init`. */
export function exampleGatefile(projectName: string, id: string): string {
  return `${JSON.stringify(
    {
      project: { id, name: projectName, defaultBranch: "main" },
      gates: [
        {
          key: "lint",
          name: "Lint",
          command: "npm run lint",
          timeoutSeconds: 120,
        },
        {
          key: "typecheck",
          name: "Typecheck",
          command: "npm run typecheck",
          timeoutSeconds: 180,
        },
        {
          key: "test",
          name: "Tests",
          command: "npm test",
          timeoutSeconds: 600,
          metric: {
            name: "tests_passed",
            pattern: "Tests\\\\s+(\\\\d+) passed",
            direction: "higher_is_better",
          },
        },
        {
          key: "build",
          name: "Build",
          command: "npm run build",
          timeoutSeconds: 600,
          blocking: false,
        },
      ],
    },
    null,
    2,
  )}\n`;
}
