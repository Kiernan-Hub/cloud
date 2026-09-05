// Run one source's ingestion immediately, regardless of its schedule.
//
//   npm run source:run -- --id uva-arts
//
// Works on a disabled source, so a newly registered feed can be dry-run and
// inspected before it is switched on. Prints a summary of what happened
// rather than leaving it only in the logs.

import { parseArgs } from "node:util";

import { eq } from "drizzle-orm";

import { db, sqlClient } from "@/lib/db";
import { sourceEvents } from "@/lib/db/schema";
import { logger } from "@/lib/log";
import { defaultHandler, finishRun, startRun } from "@/modules/ingestion";
import { getSource } from "@/modules/sources";

const { values } = parseArgs({
  options: { id: { type: "string" } },
  allowPositionals: false,
});

if (!values.id) {
  console.error("error: --id is required");
  process.exit(1);
}

const sourceId = values.id;

async function main() {
  const source = await getSource(sourceId);
  if (!source) {
    console.error(`error: no source with id '${sourceId}'`);
    process.exit(1);
  }

  if (!source.enabled) {
    logger.info("running a disabled source as a dry run", {
      source_id: sourceId,
    });
  }

  const runId = await startRun(sourceId);
  const outcome = await defaultHandler(
    {
      id: source.id,
      displayName: source.displayName,
      intervalSeconds: source.intervalSeconds,
    },
    runId,
  );
  await finishRun(runId, outcome);

  const events = await db
    .select({
      title: sourceEvents.title,
      startsAt: sourceEvents.startsAt,
      venue: sourceEvents.venueName,
      url: sourceEvents.canonicalUrl,
    })
    .from(sourceEvents)
    .where(eq(sourceEvents.sourceId, sourceId))
    .limit(5);

  const lines = [
    "",
    `Run ${runId}`,
    `  status:   ${outcome.status}`,
    `  seen:     ${outcome.recordsSeen ?? 0}`,
    `  created:  ${outcome.recordsCreated ?? 0}`,
    `  updated:  ${outcome.recordsUpdated ?? 0}`,
    `  skipped:  ${outcome.recordsSkipped ?? 0}`,
  ];

  if (outcome.errorSummary) {
    lines.push(`  error:    ${outcome.errorSummary}`);
  }

  if (events.length > 0) {
    lines.push("", "First few events now stored:");
    for (const event of events) {
      lines.push(
        `  - ${event.startsAt.toISOString()}  ${event.title}`,
        `      ${event.venue ?? "(no venue listed)"}  ${event.url}`,
      );
    }
  }

  if ((outcome.recordsSkipped ?? 0) > 0) {
    lines.push(
      "",
      "Some records were skipped. The reasons were logged above with",
      'msg="skipped malformed record" — check them before enabling.',
    );
  }

  lines.push("");
  console.log(lines.join("\n"));

  await sqlClient.end();
}

main().catch(async (error: unknown) => {
  logger.error("source run failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  await sqlClient.end();
  process.exit(1);
});
