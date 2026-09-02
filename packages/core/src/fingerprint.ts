import { createHash } from "node:crypto";
import type { NormalizedCandidate } from "./event.js";

/**
 * Fallback idempotency key for sources with no stable per-event id.
 * ADR-0001 section 4: description and url are deliberately excluded, because
 * sources reformat descriptions and add tracking parameters to urls — include
 * either and every import would create duplicates while every test still
 * passed. Do not add a field here without updating that decision record.
 */
export function contentFingerprintOf(
  candidate: Pick<NormalizedCandidate, "title" | "startAt" | "venueName" | "organizationName">,
): string {
  const normalizedTitle = candidate.title.trim().toLowerCase().replace(/\s+/g, " ");
  const parts = [
    normalizedTitle,
    candidate.startAt.toISOString(),
    candidate.venueName?.trim().toLowerCase() ?? "",
    candidate.organizationName?.trim().toLowerCase() ?? "",
  ];
  return createHash("sha256").update(parts.join("␟")).digest("hex");
}
