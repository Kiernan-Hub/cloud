import type { NextRequest } from "next/server";

import { listUpcoming, MAX_PAGE_SIZE } from "@/modules/events";

// Reads live data on every request; caching this would undermine the
// freshness guarantees the product is built around.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const limitParam = Number(params.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;

  const cursorStartsAt = params.get("cursorStartsAt");
  const cursorId = params.get("cursorId");
  const cursor =
    cursorStartsAt && cursorId ? { startsAt: cursorStartsAt, id: cursorId } : null;

  const { events, nextCursor } = await listUpcoming({ limit, cursor });

  return Response.json({
    events,
    nextCursor,
    maxPageSize: MAX_PAGE_SIZE,
  });
}
