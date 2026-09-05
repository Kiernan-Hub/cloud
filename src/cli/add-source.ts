// Register an ICS source from the command line.
//
//   npm run source:add -- \
//     --id uva-arts \
//     --name "UVA Arts" \
//     --owner "UVA Office of the Provost for the Arts" \
//     --homepage https://arts.virginia.edu/calendar \
//     --feed https://arts.virginia.edu/calendar/ics \
//     --terms https://virginia.edu/terms \
//     --terms-note "Public calendar feed; robots.txt permits; checked 2026-09-05"
//
// --terms-note is required and there is no flag to skip it. The database
// enforces the same rule (enabled_requires_terms_review), so a source cannot
// be switched on without a recorded review either way — this just makes the
// requirement visible at the point of entry.
//
// The source is created DISABLED. Enabling it is a separate, deliberate step
// once a dry run looks right.

import { parseArgs } from "node:util";

import { db, sqlClient } from "@/lib/db";
import { sources } from "@/lib/db/schema";
import { logger } from "@/lib/log";
import { isValidTimeZone } from "@/modules/parsing";

const { values } = parseArgs({
  options: {
    id: { type: "string" },
    name: { type: "string" },
    owner: { type: "string" },
    homepage: { type: "string" },
    feed: { type: "string" },
    terms: { type: "string" },
    "terms-note": { type: "string" },
    timezone: { type: "string", default: "America/New_York" },
    interval: { type: "string", default: "3600" },
    "retain-raw": { type: "boolean", default: false },
    contact: { type: "string" },
  },
  allowPositionals: false,
});

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

const required = ["id", "name", "owner", "homepage", "feed", "terms-note"] as const;
for (const key of required) {
  if (!values[key]) fail(`--${key} is required`);
}

const id = values.id!;
const feedUrl = values.feed!;
const homepageUrl = values.homepage!;
const timezone = values.timezone!;

if (!/^[a-z0-9-]+$/.test(id)) {
  fail("--id must be a lowercase slug (letters, digits, hyphens)");
}
for (const [flag, url] of [
  ["--feed", feedUrl],
  ["--homepage", homepageUrl],
] as const) {
  if (!/^https?:\/\//i.test(url)) fail(`${flag} must be an http(s) URL`);
}
if (!isValidTimeZone(timezone)) {
  fail(`--timezone is not a valid IANA zone: ${timezone}`);
}

const intervalSeconds = Number(values.interval);
if (!Number.isInteger(intervalSeconds) || intervalSeconds < 300) {
  // Polling a publisher more than every five minutes is not courteous, and
  // no campus calendar changes that fast.
  fail("--interval must be an integer of at least 300 seconds");
}

async function main() {
  await db
    .insert(sources)
    .values({
      id,
      displayName: values.name!,
      owner: values.owner!,
      homepageUrl,
      feedUrl,
      method: "ics",
      termsUrl: values.terms ?? null,
      termsReviewedAt: new Date(),
      termsNotes: values["terms-note"]!,
      contactEmail: values.contact ?? null,
      retainRawPayload: values["retain-raw"]!,
      defaultTimezone: timezone,
      intervalSeconds,
      // Created off. Run a dry run first, look at what it imported, then
      // enable deliberately.
      enabled: false,
    })
    .onConflictDoUpdate({
      target: sources.id,
      set: {
        displayName: values.name!,
        owner: values.owner!,
        homepageUrl,
        feedUrl,
        termsUrl: values.terms ?? null,
        termsReviewedAt: new Date(),
        termsNotes: values["terms-note"]!,
        defaultTimezone: timezone,
        intervalSeconds,
        updatedAt: new Date(),
      },
    });

  logger.info("source registered (disabled)", { source_id: id, feed_url: feedUrl });
  console.log(
    [
      "",
      `Registered '${id}', currently DISABLED.`,
      "",
      "Next:",
      `  1. Dry run:  npm run source:run -- --id ${id}`,
      "  2. Check what it imported, then enable it:",
      `     psql "$DATABASE_URL" -c "UPDATE sources SET enabled = true WHERE id = '${id}';"`,
      "",
      "Also complete the checklist in docs/sources/ for this source.",
      "",
    ].join("\n"),
  );

  await sqlClient.end();
}

main().catch(async (error: unknown) => {
  logger.error("failed to register source", {
    error: error instanceof Error ? error.message : String(error),
  });
  await sqlClient.end();
  process.exit(1);
});
