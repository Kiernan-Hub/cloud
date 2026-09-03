import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Process + database reachability only. Source freshness is a different
// question and lives at /api/health/sources — see OVERVIEW.md section 7.
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok", database: "reachable" });
  } catch {
    return Response.json(
      { status: "degraded", database: "unreachable" },
      { status: 503 },
    );
  }
}
