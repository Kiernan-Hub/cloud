import { getSourceHealth } from "@/modules/events";

export const dynamic = "force-dynamic";

// Returns 200 even when sources are stale: a stale source is data about the
// world, not an outage of this service.
export async function GET() {
  const sources = await getSourceHealth();
  return Response.json({
    sources,
    staleCount: sources.filter((s) => s.isStale).length,
  });
}
