// Zod-validated environment config, loaded once at startup. Fails loudly on
// a missing or malformed variable instead of surfacing a confusing error
// three layers deeper. See docs/milestones/milestone-1-walking-skeleton.md
// (M1-05).

import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** How often the worker looks for projects due a scheduled run. */
  WORKER_TICK_SECONDS: z.coerce.number().int().positive().default(60),

  // How long captured gate output is kept. Results themselves are never
  // deleted — they are the flake evidence — but their output is most of the
  // bytes and has a short useful life. 0 keeps output forever.
  OUTPUT_RETENTION_DAYS: z.coerce.number().int().min(0).default(30),
});

export type AppConfig = z.infer<typeof envSchema>;

function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    // Not the structured logger: config failure happens before it can load.
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
}

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (!cached) {
    cached = loadConfig();
  }
  return cached;
}

export {
  exampleGatefile,
  GATEFILE_NAME,
  gatefileSchema,
  GatefileError,
  loadGatefile,
} from "./gatefile";
export type { Gatefile } from "./gatefile";
