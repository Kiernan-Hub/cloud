// Zod-validated environment config, loaded once at startup. Fails loudly on
// a missing or malformed variable instead of surfacing a confusing error
// three layers deeper. See docs/milestones/milestone-1-walking-skeleton.md
// (M1-05).

import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  WORKER_TICK_SECONDS: z.coerce.number().int().positive().default(60),
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
