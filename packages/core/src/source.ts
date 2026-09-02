import { z } from "zod";

/**
 * A configured ingestion source. Corresponds to one completed record under
 * docs/sources/ — a source should not exist here until docs/sources says
 * `approved`.
 */
export const sourceSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1),
  name: z.string().min(1),
  method: z.enum(["ical", "rss", "seed"]),
  feedUrl: z.string().url().nullable(),
  enabled: z.boolean(),
  createdAt: z.date(),
});
export type Source = z.infer<typeof sourceSchema>;

/**
 * `pending` is the queue state: a row waiting to be claimed by a worker with
 * `SELECT ... FOR UPDATE SKIP LOCKED`, per OVERVIEW.md section 8's
 * database-backed jobs. A run moves pending -> running -> (succeeded|failed).
 */
export const INGESTION_RUN_STATUSES = ["pending", "running", "succeeded", "failed"] as const;
export const ingestionRunStatusSchema = z.enum(INGESTION_RUN_STATUSES);
export type IngestionRunStatus = z.infer<typeof ingestionRunStatusSchema>;

/**
 * One ingestion attempt for one source. `status` distinguishes a run that
 * completed from one that failed partway — only a `succeeded` run may ever
 * advance an event's `consecutiveAbsences`, per ADR-0001 section 2's rule
 * that a failed run must leave every event untouched.
 */
export const ingestionRunSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  status: ingestionRunStatusSchema,
  scheduledAt: z.date(),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
  recordsSeen: z.number().int().min(0),
  recordsUpserted: z.number().int().min(0),
  recordsFailed: z.number().int().min(0),
  errorMessage: z.string().nullable(),
});
export type IngestionRun = z.infer<typeof ingestionRunSchema>;
