// Choosing a handler for a source, and recording what the run did back onto
// the source record (failure counts, backoff, conditional-request
// validators).
//
// Kept separate from run.ts so the run lifecycle stays independent of which
// source formats happen to be supported.

import { logger } from "@/lib/log";
import { getSource, recordFailure, recordSuccess } from "@/modules/sources";

import { backoffSeconds } from "./fetch";
import { ingestIcsSource } from "./ics-source";
import type { ClaimedSource, RunOutcome, SourceHandler } from "./run";

export class UnsupportedSourceMethodError extends Error {
  constructor(method: string) {
    super(`No handler for source method: ${method}`);
    this.name = "UnsupportedSourceMethodError";
  }
}

/**
 * The real handler. Loads the source's configuration, runs the appropriate
 * pipeline, then updates the source record so the next poll behaves
 * correctly — backing off after a failure, sending validators after a
 * success.
 */
export const defaultHandler: SourceHandler = async (
  claimed: ClaimedSource,
  runId: string,
): Promise<RunOutcome> => {
  const source = await getSource(claimed.id);

  if (!source) {
    return {
      status: "failed",
      errorKind: "config",
      errorSummary: `Source ${claimed.id} disappeared between claim and run`,
    };
  }

  let outcome: RunOutcome;

  switch (source.method) {
    case "ics": {
      if (!source.feedUrl) {
        return {
          status: "failed",
          errorKind: "config",
          errorSummary: "ICS source has no feed_url configured",
        };
      }

      outcome = await ingestIcsSource(
        {
          sourceId: source.id,
          feedUrl: source.feedUrl,
          homepageUrl: source.homepageUrl,
          fallbackTimeZone: source.defaultTimezone,
          defaultOrganizationName: source.displayName,
          retainRawPayload: source.retainRawPayload,
          rawRetentionDays: source.rawRetentionDays,
          conditional: {
            etag: source.lastEtag,
            lastModified: source.lastModifiedHeader,
          },
        },
        runId,
      );
      break;
    }

    // Other methods are declared in the schema but have no parser yet.
    // Failing loudly beats pretending the run succeeded.
    default:
      return {
        status: "failed",
        errorKind: "config",
        errorSummary: new UnsupportedSourceMethodError(source.method).message,
      };
  }

  if (outcome.status === "failed") {
    const delay = backoffSeconds(source.consecutiveFailures + 1);
    const failures = await recordFailure(source.id, delay);
    logger.warn("source backing off after failure", {
      source_id: source.id,
      run_id: runId,
      consecutive_failures: failures + 1,
      retry_in_seconds: delay,
    });
  } else if (outcome.notModified) {
    // A 304 brought no new validators. Reset the failure counter but keep
    // the stored ones, or the next poll loses its conditional request.
    await recordSuccess(source.id);
  } else {
    await recordSuccess(source.id, {
      etag: outcome.etag,
      lastModified: outcome.lastModified,
    });
  }

  return outcome;
};
