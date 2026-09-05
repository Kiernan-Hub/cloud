// Ingestion: scheduling, fetching, and driving a source through the pipeline.
//
// Public surface only — other modules import from here, never from the files
// behind it (docs/adr/0005-module-boundaries.md).

export { claimDueSources, finishRun, processSource, startRun } from "./run";
export type { ClaimedSource, RunOutcome, SourceHandler } from "./run";

export { backoffSeconds, fetchSource, USER_AGENT } from "./fetch";
export type { ConditionalHeaders, FetchOutcome, FetchSourceOptions } from "./fetch";

export { ingestIcsSource } from "./ics-source";
export type { IcsSourceConfig } from "./ics-source";

export { defaultHandler, UnsupportedSourceMethodError } from "./dispatch";
