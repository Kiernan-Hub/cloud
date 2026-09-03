// Structured JSON logging, one object per line. No external dependency —
// the format is simple enough not to need one, and it keeps the walking
// skeleton free of another thing to configure. See CLAUDE.md: "structured
// logs, traceable ingestion-run IDs, no secrets in logs or code."

import { getConfig } from "@/lib/config";

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// Field names that must never appear in a log line's value, even if a caller
// passes them in by mistake.
const SECRET_KEY_PATTERN = /password|secret|token|api[_-]?key|credential/i;

const REDACTED = "[redacted]";

function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : value;
  }
  return out;
}

function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  const configuredLevel = getConfig().LOG_LEVEL;
  if (LEVEL_ORDER[level] < LEVEL_ORDER[configuredLevel]) return;

  const line = {
    level,
    time: new Date().toISOString(),
    msg,
    ...redact(fields),
  };
  const write = level === "error" ? console.error : console.log;
  write(JSON.stringify(line));
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => log("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => log("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => log("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => log("error", msg, fields),

  // Bind a run ID (or other context) so every subsequent line from an
  // ingestion run carries it, per CLAUDE.md's traceable-run-ID requirement.
  withContext(context: Record<string, unknown>) {
    return {
      debug: (msg: string, fields?: Record<string, unknown>) =>
        log("debug", msg, { ...context, ...fields }),
      info: (msg: string, fields?: Record<string, unknown>) =>
        log("info", msg, { ...context, ...fields }),
      warn: (msg: string, fields?: Record<string, unknown>) =>
        log("warn", msg, { ...context, ...fields }),
      error: (msg: string, fields?: Record<string, unknown>) =>
        log("error", msg, { ...context, ...fields }),
    };
  },
};
